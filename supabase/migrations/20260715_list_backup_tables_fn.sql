-- 20260715_list_backup_tables_fn.sql
CREATE OR REPLACE FUNCTION public.list_backup_tables()
RETURNS SETOF text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT table_name
  FROM information_schema.tables
  WHERE table_schema = 'public'
    AND table_type = 'BASE TABLE'
  ORDER BY table_name;
$$;

REVOKE EXECUTE ON FUNCTION public.list_backup_tables() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_backup_tables() TO service_role;
