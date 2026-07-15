import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface BackupFile {
  id: string;
  filename: string;
  file_size: number;
  created_at: string;
  storage_path: string;
  backup_type: string;
  status: string;
}

export const useDatabaseBackups = () => {
  const [backups, setBackups] = useState<BackupFile[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchBackups = async () => {
    try {
      const { data, error } = await supabase
        .from('database_backups')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error fetching backups:', error);
        toast.error('Failed to fetch backup files');
        return;
      }

      setBackups(data || []);
    } catch (error) {
      console.error('Error fetching backups:', error);
      toast.error('Failed to fetch backup files');
    } finally {
      setLoading(false);
    }
  };

  const downloadBackup = async (backup: BackupFile) => {
    try {
      toast.info('Downloading backup file...');
      
      const { data, error } = await supabase.storage
        .from('database-backups')
        .download(backup.storage_path);

      if (error) {
        console.error('Error downloading backup:', error);
        toast.error('Failed to download backup file');
        return;
      }

      // Backups are stored gzip-compressed (see database-backup edge
      // function) — decompress client-side so the downloaded file is
      // plain readable JSON, matching the pre-compression UX.
      const decompressedStream = data.stream().pipeThrough(new DecompressionStream('gzip'));
      const decompressedBlob = await new Response(decompressedStream).blob();

      const url = URL.createObjectURL(decompressedBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = backup.filename.replace(/\.gz$/, '');
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast.success('Backup file downloaded successfully');
    } catch (error) {
      console.error('Error downloading backup:', error);
      toast.error('Failed to download backup file');
    }
  };

  const triggerBackup = async () => {
    try {
      toast.info('Triggering manual backup...');
      
      // Get the current session to include auth token
      const { data: { session } } = await supabase.auth.getSession();
      
      if (!session) {
        toast.error('You must be logged in to trigger backups');
        return;
      }

      const { data, error } = await supabase.functions.invoke('database-backup', {
        body: { manual: true },
        headers: {
          Authorization: `Bearer ${session.access_token}`
        }
      });

      if (error) {
        console.error('Error triggering backup:', error);
        
        // Check if there's a response body with error details
        const errorMessage = error.message || '';
        
        if (errorMessage.includes('Rate limit') || errorMessage.includes('429')) {
          toast.error('Rate limit exceeded. Please wait at least 1 hour between backups.');
        } else if (errorMessage.includes('permissions') || errorMessage.includes('superadmin')) {
          toast.error('Insufficient permissions. Only superadmins can perform backups.');
        } else if (errorMessage.includes('authorization')) {
          toast.error('Authentication required. Please log in again.');
        } else {
          toast.error('Failed to trigger backup');
        }
        return;
      }

      // Check if the response indicates failure (edge function returned success:false)
      if (data && data.success === false) {
        const errorMsg = data.error || 'Backup failed';
        if (errorMsg.includes('Rate limit')) {
          toast.error('Rate limit exceeded. Please wait at least 1 hour between backups.');
        } else {
          toast.error(errorMsg);
        }
        return;
      }

      toast.success('Manual backup completed successfully');
      fetchBackups(); // Refresh the list
    } catch (error) {
      console.error('Error triggering backup:', error);
      toast.error('Failed to trigger backup');
    }
  };

  useEffect(() => {
    fetchBackups();
  }, []);

  return {
    backups,
    loading,
    fetchBackups,
    downloadBackup,
    triggerBackup
  };
};