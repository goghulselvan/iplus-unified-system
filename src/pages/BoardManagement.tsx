import { useState } from 'react';
import Navbar from '@/components/layout/Navbar';
import BoardManagement from '@/components/admin/BoardManagement';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const BoardManagementPage = () => {
  const { profile } = useAuth();

  if (profile?.role !== 'superadmin') {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <Card>
            <CardHeader>
              <CardTitle>Access Denied</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground">
                Only super administrators can access the board management page.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-foreground">System Administration</h1>
          <p className="text-muted-foreground mt-2">
            Manage boards and system configurations
          </p>
        </div>
        
        <BoardManagement />
      </div>
    </div>
  );
};

export default BoardManagementPage;