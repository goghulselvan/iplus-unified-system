import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { MessageCircle, Mail, MapPin, ExternalLink } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

// Fixed identifiers this dialog sends against — create matching rows for
// these once, and every send from here (any school, any invoice) uses them:
//   whatsapp_templates.template_key = 'book_order_contact' (AskEVA-approved)
//   communication_templates.template_type = 'book_order_contact'
//     (needs a row per active project, since it's project-scoped)
const WHATSAPP_TEMPLATE_KEY = 'book_order_contact';
const EMAIL_TEMPLATE_TYPE = 'book_order_contact';

type SchoolContact = {
  id: string;
  school_name: string;
  school_address: string | null;
  district: string | null;
  state: string | null;
  pincode: string | null;
  email: string | null;
  mobile1: string | null;
  mobile2: string | null;
  corr_name: string | null;
  corr_mobile: string | null;
  principal_name: string | null;
  principal_mobile: string | null;
  coord_mobile: string | null;
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  schoolId: string | null;
}

function waLink(mobile: string) {
  const digits = mobile.replace(/\D/g, '').slice(-10);
  return `https://wa.me/91${digits}`;
}

function ContactRow({ label, name, mobile, schoolId, sending, onSend }: {
  label: string; name?: string | null; mobile: string | null; schoolId: string;
  sending: boolean; onSend: (mobile: string) => void;
}) {
  if (!mobile) return null;
  return (
    <div className="flex items-center justify-between py-2 border-b last:border-0">
      <div>
        <p className="text-sm font-medium">{name ? `${name} (${label})` : label}</p>
        <p className="text-xs text-muted-foreground font-mono">{mobile}</p>
      </div>
      <div className="flex items-center gap-1.5">
        <Button size="sm" disabled={sending} onClick={() => onSend(mobile)}
          className="h-7 px-2.5 text-xs bg-emerald-600 hover:bg-emerald-700">
          <MessageCircle className="h-3.5 w-3.5 mr-1" /> {sending ? 'Sending…' : 'Send WhatsApp'}
        </Button>
        <a href={waLink(mobile)} target="_blank" rel="noreferrer" title="Open in WhatsApp Web instead"
          className="p-1.5 rounded-md text-muted-foreground hover:bg-neutral-100 transition-colors">
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </div>
    </div>
  );
}

export default function BuyerContactDialog({ open, onOpenChange, schoolId }: Props) {
  const { toast } = useToast();
  const [contact, setContact] = useState<SchoolContact | null>(null);
  const [loading, setLoading] = useState(false);
  const [sendingMobile, setSendingMobile] = useState<string | null>(null);
  const [sendingEmail, setSendingEmail] = useState(false);

  useEffect(() => {
    if (!open || !schoolId) { setContact(null); return; }
    setLoading(true);
    supabase.from('schools' as any)
      .select('id, school_name, school_address, district, state, pincode, email, mobile1, mobile2, corr_name, corr_mobile, principal_name, principal_mobile, coord_mobile')
      .eq('id', schoolId).single()
      .then(({ data }) => { setContact(data as unknown as SchoolContact); setLoading(false); });
  }, [open, schoolId]);

  const handleSendWhatsApp = async (mobile: string) => {
    if (!contact) return;
    setSendingMobile(mobile);
    const { error } = await supabase.functions.invoke('send-whatsapp-template', {
      body: { schoolId: contact.id, templateKey: WHATSAPP_TEMPLATE_KEY, mobileOverride: mobile },
    });
    setSendingMobile(null);
    if (error) { toast({ title: 'WhatsApp send failed', description: error.message, variant: 'destructive' }); return; }
    toast({ title: 'WhatsApp message sent' });
  };

  const handleSendEmail = async () => {
    if (!contact) return;
    setSendingEmail(true);
    const { error } = await supabase.functions.invoke('send-template-email', {
      body: { schoolId: contact.id, templateType: EMAIL_TEMPLATE_TYPE },
    });
    setSendingEmail(false);
    if (error) { toast({ title: 'Email send failed', description: error.message, variant: 'destructive' }); return; }
    toast({ title: 'Email sent' });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{contact?.school_name ?? 'School Contact'}</DialogTitle></DialogHeader>

        {loading ? (
          <p className="text-sm text-muted-foreground py-4">Loading…</p>
        ) : !contact ? (
          <p className="text-sm text-muted-foreground py-4">No linked school record for this buyer.</p>
        ) : (
          <div className="space-y-4">
            {(contact.school_address || contact.district || contact.state || contact.pincode) && (
              <div className="flex items-start gap-2 text-sm text-muted-foreground bg-neutral-50 rounded-md p-3">
                <MapPin className="h-4 w-4 mt-0.5 flex-shrink-0" />
                <span>
                  {[contact.school_address, contact.district, contact.state, contact.pincode].filter(Boolean).join(', ')}
                </span>
              </div>
            )}

            {contact.email && (
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Email</p>
                  <p className="text-xs text-muted-foreground">{contact.email}</p>
                </div>
                <div className="flex items-center gap-1.5">
                  <Button size="sm" disabled={sendingEmail} onClick={handleSendEmail}
                    className="h-7 px-2.5 text-xs bg-blue-600 hover:bg-blue-700">
                    <Mail className="h-3.5 w-3.5 mr-1" /> {sendingEmail ? 'Sending…' : 'Send Email'}
                  </Button>
                  <a href={`mailto:${contact.email}`} title="Open in Mail app instead"
                    className="p-1.5 rounded-md text-muted-foreground hover:bg-neutral-100 transition-colors">
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                </div>
              </div>
            )}

            <div>
              <ContactRow label="Mobile 1" mobile={contact.mobile1} schoolId={contact.id} sending={sendingMobile === contact.mobile1} onSend={handleSendWhatsApp} />
              <ContactRow label="WhatsApp No." mobile={contact.mobile2} schoolId={contact.id} sending={sendingMobile === contact.mobile2} onSend={handleSendWhatsApp} />
              <ContactRow label="Correspondent" name={contact.corr_name} mobile={contact.corr_mobile} schoolId={contact.id} sending={sendingMobile === contact.corr_mobile} onSend={handleSendWhatsApp} />
              <ContactRow label="Principal" name={contact.principal_name} mobile={contact.principal_mobile} schoolId={contact.id} sending={sendingMobile === contact.principal_mobile} onSend={handleSendWhatsApp} />
              <ContactRow label="Coordinator" mobile={contact.coord_mobile} schoolId={contact.id} sending={sendingMobile === contact.coord_mobile} onSend={handleSendWhatsApp} />
              {!contact.mobile1 && !contact.mobile2 && !contact.corr_mobile && !contact.principal_mobile && !contact.coord_mobile && (
                <p className="text-sm text-muted-foreground">No phone numbers on file.</p>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
