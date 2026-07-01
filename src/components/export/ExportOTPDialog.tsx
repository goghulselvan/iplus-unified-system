import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Mail, Shield } from 'lucide-react';

interface ExportOTPDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onVerified: () => void;
}

const ExportOTPDialog = ({ isOpen, onClose, onVerified }: ExportOTPDialogProps) => {
  const { user } = useAuth();
  const userEmail = user?.email || '';
  const [otp, setOtp] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [sending, setSending] = useState(false);
  const { toast } = useToast();

  const sendOTP = async () => {
    if (!userEmail.trim()) {
      toast({
        title: 'Error',
        description: 'User email not found',
        variant: 'destructive',
      });
      return;
    }

    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke('send-export-otp', {
        body: { email: userEmail }
      });

      if (error) throw error;

      setOtpSent(true);
      toast({
        title: 'OTP Sent',
        description: 'Verification code has been sent to your email',
      });
    } catch (error: any) {
      toast({
        title: 'Error',
        description: 'Failed to send OTP. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setSending(false);
    }
  };

  const verifyOTP = async () => {
    if (!otp.trim()) {
      toast({
        title: 'Error',
        description: 'Please enter the verification code',
        variant: 'destructive',
      });
      return;
    }

    setVerifying(true);
    
    try {
      const { data, error } = await supabase.functions.invoke('verify-export-otp', {
        body: { otp: otp.trim() }
      });

      if (error) throw error;

      if (data?.verified) {
        toast({
          title: 'Verified',
          description: 'Email verification successful. Proceeding with export...',
        });
        onVerified();
        resetDialog();
      } else {
        toast({
          title: 'Invalid Code',
          description: 'The verification code is incorrect. Please try again.',
          variant: 'destructive',
        });
      }
    } catch (error: any) {
      toast({
        title: 'Verification Failed',
        description: 'Failed to verify OTP. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setVerifying(false);
    }
  };

  const resetDialog = () => {
    setOtp('');
    setOtpSent(false);
    setVerifying(false);
    setSending(false);
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={resetDialog}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" />
            Export Security Verification
          </DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4">
          <div className="text-sm text-muted-foreground">
            For security purposes, please verify your email to proceed with the export.
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="email">Email Address</Label>
            <Input
              id="email"
              type="email"
              value={userEmail}
              disabled={true}
              placeholder="Your account email"
              className="bg-muted"
            />
          </div>

          {!otpSent ? (
            <Button 
              onClick={sendOTP} 
              disabled={sending || !userEmail.trim()}
              className="w-full"
            >
              <Mail className="h-4 w-4 mr-2" />
              {sending ? 'Sending...' : 'Send Verification Code'}
            </Button>
          ) : (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="otp">Verification Code</Label>
                <Input
                  id="otp"
                  type="text"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value)}
                  placeholder="Enter 6-digit code"
                  maxLength={6}
                />
                <div className="text-xs text-muted-foreground">
                  Check your email for the 6-digit verification code
                </div>
              </div>
              
              <div className="flex gap-2">
                <Button 
                  variant="outline" 
                  onClick={() => setOtpSent(false)}
                  className="flex-1"
                >
                  Resend Code
                </Button>
                <Button 
                  onClick={verifyOTP}
                  disabled={verifying || !otp.trim()}
                  className="flex-1"
                >
                  {verifying ? 'Verifying...' : 'Verify & Export'}
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default ExportOTPDialog;