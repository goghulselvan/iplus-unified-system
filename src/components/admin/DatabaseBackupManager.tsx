import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Download, Database, RefreshCw, Clock, User } from 'lucide-react';
import { useDatabaseBackups, BackupFile } from '@/hooks/useDatabaseBackups';
import { format, isAfter, subDays } from 'date-fns';

const DatabaseBackupManager: React.FC = () => {
  const { backups, loading, downloadBackup, triggerBackup } = useDatabaseBackups();

  const formatFileSize = (bytes: number) => {
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    if (bytes === 0) return '0 Byte';
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return Math.round((bytes / Math.pow(1024, i)) * 100) / 100 + ' ' + sizes[i];
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'completed':
        return <Badge variant="default">Completed</Badge>;
      case 'failed':
        return <Badge variant="destructive">Failed</Badge>;
      case 'in_progress':
        return <Badge variant="secondary">In Progress</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  // Separate backups by type
  const automaticBackups = backups.filter(b => b.backup_type === 'daily');
  const manualBackups = backups.filter(b => b.backup_type === 'manual');

  // Filter automatic backups to show only last 30 days
  const thirtyDaysAgo = subDays(new Date(), 30);
  const recentAutomaticBackups = automaticBackups.filter(b =>
    isAfter(new Date(b.created_at), thirtyDaysAgo)
  );

  const renderBackupTable = (backupList: BackupFile[]) => {
    if (backupList.length === 0) {
      return (
        <div className="text-center py-6 text-muted-foreground">
          No backups found in this category.
        </div>
      );
    }

    return (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Filename</TableHead>
            <TableHead>Size</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Created</TableHead>
            <TableHead>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {backupList.map((backup) => (
            <TableRow key={backup.id}>
              <TableCell className="font-medium">
                {backup.filename}
              </TableCell>
              <TableCell>
                {formatFileSize(backup.file_size)}
              </TableCell>
              <TableCell>
                {getStatusBadge(backup.status)}
              </TableCell>
              <TableCell>
                {format(new Date(backup.created_at), 'MMM dd, yyyy HH:mm')}
              </TableCell>
              <TableCell>
                <div className="flex gap-2">
                  <Button
                    variant="default"
                    size="sm"
                    onClick={() => downloadBackup(backup)}
                    disabled={backup.status !== 'completed'}
                    className="bg-green-600 hover:bg-green-700 text-white"
                  >
                    <RefreshCw className="h-4 w-4 mr-1" />
                    Restore
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => downloadBackup(backup)}
                    disabled={backup.status !== 'completed'}
                  >
                    <Download className="h-4 w-4 mr-1" />
                    Download
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    );
  };

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="h-5 w-5" />
            Database Backups
          </CardTitle>
          <CardDescription>
            Loading backup files...
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <RefreshCw className="h-6 w-6 animate-spin" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Automatic Backups Section */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Clock className="h-5 w-5" />
                Automatic Backups
              </CardTitle>
              <CardDescription>
                Daily backups at 11:59 PM IST. <strong>Retention:</strong> Last 30 days only (older backups are auto-deleted).
              </CardDescription>
            </div>
            <Badge variant="outline" className="text-sm">
              {recentAutomaticBackups.length} backup{recentAutomaticBackups.length !== 1 ? 's' : ''}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          {renderBackupTable(recentAutomaticBackups)}
        </CardContent>
      </Card>

      {/* Manual Backups Section */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <User className="h-5 w-5" />
                Manual Backups
              </CardTitle>
              <CardDescription>
                On-demand backups created by superadmins. <strong>Retention:</strong> Stored forever — cannot be deleted by anyone, including superadmins.
              </CardDescription>
            </div>
            <div className="flex items-center gap-3">
              <Badge variant="outline" className="text-sm">
                {manualBackups.length} backup{manualBackups.length !== 1 ? 's' : ''}
              </Badge>
              <Button onClick={triggerBackup} variant="default">
                <Database className="h-4 w-4 mr-2" />
                Create Manual Backup
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {renderBackupTable(manualBackups)}
        </CardContent>
      </Card>
    </div>
  );
};

export default DatabaseBackupManager;