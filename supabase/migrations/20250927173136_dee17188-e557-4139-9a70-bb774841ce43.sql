-- First get Tamil Nadu state code
-- Insert new test district with district code 100
INSERT INTO public.district_codes (state_code, district_name, district_code)
VALUES ('33', 'Test District', '100');

-- Also insert into districts table for consistency
INSERT INTO public.districts (state_id, district_name, district_code)
SELECT s.id, 'Test District', '100'
FROM public.states s
WHERE UPPER(TRIM(s.state_name)) = 'TAMIL NADU';