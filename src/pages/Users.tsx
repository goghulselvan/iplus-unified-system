import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Profile } from '@/types/database';
import { useAuth } from '@/hooks/useAuth';
import Navbar from '@/components/layout/Navbar';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { Plus, Trash2, KeyRound, Shield, MapPin, MessageSquare, ChevronDown, ChevronUp, Pencil, UserPlus } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

const ALL_MODULES: { key: string; label: string; description: string }[] = [
  { key: 'schools', label: 'Schools', description: 'View and manage school records' },
  { key: 'students', label: 'Students', description: 'View and manage student registrations' },
  { key: 'evaluation', label: 'Evaluation', description: 'Upload and process answer sheets' },
  { key: 'question_papers', label: 'Question Papers', description: 'Manage exam question papers' },
  { key: 'results', label: 'Results', description: 'View and generate student results/reports' },
  { key: 'school_results', label: 'School Results', description: 'School-level analysis and ZIP downloads' },
  { key: 'awards', label: 'Awards', description: 'Manage student awards and certificates' },
];

const DEFAULT_MODULE_ACCESS: Record<string, Record<string, boolean>> = {
  manager: { schools: true },
  accountant: { schools: true },
  superadmin: Object.fromEntries(ALL_MODULES.map(m => [m.key, true])),
};

const ROLE_COLORS: Record<string, string> = {
  superadmin: 'bg-purple-100 text-purple-800 border-purple-200',
  manager: 'bg-blue-100 text-blue-800 border-blue-200',
  accountant: 'bg-green-100 text-green-800 border-green-200',
};

const emptyCreateForm = {
  email: '',
  password: '',
  username: '',
  fullName: '',
  role: 'manager' as 'manager' | 'superadmin' | 'accountant',
  dataAccessLevel: 'limited' as 'limited' | 'regional' | 'full',
  assignedDistricts: [] as string[],
};

const Users = () => {
  const { profile: currentProfile } = useAuth();
  const { toast } = useToast();

  const [users, setUsers] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [availableDistricts, setAvailableDistricts] = useState<string[]>([]);

  // Create dialog
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState(emptyCreateForm);
  const [creating, setCreating] = useState(false);

  // Edit dialog
  const [editOpen, setEditOpen] = useState(false);
  const [editUser, setEditUser] = useState<Profile | null>(null);
  const [editForm, setEditForm] = useState({ fullName: '', username: '', role: 'manager' as Profile['role'], dataAccessLevel: 'limited' as 'limited' | 'regional' | 'full' });
  const [saving, setSaving] = useState(false);

  // Regional districts dialog
  const [regionalOpen, setRegionalOpen] = useState(false);
  const [regionalTarget, setRegionalTarget] = useState<{ userId: string; username: string } | null>(null);
  const [regionalDistricts, setRegionalDistricts] = useState<string[]>([]);

  // Change password dialog
  const [pwdOpen, setPwdOpen] = useState(false);
  const [pwdUser, setPwdUser] = useState<Profile | null>(null);
  const [pwdForm, setPwdForm] = useState({ newPassword: '', confirmPassword: '' });
  const [changingPwd, setChangingPwd] = useState(false);

  // Module permissions
  const [modulePerms, setModulePerms] = useState<Record<string, Record<string, boolean>>>({});
  const [expandedUser, setExpandedUser] = useState<string | null>(null);
  const [savingModules, setSavingModules] = useState<string | null>(null);

  useEffect(() => {
    fetchUsers();
    fetchDistricts();
  }, []);

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .not('user_id', 'is', null)
        .order('created_at', { ascending: true });
      if (error) throw error;
      setUsers((data as Profile[]) || []);
    } catch (err: any) {
      toast({ title: 'Error', description: 'Failed to fetch users', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const fetchDistricts = async () => {
    const { data } = await supabase.from('schools').select('district').not('district', 'is', null);
    const unique = [...new Set((data ?? []).map(s => s.district).filter(Boolean))] as string[];
    setAvailableDistricts(unique.sort());
  };

  const fetchModulePerms = useCallback(async (userId: string) => {
    const { data } = await supabase
      .from('module_permissions')
      .select('module_name, has_access')
      .eq('user_id', userId);
    const map: Record<string, boolean> = {};
    (data ?? []).forEach(r => { map[r.module_name] = r.has_access; });
    setModulePerms(prev => ({ ...prev, [userId]: map }));
  }, []);

  // ── Create ─────────────────────────────────────────────────────────────────

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    try {
      const { data, error } = await supabase.functions.invoke('create-user', {
        body: {
          email: createForm.email,
          password: createForm.password,
          username: createForm.username,
          fullName: createForm.fullName,
          role: createForm.role,
          dataAccessLevel: createForm.dataAccessLevel,
          assignedDistricts: createForm.assignedDistricts,
        },
      });
      if (error) {
        const body = await (error as any).context?.json?.().catch(() => null);
        throw new Error(body?.error || data?.error || error.message);
      }
      if (!data?.success) throw new Error(data?.error || 'Failed to create user');
      await fetchUsers();
      setCreateOpen(false);
      setCreateForm(emptyCreateForm);
      toast({ title: 'User created', description: `${createForm.email} is ready to log in.` });
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setCreating(false);
    }
  };

  // ── Edit ───────────────────────────────────────────────────────────────────

  const openEdit = (user: Profile) => {
    setEditUser(user);
    setEditForm({
      fullName: user.full_name || '',
      username: user.username,
      role: user.role,
      dataAccessLevel: user.data_access_level || 'limited',
    });
    setEditOpen(true);
  };

  const handleEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editUser) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from('profiles')
        .update({
          full_name: editForm.fullName,
          username: editForm.username,
          role: editForm.role,
          data_access_level: editForm.dataAccessLevel,
        })
        .eq('user_id', editUser.user_id);
      if (error) throw error;
      await fetchUsers();
      setEditOpen(false);
      toast({ title: 'User updated' });
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  // ── Delete ─────────────────────────────────────────────────────────────────

  const handleDelete = async (user: Profile) => {
    if (user.user_id === currentProfile?.user_id) {
      toast({ title: 'Error', description: 'You cannot delete your own account', variant: 'destructive' });
      return;
    }
    if (!confirm(`Delete "${user.full_name || user.username}"? This cannot be undone.`)) return;
    try {
      const response = await supabase.functions.invoke('delete-user', { body: { userId: user.user_id } });
      if (response.error) throw new Error(response.data?.error || response.error.message);
      if (!response.data?.success) throw new Error(response.data?.error || 'Failed to delete user');
      await fetchUsers();
      toast({ title: 'User deleted' });
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
  };

  // ── Change password ─────────────────────────────────────────────────────────

  const openChangePassword = (user: Profile) => {
    setPwdUser(user);
    setPwdForm({ newPassword: '', confirmPassword: '' });
    setPwdOpen(true);
  };

  const pwdMismatch = pwdForm.confirmPassword.length > 0 && pwdForm.newPassword !== pwdForm.confirmPassword;
  const pwdValid = pwdForm.newPassword.length >= 6 && pwdForm.newPassword === pwdForm.confirmPassword;

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pwdUser || !pwdValid) return;
    setChangingPwd(true);
    try {
      const { data, error } = await supabase.functions.invoke('update-user-password', {
        body: { userId: pwdUser.user_id, password: pwdForm.newPassword },
      });
      if (error) {
        const body = await (error as any).context?.json?.().catch(() => null);
        throw new Error(body?.error || data?.error || error.message);
      }
      if (!data?.success) throw new Error(data?.error || 'Failed to change password');
      setPwdOpen(false);
      toast({ title: 'Password changed', description: `New password set for ${pwdUser.full_name || pwdUser.username}.` });
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setChangingPwd(false);
    }
  };

  // ── Bulk WhatsApp permission ────────────────────────────────────────────────

  const toggleBulkWhatsApp = async (user: Profile) => {
    const perms = (user.permissions as Record<string, boolean>) || {};
    const updated = { ...perms, bulk_whatsapp: !perms.bulk_whatsapp };
    try {
      const { error } = await supabase.from('profiles').update({ permissions: updated } as any).eq('user_id', user.user_id);
      if (error) throw error;
      setUsers(prev => prev.map(u => u.user_id === user.user_id ? { ...u, permissions: updated } : u));
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
  };

  // ── Module permissions ──────────────────────────────────────────────────────

  const toggleModule = (userId: string, moduleKey: string) => {
    setModulePerms(prev => ({
      ...prev,
      [userId]: { ...(prev[userId] ?? {}), [moduleKey]: !(prev[userId]?.[moduleKey] ?? false) },
    }));
  };

  const saveModulePerms = async (userId: string, role: string) => {
    setSavingModules(userId);
    try {
      const perms = modulePerms[userId] ?? {};
      const rows = ALL_MODULES.map(m => ({
        user_id: userId,
        module_name: m.key,
        has_access: perms[m.key] ?? false,
        granted_by: currentProfile?.user_id,
      }));
      const { error } = await supabase.from('module_permissions').upsert(rows, { onConflict: 'user_id,module_name' });
      if (error) throw error;
      toast({ title: 'Module access saved' });
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setSavingModules(null);
    }
  };

  // ── Regional districts ──────────────────────────────────────────────────────

  const openRegional = (user: Profile) => {
    setRegionalTarget({ userId: user.user_id, username: user.username });
    setRegionalDistricts(user.assigned_districts || []);
    setRegionalOpen(true);
  };

  const saveRegional = async () => {
    if (!regionalTarget) return;
    if (regionalDistricts.length === 0) {
      toast({ title: 'Error', description: 'Select at least one district', variant: 'destructive' });
      return;
    }
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ data_access_level: 'regional', assigned_districts: regionalDistricts })
        .eq('user_id', regionalTarget.userId);
      if (error) throw error;
      setUsers(prev => prev.map(u =>
        u.user_id === regionalTarget.userId
          ? { ...u, data_access_level: 'regional', assigned_districts: regionalDistricts }
          : u
      ));
      setRegionalOpen(false);
      toast({ title: 'Districts saved' });
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <div className="flex items-center justify-center h-96">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        {/* Header */}
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold text-foreground">User Management</h1>
            <p className="text-sm text-muted-foreground mt-1">{users.length} staff account{users.length !== 1 ? 's' : ''}</p>
          </div>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Add User
          </Button>
        </div>

        {/* User list */}
        {users.length === 0 ? (
          <Card>
            <CardContent className="text-center py-16">
              <UserPlus className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
              <p className="font-medium">No users yet</p>
              <p className="text-sm text-muted-foreground mt-1">Create the first staff account to get started.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {users.map(user => {
              const isSelf = user.user_id === currentProfile?.user_id;
              const perms = (user.permissions as Record<string, boolean>) || {};
              const isExpanded = expandedUser === user.user_id;

              return (
                <Card key={user.user_id} className="overflow-hidden">
                  <CardContent className="p-5">
                    {/* Top row: identity + actions */}
                    <div className="flex justify-between items-start gap-4 flex-wrap">
                      <div className="space-y-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-base">{user.full_name || user.username}</span>
                          <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${ROLE_COLORS[user.role] ?? ''}`}>
                            {user.role}
                          </span>
                          {user.data_access_level && user.data_access_level !== 'full' && (
                            <Badge variant="outline" className="text-xs">
                              {user.data_access_level === 'regional' ? 'Regional' : 'Limited'}
                            </Badge>
                          )}
                          {isSelf && <Badge variant="outline" className="text-xs">You</Badge>}
                        </div>
                        <p className="text-sm text-muted-foreground">
                          @{user.username} · {user.email || `${user.username}@iplusedu.in`}
                        </p>
                        {user.assigned_districts && user.assigned_districts.length > 0 && (
                          <p className="text-xs text-muted-foreground flex items-center gap-1">
                            <MapPin className="h-3 w-3" />
                            {user.assigned_districts.join(', ')}
                          </p>
                        )}
                      </div>

                      <div className="flex items-center gap-2 flex-shrink-0">
                        <Button variant="outline" size="sm" onClick={() => openEdit(user)} title="Edit user">
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => openChangePassword(user)} title="Change password">
                          <KeyRound className="h-4 w-4" />
                        </Button>
                        {!isSelf && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleDelete(user)}
                            className="text-destructive hover:text-destructive hover:border-destructive"
                            title="Delete user"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </div>

                    {/* Quick toggles for non-superadmin */}
                    {user.role !== 'superadmin' && (
                      <>
                        <Separator className="my-4" />
                        <div className="flex items-center gap-6 flex-wrap">
                          {/* Regional districts */}
                          {user.data_access_level === 'regional' && (
                            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1" onClick={() => openRegional(user)}>
                              <MapPin className="h-3 w-3" />
                              Edit Districts
                            </Button>
                          )}

                          {/* Bulk WhatsApp */}
                          <div className="flex items-center gap-2">
                            <MessageSquare className="h-4 w-4 text-muted-foreground" />
                            <Label htmlFor={`wa-${user.user_id}`} className="text-sm cursor-pointer">Bulk WhatsApp</Label>
                            <Switch
                              id={`wa-${user.user_id}`}
                              checked={!!perms.bulk_whatsapp}
                              onCheckedChange={() => toggleBulkWhatsApp(user)}
                            />
                          </div>

                          {/* Module permissions toggle */}
                          {currentProfile?.role === 'superadmin' && (
                            <button
                              className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground ml-auto"
                              onClick={() => {
                                if (isExpanded) {
                                  setExpandedUser(null);
                                } else {
                                  setExpandedUser(user.user_id);
                                  if (!modulePerms[user.user_id]) fetchModulePerms(user.user_id);
                                }
                              }}
                            >
                              <Shield className="h-4 w-4" />
                              Module Access
                              {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                            </button>
                          )}
                        </div>

                        {/* Module permissions panel */}
                        {isExpanded && (
                          <div className="mt-4 space-y-3">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                              {ALL_MODULES.map(mod => (
                                <div
                                  key={mod.key}
                                  className="flex items-center justify-between rounded-lg border px-3 py-2 bg-muted/30"
                                >
                                  <div>
                                    <p className="text-sm font-medium">{mod.label}</p>
                                    <p className="text-xs text-muted-foreground">{mod.description}</p>
                                  </div>
                                  <Switch
                                    checked={modulePerms[user.user_id]?.[mod.key] ?? false}
                                    onCheckedChange={() => toggleModule(user.user_id, mod.key)}
                                  />
                                </div>
                              ))}
                            </div>
                            <div className="flex justify-end gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setModulePerms(prev => ({ ...prev, [user.user_id]: DEFAULT_MODULE_ACCESS[user.role] ?? {} }))}
                              >
                                Reset Defaults
                              </Button>
                              <Button
                                size="sm"
                                disabled={savingModules === user.user_id}
                                onClick={() => saveModulePerms(user.user_id, user.role)}
                              >
                                {savingModules === user.user_id ? 'Saving…' : 'Save Access'}
                              </Button>
                            </div>
                          </div>
                        )}
                      </>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Create User Dialog ─────────────────────────────────────────────────── */}
      <Dialog open={createOpen} onOpenChange={open => { setCreateOpen(open); if (!open) setCreateForm(emptyCreateForm); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add New User</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="c-username">Username</Label>
                <Input id="c-username" value={createForm.username} onChange={e => setCreateForm(f => ({ ...f, username: e.target.value }))} required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="c-fullname">Full Name</Label>
                <Input id="c-fullname" value={createForm.fullName} onChange={e => setCreateForm(f => ({ ...f, fullName: e.target.value }))} required />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-email">Email (@iplusedu.in)</Label>
              <Input id="c-email" type="email" placeholder="name@iplusedu.in" value={createForm.email} onChange={e => setCreateForm(f => ({ ...f, email: e.target.value }))} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-password">Password</Label>
              <Input id="c-password" type="password" value={createForm.password} onChange={e => setCreateForm(f => ({ ...f, password: e.target.value }))} required />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Role</Label>
                <Select value={createForm.role} onValueChange={v => setCreateForm(f => ({ ...f, role: v as any }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="manager">Manager</SelectItem>
                    <SelectItem value="accountant">Accountant</SelectItem>
                    <SelectItem value="superadmin">Super Admin</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Data Access</Label>
                <Select value={createForm.dataAccessLevel} onValueChange={v => setCreateForm(f => ({ ...f, dataAccessLevel: v as any }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="limited">Limited</SelectItem>
                    <SelectItem value="regional">Regional</SelectItem>
                    <SelectItem value="full">Full Access</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            {createForm.dataAccessLevel === 'regional' && (
              <div className="space-y-1.5">
                <Label>Assigned Districts (comma-separated)</Label>
                <Input
                  placeholder="Chennai, Coimbatore, Salem"
                  value={createForm.assignedDistricts.join(', ')}
                  onChange={e => setCreateForm(f => ({ ...f, assignedDistricts: e.target.value.split(',').map(d => d.trim()).filter(Boolean) }))}
                />
              </div>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={creating}>{creating ? 'Creating…' : 'Create User'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Edit User Dialog ───────────────────────────────────────────────────── */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit User</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleEdit} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="e-username">Username</Label>
                <Input id="e-username" value={editForm.username} onChange={e => setEditForm(f => ({ ...f, username: e.target.value }))} required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="e-fullname">Full Name</Label>
                <Input id="e-fullname" value={editForm.fullName} onChange={e => setEditForm(f => ({ ...f, fullName: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Role</Label>
                <Select value={editForm.role} onValueChange={v => setEditForm(f => ({ ...f, role: v as any }))} disabled={editUser?.user_id === currentProfile?.user_id}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="manager">Manager</SelectItem>
                    <SelectItem value="accountant">Accountant</SelectItem>
                    <SelectItem value="superadmin">Super Admin</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Data Access</Label>
                <Select value={editForm.dataAccessLevel} onValueChange={v => setEditForm(f => ({ ...f, dataAccessLevel: v as any }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="limited">Limited</SelectItem>
                    <SelectItem value="regional">Regional</SelectItem>
                    <SelectItem value="full">Full Access</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save Changes'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Change Password Dialog ─────────────────────────────────────────────── */}
      <Dialog open={pwdOpen} onOpenChange={open => { setPwdOpen(open); if (!open) { setPwdUser(null); setPwdForm({ newPassword: '', confirmPassword: '' }); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="h-4 w-4" />
              Change Password
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleChangePassword} className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {pwdUser?.full_name || pwdUser?.username} · {pwdUser?.email || `${pwdUser?.username}@iplusedu.in`}
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="p-new">New Password</Label>
              <Input id="p-new" type="password" autoComplete="new-password" value={pwdForm.newPassword} onChange={e => setPwdForm(f => ({ ...f, newPassword: e.target.value }))} required minLength={6} />
              {pwdForm.newPassword.length > 0 && pwdForm.newPassword.length < 6 && (
                <p className="text-xs text-destructive">Must be at least 6 characters</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-confirm">Confirm Password</Label>
              <Input id="p-confirm" type="password" autoComplete="new-password" value={pwdForm.confirmPassword} onChange={e => setPwdForm(f => ({ ...f, confirmPassword: e.target.value }))} required />
              {pwdMismatch && <p className="text-xs text-destructive">Passwords do not match</p>}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setPwdOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={!pwdValid || changingPwd}>{changingPwd ? 'Changing…' : 'Change Password'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Regional Districts Dialog ──────────────────────────────────────────── */}
      <Dialog open={regionalOpen} onOpenChange={open => { setRegionalOpen(open); if (!open) { setRegionalTarget(null); setRegionalDistricts([]); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MapPin className="h-4 w-4" />
              Districts for {regionalTarget?.username}
            </DialogTitle>
          </DialogHeader>
          <ScrollArea className="h-60 border rounded-md p-3">
            <div className="space-y-2">
              {availableDistricts.map(d => (
                <div key={d} className="flex items-center gap-2">
                  <Checkbox
                    id={`d-${d}`}
                    checked={regionalDistricts.includes(d)}
                    onCheckedChange={() => setRegionalDistricts(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d])}
                  />
                  <label htmlFor={`d-${d}`} className="text-sm cursor-pointer">{d}</label>
                </div>
              ))}
            </div>
          </ScrollArea>
          {regionalDistricts.length > 0 && (
            <p className="text-xs text-muted-foreground">{regionalDistricts.length} district(s) selected</p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setRegionalOpen(false)}>Cancel</Button>
            <Button onClick={saveRegional} disabled={regionalDistricts.length === 0}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Users;
