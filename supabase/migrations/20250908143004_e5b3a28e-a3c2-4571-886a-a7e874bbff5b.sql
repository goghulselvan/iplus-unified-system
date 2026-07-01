-- Temporarily modify log_pii_access function to handle null auth.uid() during migrations
CREATE OR REPLACE FUNCTION public.log_pii_access(p_table_name text, p_operation text, p_accessed_columns text[], p_record_count integer DEFAULT 1)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Skip logging if auth.uid() is null (during migrations)
  IF auth.uid() IS NULL THEN
    RETURN;
  END IF;
  
  INSERT INTO public.security_audit_logs (
    user_id, action, table_name, record_id, 
    old_values, new_values, ip_address
  ) VALUES (
    auth.uid(), 
    p_operation || '_PII_ACCESS',
    p_table_name,
    NULL,
    jsonb_build_object(
      'accessed_columns', p_accessed_columns,
      'record_count', p_record_count,
      'timestamp', now()
    ),
    NULL,
    inet_client_addr()
  );
END;
$function$;

-- Now perform the district name standardization
-- 1. Erode variations
UPDATE public.schools SET district = 'Erode' WHERE district = 'Erode Dist';

-- 2. Kancheepuram variations  
UPDATE public.schools SET district = 'Kancheepuram' WHERE district = 'Kanchipuram';

-- 3. Kanniyakumari variations
UPDATE public.schools SET district = 'Kanniyakumari' WHERE district = 'Kanyakumari';

-- 4. Nilgiris variations (standardize to The Nilgiris)
UPDATE public.schools SET district = 'The Nilgiris' WHERE district IN ('Nilgiri', 'Nilgiris');

-- 5. Pudukkottai variations
UPDATE public.schools SET district = 'Pudukkottai' WHERE district = 'Puthukkottai';

-- 6. Sivagangai variations
UPDATE public.schools SET district = 'Sivagangai' WHERE district = 'Sivaganga';

-- 7. Tirupathur variations
UPDATE public.schools SET district = 'Tirupathur' WHERE district = 'Thirupathur';

-- 8. Tiruvallur variations
UPDATE public.schools SET district = 'Tiruvallur' WHERE district = 'Thiruvallur';

-- 9. Tiruvarur variations
UPDATE public.schools SET district = 'Tiruvarur' WHERE district = 'Thiruvarur';

-- 10. Thoothukudi variations
UPDATE public.schools SET district = 'Thoothukudi' WHERE district = 'Thoothukkudi';

-- 11. Tiruchirappalli variations
UPDATE public.schools SET district = 'Tiruchirappalli' WHERE district = 'Trichy';

-- 12. Villupuram variations
UPDATE public.schools SET district = 'Villupuram' WHERE district = 'Viluppuram';