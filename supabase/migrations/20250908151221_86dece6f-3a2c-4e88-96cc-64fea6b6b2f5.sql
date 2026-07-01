-- Add missing boards that exist in schools data but not in boards table

INSERT INTO public.boards (board_name, board_code, is_active, created_by)
VALUES 
  ('TN-N&P', 'TN_NANDP_001', true, (SELECT id FROM auth.users LIMIT 1))
ON CONFLICT (board_name) DO NOTHING;