-- Fix Security Definer View Issue - Simplified Approach
-- Remove the problematic schools_masked view that uses SECURITY DEFINER functions

-- Drop the schools_masked view that causes the security issue
DROP VIEW IF EXISTS public.schools_masked;

-- We don't need to recreate this view since the frontend can query
-- the schools table directly with the existing RLS policies
-- which properly handle access control without bypassing user permissions

-- The existing RLS policy "Complete schools access control" on the schools table
-- already provides proper access control for managers and superadmins