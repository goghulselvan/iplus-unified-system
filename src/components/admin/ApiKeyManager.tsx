import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { Key, Plus, Copy, Trash2, RefreshCw, Eye, EyeOff, AlertTriangle, FileText, Activity, Clock } from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';

interface ApiKey {
  id: string;
  name: string;
  key_prefix: string;
  description: string | null;
  is_active: boolean;
  last_used_at: string | null;
  expires_at: string | null;
  created_at: string;
}

interface ApiLog {
  id: string;
  api_key_id: string;
  endpoint: string;
  ip_address: string | null;
  response_status: number;
  response_time_ms: number;
  registration_numbers_count: number;
  created_at: string;
  api_keys: { name: string } | null;
}

// Generate a secure random API key
function generateApiKey(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const prefix = 'iplus_';
  let key = prefix;
  for (let i = 0; i < 40; i++) {
    key += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return key;
}

// Simple hash function for storing (in production, use a proper crypto library)
async function hashKey(key: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(key);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export function ApiKeyManager() {
  const queryClient = useQueryClient();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [isLogsOpen, setIsLogsOpen] = useState(false);
  const [selectedKey, setSelectedKey] = useState<ApiKey | null>(null);
  const [selectedKeyForLogs, setSelectedKeyForLogs] = useState<string>('all');
  const [newKeyData, setNewKeyData] = useState({ name: '', description: '' });
  const [generatedKey, setGeneratedKey] = useState<string | null>(null);
  const [showKey, setShowKey] = useState(false);

  // Fetch API keys
  const { data: apiKeys = [], isLoading } = useQuery({
    queryKey: ['api-keys'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('api_keys')
        .select('*')
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      return data as ApiKey[];
    },
  });

  // Fetch API logs
  const { data: apiLogs = [], isLoading: logsLoading, refetch: refetchLogs } = useQuery({
    queryKey: ['api-logs', selectedKeyForLogs],
    queryFn: async () => {
      let query = supabase
        .from('api_request_logs')
        .select('*, api_keys(name)')
        .order('created_at', { ascending: false })
        .limit(100);
      
      if (selectedKeyForLogs !== 'all') {
        query = query.eq('api_key_id', selectedKeyForLogs);
      }
      
      const { data, error } = await query;
      if (error) throw error;
      return data as ApiLog[];
    },
    enabled: isLogsOpen,
  });

  // Calculate stats
  const logsStats = {
    total: apiLogs.length,
    successRate: apiLogs.length > 0 
      ? Math.round((apiLogs.filter(l => l.response_status === 200).length / apiLogs.length) * 100)
      : 0,
    avgResponseTime: apiLogs.length > 0
      ? Math.round(apiLogs.reduce((sum, l) => sum + l.response_time_ms, 0) / apiLogs.length)
      : 0,
  };

  // Create API key mutation
  const createKeyMutation = useMutation({
    mutationFn: async ({ name, description }: { name: string; description: string }) => {
      const key = generateApiKey();
      const keyHash = await hashKey(key);
      const keyPrefix = key.substring(0, 12) + '...';

      const { data: { user } } = await supabase.auth.getUser();
      
      const { error } = await supabase.from('api_keys').insert({
        name,
        description: description || null,
        key_hash: keyHash,
        key_prefix: keyPrefix,
        created_by: user?.id,
      });

      if (error) throw error;
      return key;
    },
    onSuccess: (key) => {
      setGeneratedKey(key);
      setShowKey(true);
      queryClient.invalidateQueries({ queryKey: ['api-keys'] });
      toast.success('API key created successfully');
    },
    onError: (error) => {
      console.error('Error creating API key:', error);
      toast.error('Failed to create API key');
    },
  });

  // Toggle API key status
  const toggleStatusMutation = useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      const { error } = await supabase
        .from('api_keys')
        .update({ is_active: isActive })
        .eq('id', id);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['api-keys'] });
      toast.success('API key status updated');
    },
    onError: () => {
      toast.error('Failed to update API key status');
    },
  });

  // Delete API key mutation
  const deleteKeyMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('api_keys').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['api-keys'] });
      toast.success('API key deleted');
      setIsDeleteOpen(false);
      setSelectedKey(null);
    },
    onError: () => {
      toast.error('Failed to delete API key');
    },
  });

  const handleCreate = () => {
    if (!newKeyData.name.trim()) {
      toast.error('Please enter a name for the API key');
      return;
    }
    createKeyMutation.mutate(newKeyData);
  };

  const handleCopyKey = () => {
    if (generatedKey) {
      navigator.clipboard.writeText(generatedKey);
      toast.success('API key copied to clipboard');
    }
  };

  const handleCloseCreate = () => {
    setIsCreateOpen(false);
    setNewKeyData({ name: '', description: '' });
    setGeneratedKey(null);
    setShowKey(false);
  };

  const handleViewLogsForKey = (keyId: string) => {
    setSelectedKeyForLogs(keyId);
    setIsLogsOpen(true);
  };

  const getResponseTimeColor = (ms: number) => {
    if (ms < 1000) return 'text-green-600';
    if (ms < 3000) return 'text-yellow-600';
    return 'text-red-600';
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Key className="h-5 w-5" />
            <div>
              <CardTitle>API Key Management</CardTitle>
              <CardDescription>
                Generate and manage API keys for external integrations
              </CardDescription>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => { setSelectedKeyForLogs('all'); setIsLogsOpen(true); }}>
              <FileText className="h-4 w-4 mr-2" />
              View Logs
            </Button>
            <Button onClick={() => setIsCreateOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Create API Key
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="text-center py-8 text-muted-foreground">Loading...</div>
        ) : apiKeys.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            No API keys created yet. Create one to enable external integrations.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Key</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last Used</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {apiKeys.map((apiKey) => (
                <TableRow key={apiKey.id}>
                  <TableCell>
                    <div>
                      <div className="font-medium">{apiKey.name}</div>
                      {apiKey.description && (
                        <div className="text-sm text-muted-foreground">
                          {apiKey.description}
                        </div>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <code className="text-sm bg-muted px-2 py-1 rounded">
                      {apiKey.key_prefix}
                    </code>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={apiKey.is_active}
                        onCheckedChange={(checked) =>
                          toggleStatusMutation.mutate({ id: apiKey.id, isActive: checked })
                        }
                      />
                      <Badge variant={apiKey.is_active ? 'default' : 'secondary'}>
                        {apiKey.is_active ? 'Active' : 'Inactive'}
                      </Badge>
                    </div>
                  </TableCell>
                  <TableCell>
                    {apiKey.last_used_at
                      ? format(new Date(apiKey.last_used_at), 'MMM d, yyyy HH:mm')
                      : 'Never'}
                  </TableCell>
                  <TableCell>
                    {format(new Date(apiKey.created_at), 'MMM d, yyyy')}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleViewLogsForKey(apiKey.id)}
                        title="View logs for this key"
                      >
                        <Activity className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                          setSelectedKey(apiKey);
                          setIsDeleteOpen(true);
                        }}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        {/* Create API Key Dialog */}
        <Dialog open={isCreateOpen} onOpenChange={handleCloseCreate}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>
                {generatedKey ? 'API Key Created' : 'Create New API Key'}
              </DialogTitle>
              <DialogDescription>
                {generatedKey
                  ? 'Copy your API key now. You won\'t be able to see it again!'
                  : 'Create a new API key for external integrations.'}
              </DialogDescription>
            </DialogHeader>

            {!generatedKey ? (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Name *</Label>
                  <Input
                    id="name"
                    placeholder="e.g., Results Software Integration"
                    value={newKeyData.name}
                    onChange={(e) =>
                      setNewKeyData({ ...newKeyData, name: e.target.value })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="description">Description</Label>
                  <Textarea
                    id="description"
                    placeholder="What is this API key for?"
                    value={newKeyData.description}
                    onChange={(e) =>
                      setNewKeyData({ ...newKeyData, description: e.target.value })
                    }
                  />
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                  <AlertTriangle className="h-5 w-5 text-amber-600 flex-shrink-0" />
                  <p className="text-sm text-amber-800">
                    Make sure to copy your API key now. You won't be able to see it again!
                  </p>
                </div>
                <div className="space-y-2">
                  <Label>Your API Key</Label>
                  <div className="flex gap-2">
                    <div className="flex-1 relative">
                      <Input
                        readOnly
                        type={showKey ? 'text' : 'password'}
                        value={generatedKey}
                        className="pr-10 font-mono text-sm"
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        className="absolute right-0 top-0"
                        onClick={() => setShowKey(!showKey)}
                      >
                        {showKey ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                    <Button onClick={handleCopyKey}>
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>
            )}

            <DialogFooter>
              {!generatedKey ? (
                <>
                  <Button variant="outline" onClick={handleCloseCreate}>
                    Cancel
                  </Button>
                  <Button
                    onClick={handleCreate}
                    disabled={createKeyMutation.isPending}
                  >
                    {createKeyMutation.isPending ? (
                      <>
                        <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                        Creating...
                      </>
                    ) : (
                      'Create Key'
                    )}
                  </Button>
                </>
              ) : (
                <Button onClick={handleCloseCreate}>Done</Button>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* API Logs Dialog */}
        <Dialog open={isLogsOpen} onOpenChange={setIsLogsOpen}>
          <DialogContent className="sm:max-w-4xl max-h-[80vh] overflow-hidden flex flex-col">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                API Request Logs
              </DialogTitle>
              <DialogDescription>
                View API request history and performance metrics
              </DialogDescription>
            </DialogHeader>

            <div className="flex items-center justify-between gap-4">
              <Select value={selectedKeyForLogs} onValueChange={setSelectedKeyForLogs}>
                <SelectTrigger className="w-[200px]">
                  <SelectValue placeholder="Filter by API key" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All API Keys</SelectItem>
                  {apiKeys.map((key) => (
                    <SelectItem key={key.id} value={key.id}>
                      {key.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button variant="outline" size="sm" onClick={() => refetchLogs()}>
                <RefreshCw className="h-4 w-4 mr-2" />
                Refresh
              </Button>
            </div>

            {/* Stats Cards */}
            <div className="grid grid-cols-3 gap-4">
              <div className="p-4 border rounded-lg text-center">
                <div className="text-2xl font-bold">{logsStats.total}</div>
                <div className="text-sm text-muted-foreground flex items-center justify-center gap-1">
                  <Activity className="h-4 w-4" />
                  Requests
                </div>
              </div>
              <div className="p-4 border rounded-lg text-center">
                <div className="text-2xl font-bold text-green-600">{logsStats.successRate}%</div>
                <div className="text-sm text-muted-foreground">Success Rate</div>
              </div>
              <div className="p-4 border rounded-lg text-center">
                <div className={`text-2xl font-bold ${getResponseTimeColor(logsStats.avgResponseTime)}`}>
                  {logsStats.avgResponseTime}ms
                </div>
                <div className="text-sm text-muted-foreground flex items-center justify-center gap-1">
                  <Clock className="h-4 w-4" />
                  Avg Time
                </div>
              </div>
            </div>

            {/* Logs Table */}
            <div className="flex-1 overflow-auto border rounded-lg">
              {logsLoading ? (
                <div className="text-center py-8 text-muted-foreground">Loading logs...</div>
              ) : apiLogs.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  No API requests logged yet.
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Time</TableHead>
                      <TableHead>API Key</TableHead>
                      <TableHead>Endpoint</TableHead>
                      <TableHead className="text-center">Found</TableHead>
                      <TableHead className="text-center">Status</TableHead>
                      <TableHead className="text-right">Response Time</TableHead>
                      <TableHead>IP Address</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {apiLogs.map((log) => (
                      <TableRow key={log.id}>
                        <TableCell className="whitespace-nowrap">
                          <span title={format(new Date(log.created_at), 'PPpp')}>
                            {formatDistanceToNow(new Date(log.created_at), { addSuffix: true })}
                          </span>
                        </TableCell>
                        <TableCell>
                          <span className="font-medium">{log.api_keys?.name || 'Unknown'}</span>
                        </TableCell>
                        <TableCell>
                          <code className="text-xs bg-muted px-1.5 py-0.5 rounded">
                            {log.endpoint}
                          </code>
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge variant="outline">{log.registration_numbers_count}</Badge>
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge variant={log.response_status === 200 ? 'default' : 'destructive'}>
                            {log.response_status}
                          </Badge>
                        </TableCell>
                        <TableCell className={`text-right font-mono ${getResponseTimeColor(log.response_time_ms)}`}>
                          {log.response_time_ms}ms
                        </TableCell>
                        <TableCell className="text-muted-foreground text-sm">
                          {log.ip_address || '-'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>

            <div className="text-sm text-muted-foreground">
              Showing {apiLogs.length} of last 100 logs
            </div>
          </DialogContent>
        </Dialog>

        {/* Delete Confirmation Dialog */}
        <AlertDialog open={isDeleteOpen} onOpenChange={setIsDeleteOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete API Key</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to delete the API key "{selectedKey?.name}"?
                This action cannot be undone and any integrations using this key will stop working.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={() => selectedKey && deleteKeyMutation.mutate(selectedKey.id)}
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}
