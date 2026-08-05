import { useState, useEffect } from 'react';
import SalesLayout from '@/components/sales/SalesLayout';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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

  return (
    <SalesLayout>
      <div className="max-w-6xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold">Item Issue</h1>
          <Button onClick={() => setDialogOpen(true)}><Plus className="h-4 w-4 mr-2" />Issue Item</Button>
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
              ) : issues.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No items issued yet.</TableCell></TableRow>
              ) : (
                issues.map(i => (
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
