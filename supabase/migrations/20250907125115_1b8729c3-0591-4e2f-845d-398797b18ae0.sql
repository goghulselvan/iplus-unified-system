-- Fix policy conflicts and complete security implementation

-- Drop existing policies to recreate them properly
DROP POLICY IF EXISTS "Granular access to schools data based on territory" ON public.schools;
DROP POLICY IF EXISTS "Only authenticated managers and superadmins can view schools" ON public.schools;

-- Create the new granular access policy
CREATE POLICY "Granular territory-based access to schools"
ON public.schools FOR SELECT
USING (
  -- Superadmins can see everything
  is_superadmin(auth.uid()) OR
  -- Managers with full access can see everything  
  (is_manager_or_superadmin() AND can_access_school_data()) OR
  -- Regional managers can only see their assigned districts
  (is_manager_or_superadmin() AND can_access_school_data(district))
);

-- Grant access to the masked view for all authenticated users
GRANT SELECT ON public.schools_masked TO authenticated;

-- Create RLS policy for the masked view
CREATE POLICY "Authenticated users can view masked schools data"
ON public.schools_masked FOR SELECT
USING (auth.role() = 'authenticated');

-- Create function to get schools with appropriate masking
CREATE OR REPLACE FUNCTION public.get_schools_with_access_control(
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0,
  p_district_filter text DEFAULT NULL
)
RETURNS SETOF public.schools_masked
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Log the access attempt
  PERFORM log_sensitive_data_access(
    'schools',
    'FILTERED_ACCESS',
    p_limit,
    ARRAY['schools_data_with_masking'],
    CONCAT('Filtered access: district=', COALESCE(p_district_filter, 'ALL'), ', limit=', p_limit)
  );
  
  -- Return filtered and masked data
  RETURN QUERY
  SELECT * FROM public.schools_masked
  WHERE (p_district_filter IS NULL OR district = p_district_filter)
  ORDER BY created_at DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$function$;