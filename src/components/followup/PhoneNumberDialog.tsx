import { useState } from 'react';
import { School } from '@/types/database';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Card, CardContent } from '@/components/ui/card';
import { Phone, Copy } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface PhoneNumberDialogProps {
  school: School;
  isOpen: boolean;
  onClose: () => void;
}

export const PhoneNumberDialog = ({ school, isOpen, onClose }: PhoneNumberDialogProps) => {
  const { toast } = useToast();

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      toast({
        title: 'Copied',
        description: 'Phone number copied to clipboard',
      });
    });
  };

  const makeCall = (number: string) => {
    window.open(`tel:${number}`, '_self');
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Phone className="h-5 w-5" />
            Contact Numbers - {school.school_name}
          </DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4">
          {school.mobile1 && (
            <Card>
              <CardContent className="pt-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">Mobile 1</p>
                    <p className="font-mono text-lg">{school.mobile1}</p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => copyToClipboard(school.mobile1!)}
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="default"
                      size="sm"
                      onClick={() => makeCall(school.mobile1!)}
                    >
                      <Phone className="h-4 w-4" />
                      Call
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {school.mobile2 && (
            <Card>
              <CardContent className="pt-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">WhatsApp No.</p>
                    <p className="font-mono text-lg">{school.mobile2}</p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => copyToClipboard(school.mobile2!)}
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="default"
                      size="sm"
                      onClick={() => makeCall(school.mobile2!)}
                    >
                      <Phone className="h-4 w-4" />
                      Call
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {!school.mobile1 && !school.mobile2 && (
            <Card>
              <CardContent className="pt-4">
                <p className="text-center text-muted-foreground">
                  No phone numbers available for this school
                </p>
              </CardContent>
            </Card>
          )}

          {school.contact_person_name && (
            <div className="mt-4 p-3 bg-muted rounded-lg">
              <p className="text-sm text-muted-foreground">Contact Person</p>
              <p className="font-medium">{school.contact_person_name}</p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};