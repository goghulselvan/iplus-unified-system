import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { MessageCircle } from 'lucide-react';

interface WhatsAppConfirmationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  templateName: string;
  templateKey: string;
  defaultMobile: string | null | undefined;
  onConfirm: (mobileOverride?: string) => Promise<void>;
  onSkip: () => Promise<void>;
}

export const WhatsAppConfirmationDialog = ({
  open,
  onOpenChange,
  templateName,
  templateKey,
  defaultMobile,
  onConfirm,
  onSkip,
}: WhatsAppConfirmationDialogProps) => {
  const [mobile, setMobile] = useState(defaultMobile || '');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (open) setMobile(defaultMobile || '');
  }, [open, defaultMobile]);

  const handleSend = async () => {
    setSending(true);
    try {
      await onConfirm(mobile.trim() || undefined);
    } finally {
      setSending(false);
    }
  };

  const handleSkip = async () => {
    setSending(true);
    try {
      await onSkip();
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageCircle className="h-5 w-5 text-green-600" />
            Send WhatsApp notification?
          </DialogTitle>
          <DialogDescription>
            The status was updated successfully. Optionally send a WhatsApp message
            using the matching template.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="text-sm">
            <span className="text-muted-foreground">Template: </span>
            <Badge variant="secondary">{templateName}</Badge>
            <span className="ml-2 text-xs text-muted-foreground">({templateKey})</span>
          </div>

          <div>
            <Label htmlFor="wa-mobile">Recipient mobile (with country code)</Label>
            <Input
              id="wa-mobile"
              value={mobile}
              onChange={(e) => setMobile(e.target.value)}
              placeholder="e.g. 919790152371"
            />
            {!defaultMobile && (
              <p className="text-xs text-amber-600 mt-1">
                School has no mobile1 on file — enter one above to send.
              </p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleSkip} disabled={sending}>
            Skip
          </Button>
          <Button
            onClick={handleSend}
            disabled={sending || !mobile.trim()}
            className="bg-green-600 hover:bg-green-700 text-white"
          >
            {sending ? 'Sending...' : 'Send WhatsApp'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
