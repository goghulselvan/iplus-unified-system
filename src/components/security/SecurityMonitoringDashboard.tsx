import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useSecurityMonitoring } from '@/hooks/useSecurityMonitoring';
import { supabase } from '@/integrations/supabase/client';
import { AlertTriangle, Shield, Activity, Clock, Users, Database } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface SecurityMetrics {
  totalLogs: number;
  recentAlerts: number;
  suspiciousActivity: number;
  piiAccess: number;
  bulkOperations: number;
  rateLimitExceeded: number;
}

interface SecurityLog {
  id: string;
  action: string;
  table_name: string;
  created_at: string;
  old_values?: any;
  new_values?: any;
}

export const SecurityMonitoringDashboard: React.FC = () => {
  const [metrics, setMetrics] = useState<SecurityMetrics>({
    totalLogs: 0,
    recentAlerts: 0,
    suspiciousActivity: 0,
    piiAccess: 0,
    bulkOperations: 0,
    rateLimitExceeded: 0
  });
  const [recentLogs, setRecentLogs] = useState<SecurityLog[]>([]);
  const [loading, setLoading] = useState(true);
  const { detectSuspiciousPatterns, cleanupAuditLogs } = useSecurityMonitoring();
  const { toast } = useToast();

  const loadSecurityMetrics = async () => {
    try {
      setLoading(true);
      
      // Get security metrics from the last 24 hours
      const { data: logs, error } = await supabase
        .from('security_audit_logs')
        .select('*')
        .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
        .order('created_at', { ascending: false })
        .limit(100);

      if (error) throw error;

      const newMetrics: SecurityMetrics = {
        totalLogs: logs?.length || 0,
        recentAlerts: logs?.filter(log => 
          log.action.includes('ALERT') || 
          log.action.includes('SUSPICIOUS') ||
          log.action.includes('UNAUTHORIZED')
        ).length || 0,
        suspiciousActivity: logs?.filter(log => 
          log.action.includes('SUSPICIOUS_ACTIVITY')
        ).length || 0,
        piiAccess: logs?.filter(log => 
          log.action.includes('PII_ACCESS')
        ).length || 0,
        bulkOperations: logs?.filter(log => 
          log.action.includes('BULK_OPERATION')
        ).length || 0,
        rateLimitExceeded: logs?.filter(log => 
          log.action.includes('RATE_LIMIT')
        ).length || 0
      };

      setMetrics(newMetrics);
      setRecentLogs(logs?.slice(0, 20) || []);
    } catch (error) {
      console.error('Failed to load security metrics:', error);
      toast({
        title: 'Error',
        description: 'Failed to load security metrics',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const runSuspiciousPatternDetection = async () => {
    try {
      await detectSuspiciousPatterns();
      toast({
        title: 'Success',
        description: 'Suspicious pattern detection completed',
      });
      loadSecurityMetrics();
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to run suspicious pattern detection',
        variant: 'destructive',
      });
    }
  };

  const runCleanup = async () => {
    try {
      await cleanupAuditLogs();
      toast({
        title: 'Success',
        description: 'Audit logs cleanup completed',
      });
      loadSecurityMetrics();
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to cleanup audit logs',
        variant: 'destructive',
      });
    }
  };

  useEffect(() => {
    loadSecurityMetrics();
    
    // Refresh metrics every 5 minutes
    const interval = setInterval(loadSecurityMetrics, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  const getSeverityBadge = (action: string) => {
    if (action.includes('CRITICAL') || action.includes('UNAUTHORIZED')) {
      return <Badge variant="destructive">Critical</Badge>;
    }
    if (action.includes('SUSPICIOUS') || action.includes('RATE_LIMIT')) {
      return <Badge variant="secondary">High</Badge>;
    }
    if (action.includes('BULK') || action.includes('PII')) {
      return <Badge variant="outline">Medium</Badge>;
    }
    return <Badge variant="default">Low</Badge>;
  };

  const formatLogDetails = (log: SecurityLog) => {
    if (log.old_values || log.new_values) {
      const details = { ...(log.old_values || {}), ...(log.new_values || {}) };
      return Object.keys(details).length > 0 ? JSON.stringify(details, null, 2) : 'No details';
    }
    return 'No details';
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Security Monitoring</h2>
          <p className="text-muted-foreground">Monitor and analyze security events in real-time</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={runSuspiciousPatternDetection} variant="outline">
            <AlertTriangle className="w-4 h-4 mr-2" />
            Detect Patterns
          </Button>
          <Button onClick={runCleanup} variant="outline">
            <Database className="w-4 h-4 mr-2" />
            Cleanup Logs
          </Button>
          <Button onClick={loadSecurityMetrics} variant="outline">
            <Activity className="w-4 h-4 mr-2" />
            Refresh
          </Button>
        </div>
      </div>

      {/* Security Alerts */}
      {metrics.recentAlerts > 0 && (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Security Alerts Detected</AlertTitle>
          <AlertDescription>
            {metrics.recentAlerts} security alerts have been detected in the last 24 hours. 
            Please review the activity logs below.
          </AlertDescription>
        </Alert>
      )}

      {/* Metrics Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Security Logs</CardTitle>
            <Shield className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{metrics.totalLogs}</div>
            <p className="text-xs text-muted-foreground">Last 24 hours</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Suspicious Activity</CardTitle>
            <AlertTriangle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{metrics.suspiciousActivity}</div>
            <p className="text-xs text-muted-foreground">Detected patterns</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">PII Access</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{metrics.piiAccess}</div>
            <p className="text-xs text-muted-foreground">Data access events</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Bulk Operations</CardTitle>
            <Database className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{metrics.bulkOperations}</div>
            <p className="text-xs text-muted-foreground">Mass data operations</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Rate Limits</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{metrics.rateLimitExceeded}</div>
            <p className="text-xs text-muted-foreground">Exceeded limits</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Security Alerts</CardTitle>
            <AlertTriangle className="h-4 w-4 text-destructive" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{metrics.recentAlerts}</div>
            <p className="text-xs text-muted-foreground">High priority events</p>
          </CardContent>
        </Card>
      </div>

      {/* Recent Activity */}
      <Tabs defaultValue="recent" className="w-full">
        <TabsList>
          <TabsTrigger value="recent">Recent Activity</TabsTrigger>
          <TabsTrigger value="alerts">Security Alerts</TabsTrigger>
          <TabsTrigger value="pii">PII Access</TabsTrigger>
        </TabsList>

        <TabsContent value="recent" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Recent Security Events</CardTitle>
              <CardDescription>Latest security-related activities</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {recentLogs.length === 0 ? (
                  <p className="text-muted-foreground text-center py-4">No recent security events</p>
                ) : (
                  recentLogs.map((log) => (
                    <div key={log.id} className="flex items-start justify-between p-4 border rounded-lg">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          {getSeverityBadge(log.action)}
                          <span className="font-medium">{log.action}</span>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          Table: {log.table_name} • {new Date(log.created_at).toLocaleString()}
                        </p>
                        {(log.old_values || log.new_values) && (
                          <details className="text-xs">
                            <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                              View Details
                            </summary>
                            <pre className="mt-2 p-2 bg-muted rounded text-xs overflow-auto">
                              {formatLogDetails(log)}
                            </pre>
                          </details>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="alerts" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Security Alerts</CardTitle>
              <CardDescription>High-priority security events requiring attention</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {recentLogs.filter(log => 
                  log.action.includes('ALERT') || 
                  log.action.includes('SUSPICIOUS') ||
                  log.action.includes('UNAUTHORIZED')
                ).length === 0 ? (
                  <p className="text-muted-foreground text-center py-4">No security alerts</p>
                ) : (
                  recentLogs
                    .filter(log => 
                      log.action.includes('ALERT') || 
                      log.action.includes('SUSPICIOUS') ||
                      log.action.includes('UNAUTHORIZED')
                    )
                    .map((log) => (
                      <div key={log.id} className="flex items-start justify-between p-4 border border-destructive rounded-lg">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <Badge variant="destructive">Alert</Badge>
                            <span className="font-medium">{log.action}</span>
                          </div>
                          <p className="text-sm text-muted-foreground">
                            Table: {log.table_name} • {new Date(log.created_at).toLocaleString()}
                          </p>
                          {(log.old_values || log.new_values) && (
                            <details className="text-xs">
                              <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                                View Details
                              </summary>
                              <pre className="mt-2 p-2 bg-muted rounded text-xs overflow-auto">
                                {formatLogDetails(log)}
                              </pre>
                            </details>
                          )}
                        </div>
                      </div>
                    ))
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="pii" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>PII Access Events</CardTitle>
              <CardDescription>Tracking access to personally identifiable information</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {recentLogs.filter(log => log.action.includes('PII_ACCESS')).length === 0 ? (
                  <p className="text-muted-foreground text-center py-4">No PII access events</p>
                ) : (
                  recentLogs
                    .filter(log => log.action.includes('PII_ACCESS'))
                    .map((log) => (
                      <div key={log.id} className="flex items-start justify-between p-4 border rounded-lg">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <Badge variant="outline">PII Access</Badge>
                            <span className="font-medium">{log.action}</span>
                          </div>
                          <p className="text-sm text-muted-foreground">
                            Table: {log.table_name} • {new Date(log.created_at).toLocaleString()}
                          </p>
                          {(log.old_values || log.new_values) && (
                            <details className="text-xs">
                              <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                                View Accessed Columns
                              </summary>
                              <pre className="mt-2 p-2 bg-muted rounded text-xs overflow-auto">
                                {formatLogDetails(log)}
                              </pre>
                            </details>
                          )}
                        </div>
                      </div>
                    ))
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};