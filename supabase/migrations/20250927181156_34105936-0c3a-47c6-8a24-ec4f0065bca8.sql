-- Fix search path for the new function
ALTER FUNCTION public.normalize_to_title_case(text) SET search_path = public;

-- Fix search path for the search function  
ALTER FUNCTION public.search_schools_case_insensitive(text, text, text, text, text, text, text, integer, integer) SET search_path = public;