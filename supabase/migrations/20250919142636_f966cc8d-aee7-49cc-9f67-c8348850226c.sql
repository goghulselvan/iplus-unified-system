-- Create storage bucket for database backups if it doesn't exist
INSERT INTO storage.buckets (id, name, public) 
VALUES ('database-backups', 'database-backups', false)
ON CONFLICT (id) DO NOTHING;

-- Create RLS policies for database backup files - only superadmins can access
CREATE POLICY "Superadmins can view backup files" 
ON storage.objects 
FOR SELECT 
USING (bucket_id = 'database-backups' AND is_superadmin(auth.uid()));

CREATE POLICY "System can upload backup files" 
ON storage.objects 
FOR INSERT 
WITH CHECK (bucket_id = 'database-backups');

CREATE POLICY "Superadmins can delete old backup files" 
ON storage.objects 
FOR DELETE 
USING (bucket_id = 'database-backups' AND is_superadmin(auth.uid()));