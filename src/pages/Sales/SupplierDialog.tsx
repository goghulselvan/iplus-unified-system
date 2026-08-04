import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import type { Supplier } from './SuppliersPage';

const emptyForm = {
  name: '', contact_person: '', phone: '', email: '', address: '', gstin: '',
};

export default function SupplierDialog({
  open, onOpenChange, editing, onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: Supplier | null;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm(editing ? {
      name: editing.name,
      contact_person: editing.contact_person ?? '',
      phone: editing.phone ?? '',
      email: editing.email ?? '',
      address: editing.address ?? '',
      gstin: editing.gstin ?? '',
    } : emptyForm);
  }, [open, editing]);

  const handleSave = async () => {
    if (!form.name.trim()) { toast({ title: 'Name is required', variant: 'destructive' }); return; }
    setSaving(true);
    const payload = {
      name: form.name.trim(),
      contact_person: form.contact_person.trim() || null,
      phone: form.phone.trim() || null,
      email: form.email.trim() || null,
      address: form.address.trim() || null,
      gstin: form.gstin.trim() || null,
    };
    const { error } = editing
      ? await supabase.from('inventory_suppliers' as any).update(payload).eq('id', editing.id)
      : await supabase.from('inventory_suppliers' as any).insert(payload);
    setSaving(false);
    if (error) { toast({ title: 'Error', description: error.message, variant: 'destructive' }); return; }
    toast({ title: editing ? 'Supplier updated' : 'Supplier added' });
    onOpenChange(false);
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{editing ? 'Edit Supplier' : 'Add Supplier'}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <Label htmlFor="s-name">Name</Label>
            <Input id="s-name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          </div>
          <div>
            <Label htmlFor="s-contact">Contact Person</Label>
            <Input id="s-contact" value={form.contact_person} onChange={e => setForm(f => ({ ...f, contact_person: e.target.value }))} />
          </div>
          <div>
            <Label htmlFor="s-phone">Phone</Label>
            <Input id="s-phone" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
          </div>
          <div>
            <Label htmlFor="s-email">Email</Label>
            <Input id="s-email" type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
          </div>
          <div>
            <Label htmlFor="s-gstin">GSTIN</Label>
            <Input id="s-gstin" value={form.gstin} onChange={e => setForm(f => ({ ...f, gstin: e.target.value }))} />
          </div>
          <div className="col-span-2">
            <Label htmlFor="s-address">Address</Label>
            <Textarea id="s-address" value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
