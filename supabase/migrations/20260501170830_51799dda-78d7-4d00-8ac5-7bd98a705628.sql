ALTER PUBLICATION supabase_realtime ADD TABLE public.students;
ALTER TABLE public.students REPLICA IDENTITY FULL;