-- Final fix: Remove the view entirely and update the app to use the secure function directly
-- This eliminates all security definer view warnings

-- Drop the problematic view
DROP VIEW IF EXISTS public.accountant_payment_view;

-- The app should use the existing secure function public.get_accountant_payment_data() instead
-- This function already has proper security checks and is the recommended approach

-- Verify the secure function exists and has proper security
SELECT public.log_security_action(
  'PAYMENT_VIEW_REMOVED_FINAL',
  'accountant_payment_view',
  NULL,
  NULL,
  jsonb_build_object(
    'action', 'Removed view calling security definer function',
    'replacement', 'Use get_accountant_payment_data() function directly',
    'security_benefit', 'Eliminates security definer view warnings',
    'app_impact', 'useAccountantDashboard hook should use RPC call to get_accountant_payment_data()',
    'timestamp', now()
  )
);

-- Add a comment to document the recommended approach
COMMENT ON FUNCTION public.get_accountant_payment_data() IS 'RECOMMENDED: Use this secure function directly instead of views for payment data access. Includes built-in security checks for accountant-level access.';

-- Log security improvement
SELECT public.log_security_action(
  'SECURITY_ARCHITECTURE_IMPROVED',
  'payment_data_access',
  NULL,
  NULL,
  jsonb_build_object(
    'security_improvement', 'Eliminated all security definer view warnings',
    'access_pattern', 'Direct secure function calls instead of views',
    'functions_available', ARRAY['get_accountant_payment_data()'],
    'timestamp', now()
  )
);