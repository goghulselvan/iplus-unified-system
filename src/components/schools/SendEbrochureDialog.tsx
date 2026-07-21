import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Send, Loader2 } from 'lucide-react';

export interface EbrochureContact { name: string; mobile: string; role?: string }

export type SendDocType = 'ebrochure' | 'consent_form' | 'sample_questions';

const CLASS_OPTIONS = ['LKG', 'UKG', '1', '2', '3', '4', '5', '6', '7', '8'];

type Target =
  | {
      kind: 'school'; schoolId: string; schoolName: string; district?: string; state?: string;
      mobile1: string | null; mobile2: string | null; email: string | null; contacts: EbrochureContact[];
      principalMobile?: string | null; coordMobile?: string | null; corrMobile?: string | null;
    }
  | {
      kind: 'prospect'; prospectSchoolId: string; schoolName: string; district?: string; state?: string;
      mobile: string | null; email: string | null; contacts: EbrochureContact[];
    };

const DOC_LABELS: Record<SendDocType, string> = {
  ebrochure: 'E-Brochure',
  consent_form: 'Parents Consent Form',
  sample_questions: 'Sample Questions',
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: Target;
  /** Fires after a successful manual-WhatsApp send with "save to contacts" checked.
   *  Only needed when the backend's own saveContact logic doesn't cover this target
   *  (it only ever writes to the `schools` table) — i.e. prospect-only targets. */
  onSaveManualContact?: (contact: EbrochureContact) => Promise<void>;
  /** Fires after any successful send (WhatsApp and/or Email). Use it to refresh
   *  whatever local state the parent shows (delivery status, saved contacts). */
  onSent?: () => void;
}

type Job =
  | { channel: 'whatsapp'; phone: string; contactName?: string; contactRole?: string; isManual?: boolean }
  | { channel: 'email'; email: string; isManual?: boolean };

export function SendEbrochureDialog({ open, onOpenChange, target, onSaveManualContact, onSent }: Props) {
  const { toast } = useToast();
  const [docType, setDocType] = useState<SendDocType>('ebrochure');
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [selectedClasses, setSelectedClasses] = useState<Set<string>>(new Set(CLASS_OPTIONS));
  const [manualPhone, setManualPhone] = useState('');
  const [manualContactName, setManualContactName] = useState('');
  const [manualContactRole, setManualContactRole] = useState('');
  const [saveContact, setSaveContact] = useState(false);
  const [manualEmail, setManualEmail] = useState('');
  const [sending, setSending] = useState(false);

  // Pre-check the primary WA number and email on file whenever the dialog opens
  useEffect(() => {
    if (!open) return;
    const initial = new Set<string>();
    if (target.kind === 'school' && target.mobile1) initial.add('mobile1');
    if (target.kind === 'prospect' && target.mobile) initial.add('mobile');
    if (target.email) initial.add('email');
    setChecked(initial);
    setSelectedClasses(new Set(CLASS_OPTIONS));
  }, [open, target]);

  const toggle = (key: string) => {
    setChecked(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  const toggleClass = (cls: string) => {
    setSelectedClasses(prev => {
      const next = new Set(prev);
      next.has(cls) ? next.delete(cls) : next.add(cls);
      return next;
    });
  };

  const reset = () => {
    setManualPhone(''); setManualContactName(''); setManualContactRole(''); setSaveContact(false);
    setManualEmail(''); setDocType('ebrochure'); setSelectedClasses(new Set(CLASS_OPTIONS));
  };

  const handleSend = async () => {
    const jobs: Job[] = [];

    if (target.kind === 'school') {
      if (checked.has('mobile1') && target.mobile1) jobs.push({ channel: 'whatsapp', phone: target.mobile1 });
      if (checked.has('mobile2') && target.mobile2) jobs.push({ channel: 'whatsapp', phone: target.mobile2 });
      if (checked.has('principal_mobile') && target.principalMobile) jobs.push({ channel: 'whatsapp', phone: target.principalMobile, contactRole: 'Principal' });
      if (checked.has('coord_mobile') && target.coordMobile) jobs.push({ channel: 'whatsapp', phone: target.coordMobile, contactRole: 'Coordinator' });
      if (checked.has('corr_mobile') && target.corrMobile) jobs.push({ channel: 'whatsapp', phone: target.corrMobile, contactRole: 'Correspondent' });
    } else {
      if (checked.has('mobile') && target.mobile) jobs.push({ channel: 'whatsapp', phone: target.mobile });
    }
    target.contacts.forEach((c, i) => {
      if (checked.has(`contact_${i}`) && c.mobile) {
        jobs.push({ channel: 'whatsapp', phone: c.mobile, contactName: c.name, contactRole: c.role });
      }
    });
    if (checked.has('manual_wa')) {
      if (manualPhone.replace(/\D/g, '').length < 10) {
        toast({ title: 'Error', description: 'Please enter a valid 10-digit manual phone number', variant: 'destructive' });
        return;
      }
      jobs.push({ channel: 'whatsapp', phone: manualPhone, contactName: manualContactName || undefined, contactRole: manualContactRole || undefined, isManual: true });
    }
    if (checked.has('email') && target.email) {
      jobs.push({ channel: 'email', email: target.email });
    }
    if (checked.has('manual_email')) {
      if (!manualEmail.includes('@')) {
        toast({ title: 'Error', description: 'Please enter a valid email address', variant: 'destructive' });
        return;
      }
      jobs.push({ channel: 'email', email: manualEmail, isManual: true });
    }

    // Dedupe WA jobs by last-10-digits, email jobs by lowercased address
    const seenPhones = new Set<string>();
    const seenEmails = new Set<string>();
    const unique = jobs.filter(j => {
      if (j.channel === 'whatsapp') {
        const d = j.phone.replace(/\D/g, '').slice(-10);
        if (seenPhones.has(d)) return false;
        seenPhones.add(d);
        return true;
      }
      const e = j.email.toLowerCase();
      if (seenEmails.has(e)) return false;
      seenEmails.add(e);
      return true;
    });

    if (unique.length === 0) {
      toast({ title: 'Error', description: 'Select at least one WhatsApp number or email', variant: 'destructive' });
      return;
    }

    if (docType === 'sample_questions' && selectedClasses.size === 0) {
      toast({ title: 'Error', description: 'Select at least one class', variant: 'destructive' });
      return;
    }

    setSending(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Your login session has expired — please refresh the page and log in again.');

      let sentCount = 0;
      const failed: string[] = [];
      let firstError = '';
      const warnings: string[] = [];

      for (const job of unique) {
        const label = job.channel === 'whatsapp' ? job.phone : job.email;
        try {
          const res = await supabase.functions.invoke('send-ebrochure', {
            headers: { Authorization: `Bearer ${session.access_token}` },
            body: {
              schoolId: target.kind === 'school' ? target.schoolId : undefined,
              prospectSchoolId: target.kind === 'prospect' ? target.prospectSchoolId : undefined,
              phone: job.channel === 'whatsapp' ? job.phone : undefined,
              email: job.channel === 'email' ? job.email : undefined,
              schoolName: target.schoolName,
              district: target.district,
              state: target.state,
              saveContact: job.channel === 'whatsapp' && saveContact && job.isManual,
              contactName: job.channel === 'whatsapp' ? job.contactName : undefined,
              contactRole: job.channel === 'whatsapp' ? job.contactRole : undefined,
              docType,
              classes: docType === 'sample_questions' ? Array.from(selectedClasses) : undefined,
            },
          });
          if (res.error) {
            const body = await (res.error as any).context?.json?.().catch(() => null);
            throw new Error(body?.error || res.error.message);
          }
          if (!res.data?.success) throw new Error(res.data?.error || 'Send failed');
          sentCount++;
          if (res.data?.warning) warnings.push(res.data.warning);
        } catch (err: any) {
          failed.push(label);
          if (!firstError) firstError = err.message;
        }
      }

      if (failed.length === 0) {
        const first = unique[0];
        const firstLabel = first.channel === 'whatsapp' ? first.phone : first.email;
        const base = sentCount === 1 ? `Sent to ${firstLabel}` : `Sent to ${sentCount} recipients`;
        toast({ title: `${DOC_LABELS[docType]} sent!`, description: warnings.length ? `${base} — ${warnings.join('; ')}` : base });
      } else {
        toast({
          title: sentCount > 0 ? 'Partially sent' : 'Send failed',
          description: `${sentCount} sent · failed for ${failed.join(', ')} — ${firstError}`,
          variant: 'destructive',
        });
      }

      if (sentCount > 0) {
        const manualWaSent = checked.has('manual_wa') && !failed.includes(manualPhone);
        if (manualWaSent && saveContact && onSaveManualContact) {
          await onSaveManualContact({
            name: manualContactName,
            mobile: manualPhone.replace(/\D/g, '').slice(-10),
            role: manualContactRole || undefined,
          });
        }
        onOpenChange(false);
        reset();
        onSent?.();
      }
    } catch (err: any) {
      toast({ title: 'Send failed', description: err.message, variant: 'destructive' });
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={o => { if (!sending) { onOpenChange(o); if (!o) reset(); } }}>
      <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Send className="h-5 w-5 text-indigo-600" />
            Send {DOC_LABELS[docType]}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          {target.kind === 'school' && (
            <div>
              <Label className="text-sm font-medium mb-2 block">Document</Label>
              <div className="grid grid-cols-3 gap-2">
                {(Object.keys(DOC_LABELS) as SendDocType[]).map(dt => (
                  <button
                    key={dt}
                    type="button"
                    onClick={() => setDocType(dt)}
                    className={`px-2 py-2 rounded-md text-xs font-medium border transition-colors ${
                      docType === dt ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-700 border-gray-200 hover:border-indigo-400'
                    }`}
                  >
                    {DOC_LABELS[dt]}
                  </button>
                ))}
              </div>
            </div>
          )}

          {docType === 'sample_questions' && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <Label className="text-sm font-medium">Classes</Label>
                <button
                  type="button"
                  className="text-xs font-medium text-indigo-600 hover:underline"
                  onClick={() => setSelectedClasses(prev => prev.size === CLASS_OPTIONS.length ? new Set() : new Set(CLASS_OPTIONS))}
                >
                  {selectedClasses.size === CLASS_OPTIONS.length ? 'Clear all' : 'Select all'}
                </button>
              </div>
              <div className="grid grid-cols-5 gap-2">
                {CLASS_OPTIONS.map(cls => (
                  <label
                    key={cls}
                    className={`flex items-center justify-center gap-1 border rounded-md px-2 py-1.5 text-xs font-medium cursor-pointer transition-colors ${
                      selectedClasses.has(cls) ? 'bg-indigo-50 border-indigo-400 text-indigo-700' : 'bg-white border-gray-200 text-gray-600'
                    }`}
                  >
                    <Checkbox checked={selectedClasses.has(cls)} onCheckedChange={() => toggleClass(cls)} className="h-3.5 w-3.5" />
                    {cls}
                  </label>
                ))}
              </div>
            </div>
          )}
          <div>
            <Label className="text-sm font-medium mb-2 block">WhatsApp numbers</Label>
            <div className="space-y-2">
              {target.kind === 'school' ? (
                <>
                  <div className="flex items-center gap-3 border rounded-md px-3 py-2">
                    <Checkbox checked={checked.has('mobile1')} onCheckedChange={() => toggle('mobile1')} id="eb_m1" disabled={!target.mobile1} />
                    <Label htmlFor="eb_m1" className="cursor-pointer flex-1">
                      <span className="text-xs text-muted-foreground">Mobile 1</span>
                      <p className="font-medium">{target.mobile1 || <span className="text-muted-foreground italic">Not set</span>}</p>
                    </Label>
                  </div>
                  <div className="flex items-center gap-3 border rounded-md px-3 py-2">
                    <Checkbox checked={checked.has('mobile2')} onCheckedChange={() => toggle('mobile2')} id="eb_m2" disabled={!target.mobile2} />
                    <Label htmlFor="eb_m2" className="cursor-pointer flex-1">
                      <span className="text-xs text-muted-foreground">Mobile 2</span>
                      <p className="font-medium">{target.mobile2 || <span className="text-muted-foreground italic">Not set</span>}</p>
                    </Label>
                  </div>
                  <div className="flex items-center gap-3 border rounded-md px-3 py-2">
                    <Checkbox checked={checked.has('principal_mobile')} onCheckedChange={() => toggle('principal_mobile')} id="eb_pm" disabled={!target.principalMobile} />
                    <Label htmlFor="eb_pm" className="cursor-pointer flex-1">
                      <span className="text-xs text-muted-foreground">Principal Mobile</span>
                      <p className="font-medium">{target.principalMobile || <span className="text-muted-foreground italic">Not set</span>}</p>
                    </Label>
                  </div>
                  <div className="flex items-center gap-3 border rounded-md px-3 py-2">
                    <Checkbox checked={checked.has('coord_mobile')} onCheckedChange={() => toggle('coord_mobile')} id="eb_cm" disabled={!target.coordMobile} />
                    <Label htmlFor="eb_cm" className="cursor-pointer flex-1">
                      <span className="text-xs text-muted-foreground">Coordinator Mobile</span>
                      <p className="font-medium">{target.coordMobile || <span className="text-muted-foreground italic">Not set</span>}</p>
                    </Label>
                  </div>
                  <div className="flex items-center gap-3 border rounded-md px-3 py-2">
                    <Checkbox checked={checked.has('corr_mobile')} onCheckedChange={() => toggle('corr_mobile')} id="eb_corrm" disabled={!target.corrMobile} />
                    <Label htmlFor="eb_corrm" className="cursor-pointer flex-1">
                      <span className="text-xs text-muted-foreground">Correspondent Mobile</span>
                      <p className="font-medium">{target.corrMobile || <span className="text-muted-foreground italic">Not set</span>}</p>
                    </Label>
                  </div>
                </>
              ) : (
                <div className="flex items-center gap-3 border rounded-md px-3 py-2">
                  <Checkbox checked={checked.has('mobile')} onCheckedChange={() => toggle('mobile')} id="eb_mobile" disabled={!target.mobile} />
                  <Label htmlFor="eb_mobile" className="cursor-pointer flex-1">
                    <span className="text-xs text-muted-foreground">School Mobile</span>
                    <p className="font-medium">{target.mobile || <span className="text-muted-foreground italic">Not set</span>}</p>
                  </Label>
                </div>
              )}
              {target.contacts.map((c, i) => (
                <div key={i} className="flex items-center gap-3 border rounded-md px-3 py-2">
                  <Checkbox checked={checked.has(`contact_${i}`)} onCheckedChange={() => toggle(`contact_${i}`)} id={`eb_c${i}`} disabled={!c.mobile} />
                  <Label htmlFor={`eb_c${i}`} className="cursor-pointer flex-1">
                    <span className="text-xs text-muted-foreground">{[c.role || 'Contact', c.name].filter(Boolean).join(' — ')}</span>
                    <p className="font-medium">{c.mobile}</p>
                  </Label>
                </div>
              ))}
              <div className="flex items-center gap-3 border rounded-md px-3 py-2">
                <Checkbox checked={checked.has('manual_wa')} onCheckedChange={() => toggle('manual_wa')} id="eb_manual_wa" />
                <Label htmlFor="eb_manual_wa" className="cursor-pointer">Enter a different number</Label>
              </div>
            </div>
          </div>

          {checked.has('manual_wa') && (
            <div className="space-y-3 border-l-2 border-indigo-400 pl-3">
              <div>
                <Label htmlFor="eb_number" className="text-xs">Phone Number</Label>
                <Input id="eb_number" value={manualPhone} onChange={e => setManualPhone(e.target.value)} placeholder="10-digit mobile number" className="mt-1" />
              </div>
              <div>
                <Label htmlFor="eb_cname" className="text-xs">Contact Name (optional)</Label>
                <Input id="eb_cname" value={manualContactName} onChange={e => setManualContactName(e.target.value)} placeholder="e.g., Principal Ravi" className="mt-1" />
              </div>
              <div>
                <Label htmlFor="eb_crole" className="text-xs">Role (optional)</Label>
                <Input id="eb_crole" value={manualContactRole} onChange={e => setManualContactRole(e.target.value)} placeholder="e.g., Principal, Coordinator" className="mt-1" />
              </div>
              <div className="flex items-center gap-2">
                <input type="checkbox" id="eb_save" checked={saveContact} onChange={e => setSaveContact(e.target.checked)} className="rounded" />
                <Label htmlFor="eb_save" className="text-xs cursor-pointer">Save this number to contacts</Label>
              </div>
            </div>
          )}

          <div>
            <Label className="text-sm font-medium mb-2 block">Email</Label>
            <div className="space-y-2">
              <div className="flex items-center gap-3 border rounded-md px-3 py-2">
                <Checkbox checked={checked.has('email')} onCheckedChange={() => toggle('email')} id="eb_email" disabled={!target.email} />
                <Label htmlFor="eb_email" className="cursor-pointer flex-1">
                  <span className="text-xs text-muted-foreground">Email on file</span>
                  <p className="font-medium">{target.email || <span className="text-muted-foreground italic">Not set</span>}</p>
                </Label>
              </div>
              <div className="flex items-center gap-3 border rounded-md px-3 py-2">
                <Checkbox checked={checked.has('manual_email')} onCheckedChange={() => toggle('manual_email')} id="eb_manual_email" />
                <Label htmlFor="eb_manual_email" className="cursor-pointer">Enter a different email</Label>
              </div>
            </div>
          </div>

          {checked.has('manual_email') && (
            <div className="border-l-2 border-indigo-400 pl-3">
              <Label htmlFor="eb_email_manual" className="text-xs">Email Address</Label>
              <Input id="eb_email_manual" type="email" value={manualEmail} onChange={e => setManualEmail(e.target.value)} placeholder="school@example.com" className="mt-1" />
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <Button variant="outline" className="flex-1" onClick={() => onOpenChange(false)} disabled={sending}>Cancel</Button>
            <Button className="flex-1" onClick={handleSend} disabled={sending}>
              {sending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              {sending ? 'Sending…' : `Send ${DOC_LABELS[docType]}`}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
