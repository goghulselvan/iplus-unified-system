-- Create storage bucket for database backups
INSERT INTO storage.buckets (id, name, public) VALUES ('database-backups', 'database-backups', false);

-- Create policies for database backup storage
CREATE POLICY "Superadmins can manage database backups" 
ON storage.objects 
FOR ALL 
USING (bucket_id = 'database-backups' AND is_superadmin(auth.uid()))
WITH CHECK (bucket_id = 'database-backups' AND is_superadmin(auth.uid()));

-- Create table to track backup metadata
CREATE TABLE public.database_backups (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  filename TEXT NOT NULL,
  file_size BIGINT,
  backup_type TEXT NOT NULL DEFAULT 'daily',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_by UUID NOT NULL,
  storage_path TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'completed'
);

-- Enable RLS on database_backups table
ALTER TABLE public.database_backups ENABLE ROW LEVEL SECURITY;

-- Create policy for database backups table
CREATE POLICY "Superadmins can manage database backup records" 
ON public.database_backups 
FOR ALL 
USING (is_superadmin(auth.uid()))
WITH CHECK (is_superadmin(auth.uid()));

-- Add trigger for updated_at
CREATE TRIGGER update_database_backups_updated_at
BEFORE UPDATE ON public.database_backups
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();