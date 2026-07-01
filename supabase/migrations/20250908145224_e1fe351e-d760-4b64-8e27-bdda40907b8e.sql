-- Create a boards table for managing educational boards
CREATE TABLE IF NOT EXISTS public.boards (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  board_name TEXT NOT NULL UNIQUE,
  board_code TEXT UNIQUE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS on boards table
ALTER TABLE public.boards ENABLE ROW LEVEL SECURITY;

-- Create policies for boards
CREATE POLICY "Authenticated users can view boards" 
ON public.boards 
FOR SELECT 
USING (true);

CREATE POLICY "Superadmins can manage boards" 
ON public.boards 
FOR ALL 
USING (is_superadmin_with_ip_check())
WITH CHECK (is_superadmin_with_ip_check());

-- Create trigger for updated_at
CREATE TRIGGER update_boards_updated_at
BEFORE UPDATE ON public.boards
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Insert existing boards from schools table to maintain data integrity
INSERT INTO public.boards (board_name, created_by, board_code)
SELECT DISTINCT 
  TRIM(board) as board_name,
  (SELECT user_id FROM public.profiles WHERE role = 'superadmin' LIMIT 1) as created_by,
  UPPER(REPLACE(TRIM(board), ' ', '_')) as board_code
FROM public.schools 
WHERE board IS NOT NULL AND TRIM(board) != ''
ON CONFLICT (board_name) DO NOTHING;

-- Create a states table for standardized state management
CREATE TABLE IF NOT EXISTS public.states (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  state_name TEXT NOT NULL UNIQUE,
  state_code TEXT UNIQUE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS on states table
ALTER TABLE public.states ENABLE ROW LEVEL SECURITY;

-- Create policies for states
CREATE POLICY "All users can view states" 
ON public.states 
FOR SELECT 
USING (true);

CREATE POLICY "Superadmins can manage states" 
ON public.states 
FOR ALL 
USING (is_superadmin_with_ip_check())
WITH CHECK (is_superadmin_with_ip_check());

-- Insert standardized states
INSERT INTO public.states (state_name, state_code) VALUES
('Tamil Nadu', 'TN'),
('Puducherry', 'PY')
ON CONFLICT (state_name) DO NOTHING;

-- Create a districts table for standardized district management
CREATE TABLE IF NOT EXISTS public.districts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  district_name TEXT NOT NULL,
  state_id UUID NOT NULL REFERENCES public.states(id),
  district_code TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(district_name, state_id)
);

-- Enable RLS on districts table
ALTER TABLE public.districts ENABLE ROW LEVEL SECURITY;

-- Create policies for districts
CREATE POLICY "All users can view districts" 
ON public.districts 
FOR SELECT 
USING (true);

CREATE POLICY "Superadmins can manage districts" 
ON public.districts 
FOR ALL 
USING (is_superadmin_with_ip_check())
WITH CHECK (is_superadmin_with_ip_check());

-- Insert standardized districts for Tamil Nadu
INSERT INTO public.districts (district_name, state_id, district_code)
SELECT DISTINCT 
  district_name,
  (SELECT id FROM public.states WHERE state_name = 'Tamil Nadu') as state_id,
  UPPER(REPLACE(district_name, ' ', '_')) as district_code
FROM (VALUES 
  ('ARIYALUR'), ('CHENGALPATTU'), ('CHENNAI'), ('COIMBATORE'), ('CUDDALORE'),
  ('DHARMAPURI'), ('DINDIGUL'), ('ERODE'), ('KALLAKURICHI'), ('KANCHIPURAM'),
  ('KANYAKUMARI'), ('KARUR'), ('KRISHNAGIRI'), ('MADURAI'), ('MAYILADUTHURAI'),
  ('NAGAPATTINAM'), ('NAMAKKAL'), ('NILGIRIS'), ('PERAMBALUR'), ('PUDUKKOTTAI'),
  ('RAMANATHAPURAM'), ('RANIPET'), ('SALEM'), ('SIVAGANGA'), ('TENKASI'),
  ('THANJAVUR'), ('THENI'), ('THOOTHUKUDI'), ('TIRUCHIRAPPALLI'), ('TIRUNELVELI'),
  ('TIRUPATHUR'), ('TIRUPPUR'), ('TIRUVALLUR'), ('TIRUVANNAMALAI'), ('TIRUVARUR'),
  ('VELLORE'), ('VILLUPURAM'), ('VIRUDHUNAGAR')
) AS tn_districts(district_name)
ON CONFLICT (district_name, state_id) DO NOTHING;

-- Insert districts for Puducherry
INSERT INTO public.districts (district_name, state_id, district_code)
SELECT DISTINCT 
  district_name,
  (SELECT id FROM public.states WHERE state_name = 'Puducherry') as state_id,
  UPPER(REPLACE(district_name, ' ', '_')) as district_code
FROM (VALUES 
  ('PUDUCHERRY'), ('KARAIKAL'), ('MAHE'), ('YANAM')
) AS py_districts(district_name)
ON CONFLICT (district_name, state_id) DO NOTHING;

-- Add state column to schools table if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'schools' AND column_name = 'state') THEN
    ALTER TABLE public.schools ADD COLUMN state TEXT;
  END IF;
END$$;

-- Update existing schools with state information based on district
UPDATE public.schools 
SET state = CASE 
  WHEN district IN ('PUDUCHERRY', 'KARAIKAL', 'MAHE', 'YANAM') THEN 'Puducherry'
  ELSE 'Tamil Nadu'
END
WHERE state IS NULL;