import { useState, useEffect, useMemo } from 'react';
import SalesLayout from '@/components/sales/SalesLayout';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Plus } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import IssueItemDialog from './IssueItemDialog';

type IssueRow = {
  id: string;
  quantity: number;
  issued_to_type: 'student' | 'staff' | 'other';
  issued_to_name: string;
  issue_date: string;
  notes: string | null;
  issued_by: string | null;
  products: { name: string } | null;
};

type IssuedByProfile = { user_id: string; full_name: string | null; username: string };

const TYPE_LABELS: Record<string, string> = { student: 'Student', staff: 'Staff', other: 'Other' };

const PAGE_SIZE = 200;

export default function ItemIssuePage() {
  const { toast } = useToast();
  const [issues, setIssues] = useState<IssueRow[]>([]);
  const [profilesById, setProfilesById] = useState<Record<string, IssuedByProfile>>({});
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  const loadIssues = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('inventory_item_issues' as any)
      .select('id, quantity, issued_to_type, issued_to_name, issue_date, notes, issued_by, products(name)')
      .order('issue_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(PAGE_SIZE);
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } else {
      setIssues((data || []) as unknown as IssueRow[]);
    }
    setLoading(false);
  };

  const loadProfiles = async () => {
    const { data, error } = await supabase.from('profiles').select('user_id, full_name, username');
    if (error) {
      toast({ title: 'Error loading staff names', description: error.message, variant: 'destructive' });
      return;
    }
    const map: Record<string, IssuedByProfile> = {};
    for (const p of data || []) map[p.user_id] = p;
    setProfilesById(map);
  };

  useEffect(() => { loadIssues(); loadProfiles(); }, []);

  // Client-side filter over the already-loaded issues list — no range selected means no filtering (current behavior).
  const filteredIssues = useMemo(() => issues.filter(i => {
    if (fromDate && i.issue_date < fromDate) return false;
    if (toDate && i.issue_date > toDate) return false;
    return true;
  }), [issues, fromDate, toDate]);

  const totalQuantity = useMemo(() => filteredIssues.reduce((s, i) => s + i.quantity, 0), [filteredIssues]);
  const studentQuantity = useMemo(
    () => filteredIssues.filter(i => i.issued_to_type === 'student').reduce((s, i) => s + i.quantity, 0),
    [filteredIssues]
  );
  const staffQuantity = useMemo(
    () => filteredIssues.filter(i => i.issued_to_type === 'staff').reduce((s, i) => s + i.quantity, 0),
    [filteredIssues]
  );
  const otherQuantity = useMemo(
    () => filteredIssues.filter(i => i.issued_to_type === 'other').reduce((s, i) => s + i.quantity, 0),
    [filteredIssues]
  );

  return (
    <SalesLayout>
      <div className="max-w-6xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
          <h1 className="text-2xl font-bold">Item Issue</h1>
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <label htmlFor="issue-from-date" className="text-sm text-muted-foreground">From</label>
              <Input id="issue-from-date" type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} className="w-40" />
            </div>
            <div className="flex items-center gap-2">
              <label htmlFor="issue-to-date" className="text-sm text-muted-foreground">To</label>
              <Input id="issue-to-date" type="date" value={toDate} onChange={e => setToDate(e.target.value)} className="w-40" />
            </div>
            <Button onClick={() => setDialogOpen(true)}><Plus className="h-4 w-4 mr-2" />Issue Item</Button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mb-6">
          <div className="bg-white rounded-xl border p-5">
            <div className="text-sm text-muted-foreground">Total Quantity Issued</div>
            <div className="text-2xl font-bold text-violet-700 mt-1">{totalQuantity}</div>
          </div>
          <div className="bg-white rounded-xl border p-5">
            <div className="text-sm text-muted-foreground">Issued to Students</div>
            <div className="text-2xl font-bold mt-1">{studentQuantity}</div>
          </div>
          <div className="bg-white rounded-xl border p-5">
            <div className="text-sm text-muted-foreground">Issued to Staff</div>
            <div className="text-2xl font-bold mt-1">{staffQuantity}</div>
          </div>
          <div className="bg-white rounded-xl border p-5">
            <div className="text-sm text-muted-foreground">Issued to Other</div>
            <div className="text-2xl font-bold mt-1">{otherQuantity}</div>
          </div>
        </div>

        <div className="bg-white rounded-xl border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Product</TableHead>
                <TableHead>Issued To</TableHead>
                <TableHead>Quantity</TableHead>
                <TableHead>Issued By</TableHead>
                <TableHead>Notes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
              ) : filteredIssues.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">{issues.length === 0 ? 'No items issued yet.' : 'No items issued in this date range.'}</TableCell></TableRow>
              ) : (
                filteredIssues.map(i => (
                  <TableRow key={i.id}>
                    <TableCell>{new Date(i.issue_date).toLocaleDateString('en-IN')}</TableCell>
                    <TableCell className="font-medium">{i.products?.name ?? '—'}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="mr-1.5 text-[10px]">{TYPE_LABELS[i.issued_to_type]}</Badge>
                      {i.issued_to_name}
                    </TableCell>
                    <TableCell>{i.quantity}</TableCell>
                    <TableCell>{i.issued_by ? (profilesById[i.issued_by]?.full_name || profilesById[i.issued_by]?.username || '—') : '—'}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">{i.notes || '—'}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <IssueItemDialog open={dialogOpen} onOpenChange={setDialogOpen} onSaved={loadIssues} />
    </SalesLayout>
  );
}
