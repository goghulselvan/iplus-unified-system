import { useState, useEffect } from 'react';
import SalesLayout from '@/components/sales/SalesLayout';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Plus, Trash2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import AddStockDialog from './AddStockDialog';
import StockAdjustmentDialog from './StockAdjustmentDialog';

type StockAdd = {
  id: string;
  quantity: number;
  reason: string;
  added_date: string;
  added_by: string | null;
  products: { name: string } | null;
};

type StockAdjustment = {
  id: string;
  quantity_delta: number;
  reason: string;
  adjusted_date: string;
  adjusted_by: string | null;
  products: { name: string } | null;
};

type ProfileLite = { user_id: string; full_name: string | null; username: string | null };

const PAGE_SIZE = 200;

export default function StockMovementsPage() {
  const { toast } = useToast();
  const [adds, setAdds] = useState<StockAdd[]>([]);
  const [adjustments, setAdjustments] = useState<StockAdjustment[]>([]);
  const [profiles, setProfiles] = useState<Record<string, ProfileLite>>({});
  const [loading, setLoading] = useState(true);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [adjustDialogOpen, setAdjustDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<StockAdjustment | null>(null);

  const loadData = async () => {
    setLoading(true);
    const [addsRes, adjRes, profilesRes] = await Promise.all([
      supabase.from('inventory_stock_adds' as any).select('id, quantity, reason, added_date, added_by, products(name)').order('added_date', { ascending: false }).order('created_at', { ascending: false }).limit(PAGE_SIZE),
      supabase.from('inventory_stock_adjustments' as any).select('id, quantity_delta, reason, adjusted_date, adjusted_by, products(name)').order('adjusted_date', { ascending: false }).order('created_at', { ascending: false }).limit(PAGE_SIZE),
      supabase.from('profiles').select('user_id, full_name, username'),
    ]);
    if (addsRes.error) toast({ title: 'Error loading stock adds', description: addsRes.error.message, variant: 'destructive' });
    if (adjRes.error) toast({ title: 'Error loading adjustments', description: adjRes.error.message, variant: 'destructive' });
    if (profilesRes.error) toast({ title: 'Error loading users', description: profilesRes.error.message, variant: 'destructive' });
    setAdds((addsRes.data || []) as unknown as StockAdd[]);
    setAdjustments((adjRes.data || []) as unknown as StockAdjustment[]);
    const profileMap: Record<string, ProfileLite> = {};
    ((profilesRes.data || []) as unknown as ProfileLite[]).forEach(p => { profileMap[p.user_id] = p; });
    setProfiles(profileMap);
    setLoading(false);
  };

  const resolveUser = (userId: string | null) => {
    if (!userId) return '—';
    const p = profiles[userId];
    if (!p) return '—';
    return p.full_name || p.username || '—';
  };

  useEffect(() => { loadData(); }, []);

  const handleDeleteAdjustment = async () => {
    if (!deleteTarget) return;
    const { error } = await supabase.rpc('delete_stock_adjustment' as any, { p_adjustment_id: deleteTarget.id });
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
      setDeleteTarget(null);
      return;
    }
    toast({ title: 'Adjustment reversed and removed' });
    setDeleteTarget(null);
    loadData();
  };

  return (
    <SalesLayout>
      <div className="max-w-6xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold">Stock Movements</h1>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setAdjustDialogOpen(true)}><Plus className="h-4 w-4 mr-2" />Adjust Stock</Button>
            <Button onClick={() => setAddDialogOpen(true)}><Plus className="h-4 w-4 mr-2" />Add Stock</Button>
          </div>
        </div>

        <Tabs defaultValue="adds">
          <TabsList>
            <TabsTrigger value="adds">Stock Added</TabsTrigger>
            <TabsTrigger value="adjustments">Stock Adjustments</TabsTrigger>
          </TabsList>

          <TabsContent value="adds">
            <div className="bg-white rounded-xl border overflow-hidden mt-4">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Product</TableHead>
                    <TableHead>Quantity</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead>Added By</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
                  ) : adds.length === 0 ? (
                    <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">No stock additions yet.</TableCell></TableRow>
                  ) : (
                    adds.map(a => (
                      <TableRow key={a.id}>
                        <TableCell>{new Date(a.added_date).toLocaleDateString('en-IN')}</TableCell>
                        <TableCell className="font-medium">{a.products?.name ?? '—'}</TableCell>
                        <TableCell className="text-green-600 font-medium">+{a.quantity}</TableCell>
                        <TableCell>{a.reason}</TableCell>
                        <TableCell>{resolveUser(a.added_by)}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </TabsContent>

          <TabsContent value="adjustments">
            <div className="bg-white rounded-xl border overflow-hidden mt-4">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Product</TableHead>
                    <TableHead>Change</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead>Adjusted By</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
                  ) : adjustments.length === 0 ? (
                    <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No adjustments yet.</TableCell></TableRow>
                  ) : (
                    adjustments.map(a => (
                      <TableRow key={a.id}>
                        <TableCell>{new Date(a.adjusted_date).toLocaleDateString('en-IN')}</TableCell>
                        <TableCell className="font-medium">{a.products?.name ?? '—'}</TableCell>
                        <TableCell>
                          <Badge variant={a.quantity_delta > 0 ? 'default' : 'destructive'}>
                            {a.quantity_delta > 0 ? '+' : ''}{a.quantity_delta}
                          </Badge>
                        </TableCell>
                        <TableCell>{a.reason}</TableCell>
                        <TableCell>{resolveUser(a.adjusted_by)}</TableCell>
                        <TableCell className="text-right">
                          <Button variant="ghost" size="sm" onClick={() => setDeleteTarget(a)}><Trash2 className="h-3.5 w-3.5 text-red-600" /></Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </TabsContent>
        </Tabs>
      </div>

      <AddStockDialog open={addDialogOpen} onOpenChange={setAddDialogOpen} onSaved={loadData} />
      <StockAdjustmentDialog open={adjustDialogOpen} onOpenChange={setAdjustDialogOpen} onSaved={loadData} />

      <AlertDialog open={!!deleteTarget} onOpenChange={open => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reverse this adjustment?</AlertDialogTitle>
            <AlertDialogDescription>
              This will undo its effect on stock and remove it from the log. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteAdjustment} className="bg-red-600 hover:bg-red-700">Reverse</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SalesLayout>
  );
}
