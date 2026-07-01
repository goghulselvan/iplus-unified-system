import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { RotateCcw } from 'lucide-react';

interface AddRefundDialogProps {
  schoolId: string;
  schoolName: string;
  onRefundAdded: () => void;
}

export const AddRefundDialog: React.FC<AddRefundDialogProps> = ({
  schoolId,
  schoolName,
  onRefundAdded,
}) => {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const refundAmount = parseFloat(amount);
    if (!amount || refundAmount <= 0) {
      toast.error('Enter a valid refund amount');
      return;
    }
    setIsSubmitting(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { toast.error('Not authenticated'); return; }

      const { error } = await supabase
        .from('payment_transactions')
        .insert({
          school_id: schoolId,
          payment_date: date,
          payment_amount: -refundAmount,
          payment_mode: 'Refund',
          notes: notes || null,
          created_by: user.id,
        });

      if (error) { toast.error('Failed to record refund'); return; }

      toast.success(`Refund of ₹${refundAmount.toLocaleString('en-IN')} recorded`);
      setOpen(false);
      setAmount('');
      setNotes('');
      setDate(new Date().toISOString().split('T')[0]);
      onRefundAdded();
    } catch {
      toast.error('Failed to record refund');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="gap-2">
          <RotateCcw className="h-4 w-4" />
          Add Refund
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Record Refund — {schoolName}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="refund_date">Refund Date</Label>
            <Input
              id="refund_date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="refund_amount">Refund Amount (₹)</Label>
            <Input
              id="refund_amount"
              type="number"
              step="0.01"
              min="0.01"
              placeholder="Enter amount to refund"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="refund_notes">Reason / Notes (Optional)</Label>
            <Textarea
              id="refund_notes"
              placeholder="Why is this refund being issued?"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
            />
          </div>
          <div className="flex gap-3 pt-4">
            <Button type="submit" disabled={isSubmitting} variant="destructive" className="flex-1">
              {isSubmitting ? 'Recording…' : 'Record Refund'}
            </Button>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};
