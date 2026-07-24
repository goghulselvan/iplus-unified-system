import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Plus } from 'lucide-react';

interface AddPaymentDialogProps {
  schoolId: string;
  schoolName: string;
  onPaymentAdded: () => void;
}

export const AddPaymentDialog: React.FC<AddPaymentDialogProps> = ({
  schoolId,
  schoolName,
  onPaymentAdded
}) => {
  const [open, setOpen] = useState(false);
  const [formData, setFormData] = useState({
    payment_date: new Date().toISOString().split('T')[0],
    payment_amount: '',
    payment_mode: 'Cash',
    transaction_reference: '',
    notes: ''
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.payment_amount || parseFloat(formData.payment_amount) <= 0) {
      toast.error('Please enter a valid payment amount');
      return;
    }

    if (!formData.transaction_reference.trim()) {
      toast.error('Please enter a payment reference number — it prints on the school\'s receipt');
      return;
    }

    setIsSubmitting(true);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        toast.error('User not authenticated');
        return;
      }

      const { error } = await supabase
        .from('payment_transactions')
        .insert({
          school_id: schoolId,
          payment_date: formData.payment_date,
          payment_amount: parseFloat(formData.payment_amount),
          payment_mode: formData.payment_mode,
          transaction_reference: formData.transaction_reference.trim(),
          notes: formData.notes || null,
          created_by: user.id
        });

      if (error) {
        console.error('Error adding payment:', error);
        toast.error('Failed to add payment');
        return;
      }

      toast.success('Payment added successfully');
      setOpen(false);
      setFormData({
        payment_date: new Date().toISOString().split('T')[0],
        payment_amount: '',
        payment_mode: 'Cash',
        transaction_reference: '',
        notes: ''
      });
      onPaymentAdded();
    } catch (error) {
      console.error('Error in handleSubmit:', error);
      toast.error('Failed to add payment');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-2">
          <Plus className="h-4 w-4" />
          Add Payment
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add Payment for {schoolName}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="payment_date">Payment Date</Label>
            <Input
              id="payment_date"
              type="date"
              value={formData.payment_date}
              onChange={(e) => setFormData(prev => ({ ...prev, payment_date: e.target.value }))}
              required
            />
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="payment_amount">Payment Amount</Label>
            <Input
              id="payment_amount"
              type="number"
              step="0.01"
              min="0"
              placeholder="Enter amount"
              value={formData.payment_amount}
              onChange={(e) => setFormData(prev => ({ ...prev, payment_amount: e.target.value }))}
              required
            />
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="payment_mode">Payment Mode</Label>
            <Select value={formData.payment_mode} onValueChange={(value) => setFormData(prev => ({ ...prev, payment_mode: value }))}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Cash">Cash</SelectItem>
                <SelectItem value="Cheque">Cheque</SelectItem>
                <SelectItem value="Online Transfer">Online Transfer</SelectItem>
                <SelectItem value="UPI">UPI</SelectItem>
                <SelectItem value="Credit Card">Credit Card</SelectItem>
                <SelectItem value="Debit Card">Debit Card</SelectItem>
              </SelectContent>
            </Select>
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="transaction_reference">Payment Reference Number</Label>
            <Input
              id="transaction_reference"
              placeholder="Cheque number, UPI ID, UTR, etc."
              value={formData.transaction_reference}
              onChange={(e) => setFormData(prev => ({ ...prev, transaction_reference: e.target.value }))}
              required
            />
            <p className="text-xs text-muted-foreground">Prints on the school's payment receipt.</p>
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="notes">Notes (Optional)</Label>
            <Textarea
              id="notes"
              placeholder="Additional notes about this payment"
              value={formData.notes}
              onChange={(e) => setFormData(prev => ({ ...prev, notes: e.target.value }))}
              rows={3}
            />
          </div>
          
          <div className="flex gap-3 pt-4">
            <Button type="submit" disabled={isSubmitting} className="flex-1">
              {isSubmitting ? 'Adding...' : 'Add Payment'}
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