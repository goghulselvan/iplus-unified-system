import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { MessageCircle, Mail, MapPin } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

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

function ContactRow({ label, name, mobile }: { label: string; name?: string | null; mobile: string | null }) {
  if (!mobile) return null;
  return (
    <div className="flex items-center justify-between py-2 border-b last:border-0">
      <div>
        <p className="text-sm font-medium">{name ? `${name} (${label})` : label}</p>
        <p className="text-xs text-muted-foreground font-mono">{mobile}</p>
      </div>
      <a
        href={waLink(mobile)}
        target="_blank"
        rel="noreferrer"
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition-colors"
      >
        <MessageCircle className="h-3.5 w-3.5" /> WhatsApp
      </a>
    </div>
  );
}

export default function BuyerContactDialog({ open, onOpenChange, schoolId }: Props) {
  const [contact, setContact] = useState<SchoolContact | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !schoolId) { setContact(null); return; }
    setLoading(true);
    supabase.from('schools' as any)
      .select('id, school_name, school_address, district, state, pincode, email, mobile1, mobile2, corr_name, corr_mobile, principal_name, principal_mobile, coord_mobile')
      .eq('id', schoolId).single()
      .then(({ data }) => { setContact(data as unknown as SchoolContact); setLoading(false); });
  }, [open, schoolId]);

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
                <a
                  href={`mailto:${contact.email}`}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors"
                >
                  <Mail className="h-3.5 w-3.5" /> Email
                </a>
              </div>
            )}

            <div>
              <ContactRow label="Mobile 1" mobile={contact.mobile1} />
              <ContactRow label="WhatsApp No." mobile={contact.mobile2} />
              <ContactRow label="Correspondent" name={contact.corr_name} mobile={contact.corr_mobile} />
              <ContactRow label="Principal" name={contact.principal_name} mobile={contact.principal_mobile} />
              <ContactRow label="Coordinator" mobile={contact.coord_mobile} />
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
