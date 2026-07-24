import { useState } from "react";
import DOMPurify from "dompurify";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { EmailStatusBadge } from "@/components/schools/EmailStatusBadge";
import { Mail, Phone, AlertTriangle, Loader2, MessageCircle, FileText } from "lucide-react";
import { emailSchema } from "@/lib/security";

interface EmailConfirmationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  school: {
    id: string;
    school_name: string;
    email?: string | null;
    mobile1?: string | null;
    ss_no: number;
  };
  templateType: string;
  templateName: string;
  emailPreview: {
    subject: string;
    body: string;
  };
  willAlsoSendWhatsApp?: boolean;
  willAttachReceipt?: boolean;
  onConfirm: () => Promise<void>;
  onSkipEmail?: () => Promise<void>;
  onAddEmail?: () => void;
}

export const EmailConfirmationDialog = ({
  open,
  onOpenChange,
  school,
  templateType,
  templateName,
  emailPreview,
  willAlsoSendWhatsApp,
  willAttachReceipt,
  onConfirm,
  onSkipEmail,
  onAddEmail,
}: EmailConfirmationDialogProps) => {
  const [isSendingEmail, setIsSendingEmail] = useState(false);
  const [isSkipping, setIsSkipping] = useState(false);

  const isValidEmail = school.email && emailSchema.safeParse(school.email).success;
  const isAnyActionInProgress = isSendingEmail || isSkipping;

  const handleSend = async () => {
    setIsSendingEmail(true);
    try {
      await onConfirm();
      onOpenChange(false);
    } catch (error) {
      console.error("Failed to send email:", error);
    } finally {
      setIsSendingEmail(false);
    }
  };

  const handleSkip = async () => {
    if (!onSkipEmail) return;
    setIsSkipping(true);
    try {
      await onSkipEmail();
      onOpenChange(false);
    } catch (error) {
      console.error("Failed to update status:", error);
    } finally {
      setIsSkipping(false);
    }
  };

  const generateWhatsAppLink = () => {
    if (!school.mobile1) return null;
    const message = emailPreview.body.replace(/<[^>]*>/g, ""); // Strip HTML
    return `https://wa.me/${school.mobile1.replace(/[^0-9]/g, "")}?text=${encodeURIComponent(message)}`;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Confirm Email Communication</DialogTitle>
          <DialogDescription>
            Review the email details before sending to {school.school_name} (SS No: {school.ss_no})
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Email Status */}
          <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
            <div className="flex items-center gap-2">
              <Mail className="h-4 w-4" />
              <span className="font-medium">Recipient Email:</span>
              <span className="text-sm text-muted-foreground">{school.email || "Not provided"}</span>
            </div>
            <EmailStatusBadge email={school.email} />
          </div>

          {/* Warning for invalid/missing email */}
          {!isValidEmail && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription className="flex items-center justify-between">
                <span>
                  {!school.email
                    ? "Email address is missing. Please add a valid email before sending."
                    : "Email format is invalid. Please correct the email address."}
                </span>
                {onAddEmail && (
                  <Button variant="outline" size="sm" onClick={onAddEmail}>
                    Fix Email
                  </Button>
                )}
              </AlertDescription>
            </Alert>
          )}

          {/* Email Preview */}
          <div className="border rounded-lg p-4 space-y-3">
            <div>
              <span className="text-sm font-medium">Template:</span>
              <span className="text-sm text-muted-foreground ml-2">{templateName}</span>
            </div>
            <div>
              <span className="text-sm font-medium">Subject:</span>
              <p className="text-sm text-muted-foreground mt-1">{emailPreview.subject}</p>
            </div>
            <div>
              <span className="text-sm font-medium">Message Preview:</span>
              <div
                className="text-sm text-muted-foreground mt-2 p-3 bg-muted rounded max-h-60 overflow-y-auto"
                dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(emailPreview.body) }}
              />
            </div>
          </div>

          {/* Receipt PDF attachment — not visible in the HTML preview above */}
          {willAttachReceipt && (
            <div className="flex items-center gap-2 p-3 bg-blue-50 border border-blue-100 rounded-lg">
              <FileText className="h-4 w-4 text-blue-600 flex-shrink-0" />
              <span className="text-sm text-blue-800">
                The payment receipt PDF will be generated and attached automatically (not shown in the preview above)
              </span>
            </div>
          )}

          {/* WhatsApp will also be sent automatically */}
          {willAlsoSendWhatsApp && school.mobile1 && (
            <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-100 rounded-lg">
              <MessageCircle className="h-4 w-4 text-green-600 flex-shrink-0" />
              <span className="text-sm text-green-800">
                WhatsApp will also be sent automatically to <strong>{school.mobile1}</strong>
              </span>
            </div>
          )}
          {!willAlsoSendWhatsApp && school.mobile1 && (
            <div className="flex items-center gap-2 p-3 bg-muted rounded-lg">
              <Phone className="h-4 w-4" />
              <span className="text-sm text-muted-foreground">No active WhatsApp template for this trigger</span>
            </div>
          )}
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isAnyActionInProgress}>
            Cancel
          </Button>
          {onSkipEmail && (
            <Button variant="secondary" onClick={handleSkip} disabled={isAnyActionInProgress}>
              {isSkipping ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Updating...
                </>
              ) : (
                <>
                  Skip Email & Update Status
                </>
              )}
            </Button>
          )}
          <Button onClick={handleSend} disabled={!isValidEmail || isAnyActionInProgress}>
            {isSendingEmail ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Sending...
              </>
            ) : willAlsoSendWhatsApp ? (
              <>
                <Mail className="h-4 w-4 mr-2" />
                Send Email + WhatsApp
              </>
            ) : (
              <>
                <Mail className="h-4 w-4 mr-2" />
                Send Email
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
