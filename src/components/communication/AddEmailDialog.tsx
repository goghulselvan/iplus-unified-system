import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Mail, Loader2, AlertTriangle } from "lucide-react";
import { emailSchema } from "@/lib/security";

interface AddEmailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  schoolName: string;
  currentEmail?: string | null;
  onSave: (email: string) => Promise<void>;
}

export const AddEmailDialog = ({
  open,
  onOpenChange,
  schoolName,
  currentEmail,
  onSave,
}: AddEmailDialogProps) => {
  const [email, setEmail] = useState(currentEmail || "");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    // Validate email
    const validation = emailSchema.safeParse(email.trim());
    
    if (!validation.success) {
      setError("Please enter a valid email address");
      return;
    }

    setIsLoading(true);
    setError(null);
    
    try {
      await onSave(email.trim());
      onOpenChange(false);
    } catch (err) {
      setError("Failed to save email. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add Email Address</DialogTitle>
          <DialogDescription>
            Enter a valid email address for {schoolName} to send communications
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email Address</Label>
            <Input
              id="email"
              type="email"
              placeholder="school@example.com"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setError(null);
              }}
              disabled={isLoading}
            />
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isLoading}
          >
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isLoading}>
            {isLoading ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Mail className="h-4 w-4 mr-2" />
                Save & Continue
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
