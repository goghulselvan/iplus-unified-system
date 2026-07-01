-- Fix the relationship between state_codes and district_codes tables
-- Add foreign key constraint to properly link districts to states

ALTER TABLE public.district_codes 
ADD CONSTRAINT fk_district_state_code 
FOREIGN KEY (state_code) REFERENCES public.state_codes(state_code);

-- Update the queries to use proper joins without the complex inner join syntax
-- The TypeScript errors are occurring because the relationship isn't properly defined