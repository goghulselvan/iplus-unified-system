-- Create enum types for workflow statuses
CREATE TYPE public.courier_status AS ENUM ('Sent', 'Returned');
CREATE TYPE public.contacted_status AS ENUM ('Yes', 'No');
CREATE TYPE public.interest_status AS ENUM ('Interested', 'Not Interested');
CREATE TYPE public.consent_status AS ENUM ('Yes', 'No');
CREATE TYPE public.registration_status AS ENUM ('Pending', 'Confirmed');
CREATE TYPE public.name_list_status AS ENUM ('Pending', 'Received');
CREATE TYPE public.payment_status AS ENUM ('Pending', 'Received');
CREATE TYPE public.question_paper_status AS ENUM ('Sent', 'Not Sent');
CREATE TYPE public.answer_sheet_status AS ENUM ('Waiting', 'Received');
CREATE TYPE public.result_status AS ENUM ('Sent', 'Not Sent');
CREATE TYPE public.communication_type AS ENUM ('Phone', 'Email', 'WhatsApp');
CREATE TYPE public.user_role AS ENUM ('superadmin', 'manager');
CREATE TYPE public.class_type AS ENUM ('LKG', 'UKG', '1', '2', '3', '4', '5', '6', '7', '8');

-- Create profiles table for user management
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  username TEXT UNIQUE NOT NULL,
  full_name TEXT,
  role user_role NOT NULL DEFAULT 'manager',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS on profiles
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Create schools table
CREATE TABLE public.schools (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ss_no INTEGER UNIQUE NOT NULL,
  school_name TEXT NOT NULL,
  school_address TEXT NOT NULL,
  district TEXT NOT NULL,
  board TEXT NOT NULL,
  mobile1 TEXT,
  mobile2 TEXT,
  email TEXT,
  contact_person_name TEXT,
  
  -- Workflow statuses
  courier_status courier_status DEFAULT 'Sent',
  contacted contacted_status DEFAULT 'No',
  registration_interest interest_status,
  consent_form_requested consent_status DEFAULT 'No',
  registration_status registration_status DEFAULT 'Pending',
  name_list_status name_list_status DEFAULT 'Pending',
  payment_status payment_status DEFAULT 'Pending',
  question_paper_sent question_paper_status DEFAULT 'Not Sent',
  answer_sheet_status answer_sheet_status DEFAULT 'Waiting',
  result_status result_status DEFAULT 'Not Sent',
  
  -- Follow up
  follow_up_date TIMESTAMP WITH TIME ZONE,
  follow_up_time TIME,
  
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS on schools
ALTER TABLE public.schools ENABLE ROW LEVEL SECURITY;

-- Create consent forms table
CREATE TABLE public.consent_forms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID REFERENCES public.schools(id) ON DELETE CASCADE NOT NULL,
  class class_type NOT NULL,
  forms_requested INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(school_id, class)
);

-- Enable RLS on consent forms
ALTER TABLE public.consent_forms ENABLE ROW LEVEL SECURITY;

-- Create communications table
CREATE TABLE public.communications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID REFERENCES public.schools(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users(id) NOT NULL,
  communication_type communication_type NOT NULL,
  message TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS on communications
ALTER TABLE public.communications ENABLE ROW LEVEL SECURITY;

-- Create function to update timestamps
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create triggers for automatic timestamp updates
CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_schools_updated_at
  BEFORE UPDATE ON public.schools
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_consent_forms_updated_at
  BEFORE UPDATE ON public.consent_forms
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Function to handle new user profile creation and assign first user as superadmin
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  user_count INTEGER;
BEGIN
  -- Count existing profiles
  SELECT COUNT(*) INTO user_count FROM public.profiles;
  
  -- Insert new profile
  INSERT INTO public.profiles (user_id, username, full_name, role)
  VALUES (
    NEW.id, 
    NEW.raw_user_meta_data ->> 'username',
    NEW.raw_user_meta_data ->> 'full_name',
    CASE WHEN user_count = 0 THEN 'superadmin'::user_role ELSE 'manager'::user_role END
  );
  
  RETURN NEW;
END;
$$;

-- Trigger to create profile on user creation
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- RLS Policies for profiles
CREATE POLICY "Users can view all profiles" ON public.profiles
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Users can update their own profile" ON public.profiles
  FOR UPDATE TO authenticated 
  USING (auth.uid() = user_id);

CREATE POLICY "Superadmins can do everything on profiles" ON public.profiles
  FOR ALL TO authenticated 
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles 
      WHERE user_id = auth.uid() AND role = 'superadmin'
    )
  );

-- RLS Policies for schools
CREATE POLICY "Authenticated users can view schools" ON public.schools
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert schools" ON public.schools
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can update schools" ON public.schools
  FOR UPDATE TO authenticated USING (true);

CREATE POLICY "Only superadmins can delete schools" ON public.schools
  FOR DELETE TO authenticated 
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles 
      WHERE user_id = auth.uid() AND role = 'superadmin'
    )
  );

-- RLS Policies for consent forms
CREATE POLICY "Authenticated users can view consent forms" ON public.consent_forms
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can manage consent forms" ON public.consent_forms
  FOR ALL TO authenticated USING (true);

-- RLS Policies for communications
CREATE POLICY "Authenticated users can view communications" ON public.communications
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert communications" ON public.communications
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Users can update their own communications" ON public.communications
  FOR UPDATE TO authenticated 
  USING (auth.uid() = user_id);

-- Create indexes for better performance
CREATE INDEX idx_schools_ss_no ON public.schools(ss_no);
CREATE INDEX idx_schools_school_name ON public.schools(school_name);
CREATE INDEX idx_schools_district ON public.schools(district);
CREATE INDEX idx_schools_follow_up_date ON public.schools(follow_up_date);
CREATE INDEX idx_consent_forms_school_id ON public.consent_forms(school_id);
CREATE INDEX idx_communications_school_id ON public.communications(school_id);
CREATE INDEX idx_communications_created_at ON public.communications(created_at);

-- Function to get user role
CREATE OR REPLACE FUNCTION public.get_user_role(user_uuid UUID)
RETURNS user_role
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT role FROM public.profiles WHERE user_id = user_uuid;
$$;