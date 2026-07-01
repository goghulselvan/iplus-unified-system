-- Update business hours to include Monday to Saturday (9 AM to 6 PM IST)
CREATE OR REPLACE FUNCTION public.is_business_hours()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT EXTRACT(HOUR FROM NOW() AT TIME ZONE 'Asia/Kolkata') BETWEEN 9 AND 18
  AND EXTRACT(DOW FROM NOW() AT TIME ZONE 'Asia/Kolkata') BETWEEN 1 AND 6;
$$;