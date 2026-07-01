-- Create registration format configuration table
CREATE TABLE public.registration_format_config (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id uuid REFERENCES public.olympiad_projects(id),
  format_name text NOT NULL DEFAULT 'Default Format',
  component_order jsonb NOT NULL DEFAULT '["subject", "state", "district", "school", "student"]'::jsonb,
  separator text NOT NULL DEFAULT '-',
  is_active boolean NOT NULL DEFAULT false,
  created_by uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.registration_format_config ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Superadmins can manage registration format config" 
ON public.registration_format_config 
FOR ALL 
USING (is_superadmin(auth.uid()))
WITH CHECK (is_superadmin(auth.uid()));

CREATE POLICY "Managers can view registration format config" 
ON public.registration_format_config 
FOR SELECT 
USING (is_manager_or_superadmin());

-- Create function to get active format configuration
CREATE OR REPLACE FUNCTION public.get_active_registration_format(p_project_id uuid DEFAULT NULL)
RETURNS TABLE(
  component_order jsonb,
  separator text
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = 'public'
AS $function$
  SELECT 
    COALESCE(rfc.component_order, '["subject", "state", "district", "school", "student"]'::jsonb) as component_order,
    COALESCE(rfc.separator, '-') as separator
  FROM public.registration_format_config rfc
  WHERE rfc.project_id = p_project_id 
    AND rfc.is_active = true
  ORDER BY rfc.created_at DESC
  LIMIT 1;
$function$;

-- Create function to format registration number for display
CREATE OR REPLACE FUNCTION public.format_registration_number_display(
  p_registration_number text,
  p_project_id uuid DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = 'public'
AS $function$
DECLARE
  format_config RECORD;
  components text[];
  component_map jsonb;
  formatted_parts text[] := ARRAY[]::text[];
  component_key text;
BEGIN
  -- Return original if input is null or empty
  IF p_registration_number IS NULL OR p_registration_number = '' THEN
    RETURN p_registration_number;
  END IF;
  
  -- Get active format configuration
  SELECT component_order, separator 
  INTO format_config
  FROM public.get_active_registration_format(p_project_id);
  
  -- If no custom format, return original
  IF format_config IS NULL THEN
    RETURN p_registration_number;
  END IF;
  
  -- Split the registration number by current separator (-)
  components := string_to_array(p_registration_number, '-');
  
  -- Create a map of components (assuming current order: subject, state, district, school, student)
  IF array_length(components, 1) >= 5 THEN
    component_map := jsonb_build_object(
      'subject', components[1],
      'state', components[2], 
      'district', components[3],
      'school', components[4],
      'student', components[5]
    );
    
    -- Build formatted parts according to custom order
    FOR i IN 0..jsonb_array_length(format_config.component_order) - 1 LOOP
      component_key := format_config.component_order->>i;
      formatted_parts := array_append(formatted_parts, component_map->>component_key);
    END LOOP;
    
    -- Join with custom separator
    RETURN array_to_string(formatted_parts, format_config.separator);
  ELSE
    -- If format doesn't match expected structure, return original
    RETURN p_registration_number;
  END IF;
END;
$function$;

-- Insert default format configuration for existing projects
INSERT INTO public.registration_format_config (
  project_id, 
  format_name, 
  component_order, 
  separator, 
  is_active, 
  created_by
)
SELECT 
  op.id,
  'Default Format',
  '["subject", "state", "district", "school", "student"]'::jsonb,
  '-',
  true,
  op.created_by
FROM public.olympiad_projects op
WHERE op.is_active = true
ON CONFLICT DO NOTHING;