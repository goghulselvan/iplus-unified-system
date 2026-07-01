import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useUpdateStudentName } from '@/hooks/useStudentRegistrations';

interface EditStudentNameDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  registrationId: string;
  currentName: string;
}

export const EditStudentNameDialog: React.FC<EditStudentNameDialogProps> = ({
  open,
  onOpenChange,
  registrationId,
  currentName,
}) => {
  const [studentName, setStudentName] = useState(currentName);
  const updateMutation = useUpdateStudentName();

  useEffect(() => {
    setStudentName(currentName);
  }, [currentName, open]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!studentName.trim()) {
      return;
    }

    updateMutation.mutate(
      {
        registrationId,
        studentName: studentName.trim(),
      },
      {
        onSuccess: () => {
          onOpenChange(false);
        },
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Student Name</DialogTitle>
          <DialogDescription>
            Update the student's name. Registration number, class, and subjects cannot be changed.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="student-name">Student Name</Label>
              <Input
                id="student-name"
                value={studentName}
                onChange={(e) => setStudentName(e.target.value)}
                placeholder="Enter student name"
                required
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={updateMutation.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={updateMutation.isPending || !studentName.trim()}>
              {updateMutation.isPending ? 'Updating...' : 'Update Name'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
