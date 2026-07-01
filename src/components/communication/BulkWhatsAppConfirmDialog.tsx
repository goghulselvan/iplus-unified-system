import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertTriangle } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  templateName: string;
  recipientCount: number;
  onConfirm: () => void;
}

export const BulkWhatsAppConfirmDialog = ({
  open, onOpenChange, templateName, recipientCount, onConfirm,
}: Props) => {
  const [typed, setTyped] = useState("");
  useEffect(() => { if (open) setTyped(""); }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-600" />
            Confirm bulk WhatsApp send
          </DialogTitle>
          <DialogDescription>
            You are about to send the template <strong>{templateName}</strong> to{" "}
            <strong>{recipientCount}</strong> school{recipientCount === 1 ? "" : "s"}.
            <br />
            Each message counts toward your AskEVA quota and cannot be recalled.
          </DialogDescription>
        </DialogHeader>
        <div className="py-2">
          <Label htmlFor="confirm-send">Type <code>SEND</code> to confirm</Label>
          <Input
            id="confirm-send"
            autoFocus
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder="SEND"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            disabled={typed !== "SEND" || recipientCount === 0}
            onClick={onConfirm}
            className="bg-green-600 hover:bg-green-700 text-white"
          >
            Send to {recipientCount}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
