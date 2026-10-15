import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';

type Fields = { school_name: string; address1: string; address2: string; district: string; state: string; pincode: string; board: string };
const EMPTY: Fields = { school_name: '', address1: '', address2: '', district: '', state: '', pincode: '', board: '' };

type Props = {
  prospect: { id: string; school_name: string; address: string | null; district: string; state: string; pincode: string | null; board: string | null };
  onSaved: (p: { school_name: string; address: string | null; district: string; state: string; pincode: string | null; board: string | null }) => void;
  onCancel: () => void;
};

// Edit a school's name / address / location. For a school that is in the CRM the CRM record is
// the source of truth: the edit is saved there (audited) and the prospect copy follows through
// the database sync. A school not in the CRM is edited on its prospect record directly.
export default function ProspectSchoolDetailsEditor({ prospect, onSaved, onCancel }: Props) {
  const { toast } = useToast();
  const [crmId, setCrmId] = useState<string | null | undefined>(undefined);
  const [orig, setOrig] = useState<Fields>(EMPTY);
  const [form, setForm] = useState<Fields>(EMPTY);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    supabase.from('schools').select('id, school_name, address1, address2, district, state, pincode, board')
      .eq('prospect_school_id', prospect.id).maybeSingle()
      .then(({ data: row }) => {
        // generated types predate address1/address2/state on schools
        const data = row as unknown as (Fields & { id: string }) | null;
        const f: Fields = data
          ? { school_name: data.school_name ?? '', address1: data.address1 ?? '', address2: data.address2 ?? '',
              district: data.district ?? '', state: data.state ?? '', pincode: data.pincode ?? '', board: data.board ?? '' }
          : { school_name: prospect.school_name ?? '', address1: prospect.address ?? '', address2: '',
              district: prospect.district ?? '', state: prospect.state ?? '', pincode: prospect.pincode ?? '', board: prospect.board ?? '' };
        setCrmId(data?.id ?? null);
        setOrig(f);
        setForm(f);
      });
  }, [prospect]);

  const set = (k: keyof Fields) => (e: React.ChangeEvent<HTMLInputElement>) => setForm(f => ({ ...f, [k]: e.target.value }));

  const save = async () => {
    if (!form.school_name.trim()) { toast({ title: 'School name is required', variant: 'destructive' }); return; }
    if (form.pincode && !/^\d{6}$/.test(form.pincode.trim())) { toast({ title: 'Pincode must be 6 digits', variant: 'destructive' }); return; }
    const changed = Object.fromEntries(
      (Object.keys(form) as (keyof Fields)[])
        .filter(k => form[k].trim() !== orig[k].trim())
        .map(k => [k, form[k].trim() || null]),
    );
    if (Object.keys(changed).length === 0) { onCancel(); return; }
    setSaving(true);
    let error;
    if (crmId) {
      ({ error } = await supabase.rpc('update_school_with_manual_edit' as any, { p_school_id: crmId, p_updates: changed }));
    } else {
      const { address1, address2, ...rest } = changed as Record<string, string | null>;
      const upd: Record<string, string | null> = { ...rest };
      if ('address1' in changed || 'address2' in changed) {
        upd.address = [form.address1.trim(), form.address2.trim()].filter(Boolean).join(', ') || null;
      }
      ({ error } = await supabase.from('prospect_schools' as any).update(upd as any).eq('id', prospect.id));
    }
    setSaving(false);
    if (error) { toast({ title: 'Could not save school details', description: error.message, variant: 'destructive' }); return; }
    toast({ title: crmId ? 'School details saved in the CRM' : 'School details saved' });
    onSaved({
      school_name: form.school_name.trim(),
      address: [form.address1.trim(), form.address2.trim()].filter(Boolean).join(', ') || null,
      district: form.district.trim(), state: form.state.trim(),
      pincode: form.pincode.trim() || null, board: form.board.trim() || null,
    });
  };

  if (crmId === undefined) return null;
  const field = (k: keyof Fields, label: string, wide = false) => (
    <div className={wide ? 'col-span-2' : ''}>
      <Label htmlFor={`sd-${k}`} className="text-xs text-gray-500">{label}</Label>
      <Input id={`sd-${k}`} value={form[k]} onChange={set(k)} className="h-8 text-sm" />
    </div>
  );

  return (
    <div className="space-y-3">
      {crmId && <p className="text-xs text-gray-500">This school is in the CRM. Changes are saved to its CRM record.</p>}
      <div className="grid grid-cols-2 gap-3">
        {field('school_name', 'School name', true)}
        {field('address1', 'Address 1', true)}
        {field('address2', 'Address 2', true)}
        {field('district', 'District')}
        {field('state', 'State')}
        {field('pincode', 'Pincode')}
        {field('board', 'Board')}
      </div>
      <div className="flex gap-2">
        <Button size="sm" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save details'}</Button>
        <Button size="sm" variant="outline" onClick={onCancel} disabled={saving}>Cancel</Button>
      </div>
    </div>
  );
}
