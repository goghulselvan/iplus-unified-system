import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

const FIELDS: { label: string; key: string; values: string[] }[] = [
  { label: 'Brochure Delivery', key: 'brochure_delivery_status', values: ['Physical Only', 'Digital Sent', 'Both Physical & Digital'] },
  { label: 'Courier Status', key: 'courier_status', values: ['Sent', 'Returned'] },
  { label: 'Contacted', key: 'contacted', values: ['Yes', 'No'] },
  { label: 'Registration Status', key: 'registration_status', values: ['Pending', 'In Progress', 'Confirmed'] },
  { label: 'Payment Status', key: 'payment_status', values: ['Pending', 'Partial', 'Received'] },
  { label: 'Name List Status', key: 'name_list_status', values: ['Pending', 'Received', 'Uploaded'] },
  { label: 'Question Paper', key: 'question_paper_sent', values: ['Not Sent', 'Sent'] },
  { label: 'Answer Sheet', key: 'answer_sheet_status', values: ['Waiting', 'Received'] },
  { label: 'Result Status', key: 'result_status', values: ['Not Sent', 'Sent'] },
];

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  schoolIds: string[];
  projectId: string;
  onDone: () => void;
}

export function BulkStageDialog({ open, onOpenChange, schoolIds, projectId, onDone }: Props) {
  const { toast } = useToast();
  const [field, setField] = useState('');
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);

  const selectedField = FIELDS.find(f => f.key === field);

  const handleFieldChange = (v: string) => {
    setField(v);
    setValue('');
  };

  const handleApply = async () => {
    if (!field || !value || schoolIds.length === 0) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from('school_project_workflow')
        .update({ [field]: value })
        .in('school_id', schoolIds)
        .eq('project_id', projectId);
      if (error) throw error;
      toast({
        title: 'Updated',
        description: `Set ${selectedField?.label} = "${value}" for ${schoolIds.length} school${schoolIds.length === 1 ? '' : 's'}.`,
      });
      onOpenChange(false);
      onDone();
    } catch (e: any) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Update Stage — {schoolIds.length} school{schoolIds.length === 1 ? '' : 's'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div>
            <p className="text-sm font-medium mb-1.5">Field</p>
            <Select value={field} onValueChange={handleFieldChange}>
              <SelectTrigger><SelectValue placeholder="Pick a field…" /></SelectTrigger>
              <SelectContent>
                {FIELDS.map(f => (
                  <SelectItem key={f.key} value={f.key}>{f.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {selectedField && (
            <div>
              <p className="text-sm font-medium mb-1.5">New value</p>
              <Select value={value} onValueChange={setValue}>
                <SelectTrigger><SelectValue placeholder="Pick a value…" /></SelectTrigger>
                <SelectContent>
                  {selectedField.values.map(v => (
                    <SelectItem key={v} value={v}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <Button
            className="w-full"
            disabled={!field || !value || saving}
            onClick={handleApply}
          >
            {saving ? 'Updating…' : `Apply to ${schoolIds.length} school${schoolIds.length === 1 ? '' : 's'}`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
