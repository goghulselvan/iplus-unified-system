import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

const BLOCKER_LABEL: Record<string, string> = {
  students: 'students', enrolments: 'subject entries', payments: 'payments', payment_proofs: 'payment proofs',
  portal_payments: 'portal payments', book_orders: 'book orders', invoices: 'invoices', results: 'results',
};

type Props = {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  schoolId: string;
  schoolName: string;
  projectId: string;
  projectLabel: string;
  nextYear: number;
  onRemoved: () => void;
};

// Takes a non-participating school out of the current project without deleting it. The school
// keeps its record, communications and SS No; its portal registration is archived and its portal
// login is switched off. By default it is queued in Interest Leads for next year.
export default function RemoveFromProjectDialog({ open, onOpenChange, schoolId, schoolName, projectId, projectLabel, nextYear, onRemoved }: Props) {
  const { toast } = useToast();
  const [blockers, setBlockers] = useState<Record<string, number> | null>(null);
  const [reason, setReason] = useState<'next_year' | 'not_interested'>('next_year');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setBlockers(null);
    setReason('next_year');
    supabase.rpc('school_removal_blockers' as any, { p_school_id: schoolId, p_project_id: projectId })
      .then(({ data }) => setBlockers((data ?? {}) as Record<string, number>));
  }, [open, schoolId, projectId]);

  const blocked = blockers && Object.keys(blockers).length > 0;

  const remove = async () => {
    setSaving(true);
    const { error } = await supabase.rpc('remove_school_from_project' as any, {
      p_school_id: schoolId, p_project_id: projectId, p_reason: reason,
    });
    setSaving(false);
    if (error) { toast({ title: 'Could not remove the school', description: error.message, variant: 'destructive' }); return; }
    toast({
      title: `Removed from ${projectLabel}`,
      description: reason === 'next_year'
        ? `${schoolName} is now in Prospect → Interest Leads for ${nextYear}.`
        : `${schoolName} stays in the Prospect database.`,
    });
    onOpenChange(false);
    onRemoved();
  };

  return (
    <Dialog open={open} onOpenChange={o => { if (!saving) onOpenChange(o); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Remove from {projectLabel}?</DialogTitle>
        </DialogHeader>

        {blockers === null ? (
          <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-gray-400" /></div>
        ) : blocked ? (
          <p className="text-sm text-red-600">
            {schoolName} can't be removed because it has{' '}
            {Object.entries(blockers).map(([k, n]) => `${n} ${BLOCKER_LABEL[k] ?? k}`).join(', ')} in this project.
          </p>
        ) : (
          <div className="space-y-4 text-sm">
            <p className="text-gray-600">
              {schoolName} leaves the {projectLabel} lists. Its school record, SS No and communication history are kept.
              Details the school entered on the portal fill any empty CRM fields, then its portal registration is archived and its portal login is switched off.
            </p>
            <RadioGroup value={reason} onValueChange={v => setReason(v as typeof reason)} className="space-y-2">
              <div className="flex items-start gap-2">
                <RadioGroupItem value="next_year" id="rm-next" className="mt-0.5" />
                <Label htmlFor="rm-next" className="font-normal leading-snug">
                  <span className="font-medium">Interested for next year</span>
                  <span className="block text-gray-500">Adds it to Interest Leads for {nextYear}.</span>
                </Label>
              </div>
              <div className="flex items-start gap-2">
                <RadioGroupItem value="not_interested" id="rm-no" className="mt-0.5" />
                <Label htmlFor="rm-no" className="font-normal leading-snug">
                  <span className="font-medium">Not interested</span>
                  <span className="block text-gray-500">Keeps it in the Prospect database only.</span>
                </Label>
              </div>
            </RadioGroup>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          {!blocked && blockers !== null && (
            <Button variant="destructive" onClick={remove} disabled={saving}>
              {saving ? 'Removing…' : `Remove from ${projectLabel}`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
