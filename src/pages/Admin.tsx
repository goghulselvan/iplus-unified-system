import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import Navbar from '@/components/layout/Navbar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Database,
  FileText,
  Settings,
  Layout,
  Shield,
  Key,
  School,
  BarChart3,
  CreditCard,
} from 'lucide-react';
import { format } from 'date-fns';
import { useDatabaseBackups } from '@/hooks/useDatabaseBackups';
import DatabaseBackupManager from '@/components/admin/DatabaseBackupManager';
import { RegistrationFormatManager } from '@/components/admin/RegistrationFormatManager';

import { AuditLogExporter } from '@/components/admin/AuditLogExporter';
import { PaymentRecalculator } from '@/components/admin/PaymentRecalculator';
import { ApiKeyManager } from '@/components/admin/ApiKeyManager';
import { useActiveProject } from '@/hooks/useOlympiadProjects';
import { RegistrationApproval } from '@/components/portal/RegistrationApproval';
import { PortalResultsRelease } from '@/components/portal/PortalResultsRelease';
import { PaymentQueue } from '@/components/portal/PaymentQueue';
import BoardManagement from '@/components/admin/BoardManagement';

const Admin = () => {
  const navigate = useNavigate();
  const { user, profile } = useAuth();
  const { backups, loading, downloadBackup, deleteBackup, triggerBackup } = useDatabaseBackups();
  const { data: activeProject } = useActiveProject();

  // Check if user is superadmin
  useEffect(() => {
    if (profile && profile.role !== 'superadmin') {
      navigate('/dashboard');
      return;
    }
  }, [profile, navigate]);

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const isWithinLast7Days = (dateString: string) => {
    const backupDate = new Date(dateString);
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    return backupDate >= sevenDaysAgo;
  };

  const last7DaysBackups = backups.filter(backup => isWithinLast7Days(backup.created_at));
  const olderBackups = backups.filter(backup => !isWithinLast7Days(backup.created_at));

  const getDaysAgo = (dateString: string) => {
    const backupDate = new Date(dateString);
    const today = new Date();
    const diffTime = Math.abs(today.getTime() - backupDate.getTime());
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    return `${diffDays} days ago`;
  };

  if (profile?.role !== 'superadmin') {
    return null;
  }

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl font-bold text-foreground">Admin Panel</h1>
            <p className="text-muted-foreground mt-2">
              System administration and database management
            </p>
          </div>
        </div>

        <Tabs defaultValue="portal-results" className="space-y-6">
          <TabsList className="grid w-full grid-cols-7">
            <TabsTrigger value="portal-results" className="flex items-center gap-2">
              <BarChart3 className="h-4 w-4" />
              Release Results
            </TabsTrigger>
            <TabsTrigger value="backups" className="flex items-center gap-2">
              <Database className="h-4 w-4" />
              Backups
            </TabsTrigger>
            <TabsTrigger value="format" className="flex items-center gap-2">
              <Layout className="h-4 w-4" />
              Reg Format
            </TabsTrigger>
            <TabsTrigger value="api-keys" className="flex items-center gap-2">
              <Key className="h-4 w-4" />
              API Keys
            </TabsTrigger>
            <TabsTrigger value="audit" className="flex items-center gap-2">
              <FileText className="h-4 w-4" />
              Audit Logs
            </TabsTrigger>
            <TabsTrigger value="boards" className="flex items-center gap-2">
              <School className="h-4 w-4" />
              Boards
            </TabsTrigger>
            <TabsTrigger value="system" className="flex items-center gap-2">
              <Settings className="h-4 w-4" />
              System
            </TabsTrigger>
          </TabsList>

          <TabsContent value="portal-results" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Release Results to Schools</CardTitle>
              </CardHeader>
              <CardContent>
                <PortalResultsRelease />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="backups" className="space-y-6">
            <DatabaseBackupManager />
          </TabsContent>


          <TabsContent value="format" className="space-y-6">
            {activeProject ? (
              <RegistrationFormatManager projectId={activeProject.id} />
            ) : (
              <Card>
                <CardHeader>
                  <CardTitle>Registration Format Configuration</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-muted-foreground">
                    Please set an active project to configure registration number format.
                  </p>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="api-keys" className="space-y-6">
            <ApiKeyManager />
          </TabsContent>



          <TabsContent value="audit" className="space-y-6">
            <AuditLogExporter />
          </TabsContent>

          <TabsContent value="boards" className="space-y-6">
            <BoardManagement />
          </TabsContent>

          <TabsContent value="system" className="space-y-6">
            <PaymentRecalculator />
            
            <Card>
              <CardHeader>
                <CardTitle>System Logs</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground">System logs coming soon...</p>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
};

export default Admin;