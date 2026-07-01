import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { School } from '@/types/database';
import { Badge } from '@/components/ui/badge';
import { Search, Send } from 'lucide-react';
import CommunicationWorkflowEditor from './CommunicationWorkflowEditor';
import { useWhatsAppTemplates, useSendWhatsApp } from '@/hooks/useWhatsAppTemplates';

interface CommunicationDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  selectedSchool: School | null;
  onSubmit: (data: any) => void;
  searchTerm: string;
  setSearchTerm: (term: string) => void;
  searchResults: School[];
  onSchoolSelect: (school: School) => void;
}

const CommunicationDialog = ({ 
  isOpen, 
  onOpenChange, 
  selectedSchool, 
  onSubmit, 
  searchTerm, 
  setSearchTerm, 
  searchResults, 
  onSchoolSelect 
}: CommunicationDialogProps) => {
  const [communicationType, setCommunicationType] = useState<'Phone' | 'Email' | 'WhatsApp'>('Phone');
  const [message, setMessage] = useState('');
  const [contactedPersonName, setContactedPersonName] = useState('');
  const [contactedMobileNo, setContactedMobileNo] = useState('');
  const [designation, setDesignation] = useState('');
  const [followUpDate, setFollowUpDate] = useState('');
  const [followUpTime, setFollowUpTime] = useState('');
  const [workflowUpdates, setWorkflowUpdates] = useState<any>(null);
  const [whatsappTemplateKey, setWhatsappTemplateKey] = useState<string>('');
  const [sendingWhatsapp, setSendingWhatsapp] = useState(false);
  const [whatsappError, setWhatsappError] = useState<string | null>(null);

  const { templates: whatsappTemplates } = useWhatsAppTemplates(
    selectedSchool?.current_project_id || undefined
  );
  const { send: sendWhatsapp } = useSendWhatsApp();
  const activeWhatsappTemplates = whatsappTemplates.filter((t) => t.is_active);

  const handleSendWhatsApp = async () => {
    if (!selectedSchool || !whatsappTemplateKey) return;
    setWhatsappError(null);
    setSendingWhatsapp(true);
    try {
      await sendWhatsapp({
        schoolId: selectedSchool.id,
        templateKey: whatsappTemplateKey,
        mobileOverride: contactedMobileNo || undefined,
      });
      onOpenChange(false);
    } catch (e: any) {
      let msg = e?.message || "Send failed";
      if (msg.includes("132001") || msg.toLowerCase().includes("does not exist in the translation")) {
        msg += "\n\nHint: The Language Code on this template (Admin → WhatsApp Templates) doesn't match the language it was approved in on AskEVA. Open the template's < > view in AskEVA to see the exact language code (often en_US or en_GB, not en).";
      }
      setWhatsappError(msg);
    } finally {
      setSendingWhatsapp(false);
    }
  };
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    const data = {
      communication_type: communicationType,
      message,
      contacted_person_name: contactedPersonName || undefined,
      contacted_mobile_no: contactedMobileNo || undefined,
      designation: designation || undefined,
      follow_up_date: followUpDate || undefined,
      follow_up_time: followUpTime || undefined,
      workflowUpdates: workflowUpdates || undefined
    };

    onSubmit(data);
    
    // Reset form
    setCommunicationType('Phone');
    setMessage('');
    setContactedPersonName('');
    setContactedMobileNo('');
    setDesignation('');
    setFollowUpDate('');
    setFollowUpTime('');
    setWorkflowUpdates(null);
  };

  const handleWorkflowUpdate = (updates: any) => {
    setWorkflowUpdates(updates);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            {selectedSchool ? `Log Communication - ${selectedSchool.school_name}` : 'Log New Communication'}
          </DialogTitle>
          {selectedSchool && (
            <div className="flex flex-wrap gap-2 mt-2">
              <Badge variant="outline" className="text-xs">SS: {selectedSchool.ss_no}</Badge>
              <Badge variant="outline" className="text-xs">{selectedSchool.district}</Badge>
              <Badge variant="outline" className="text-xs">{selectedSchool.board}</Badge>
            </div>
          )}
        </DialogHeader>

        <div className="space-y-4">
          {/* School Search */}
          {!selectedSchool && (
            <div>
              <Label htmlFor="school_search">Search School</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="school_search"
                  placeholder="Search by SS Number or School Name..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
              
              {searchResults.length > 0 && (
                <div className="mt-2 max-h-40 overflow-y-auto border rounded-md">
                  {searchResults.map((school) => (
                    <div
                      key={school.id}
                      className="p-2 hover:bg-accent cursor-pointer border-b last:border-b-0"
                      onClick={() => onSchoolSelect(school)}
                    >
                      <div className="font-medium">{school.school_name}</div>
                      <div className="text-sm text-muted-foreground">SS No: {school.ss_no}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {selectedSchool && (
            <form onSubmit={handleSubmit} className="space-y-4">
          {/* Communication Type */}
          <div>
            <Label htmlFor="communication-type">Communication Type *</Label>
            <Select value={communicationType} onValueChange={(value: any) => setCommunicationType(value)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Phone">Phone Call</SelectItem>
                <SelectItem value="Email">Email</SelectItem>
                <SelectItem value="WhatsApp">WhatsApp</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Message */}
          <div>
            <Label htmlFor="message">Message *</Label>
            <Textarea
              id="message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Enter communication details..."
              required
              className="h-24"
            />
          </div>

          {/* WhatsApp template picker (manual send via AskEVA) */}
          {communicationType === 'WhatsApp' && (
            <div className="border rounded-md p-3 bg-muted/30 space-y-2">
              <Label className="text-sm font-semibold">Send via AskEVA (optional)</Label>
              <p className="text-xs text-muted-foreground">
                Logging the call is independent of sending. Pick a template to actually deliver a WhatsApp message via AskEVA.
              </p>
              <div className="flex gap-2">
                <Select value={whatsappTemplateKey} onValueChange={setWhatsappTemplateKey}>
                  <SelectTrigger className="flex-1">
                    <SelectValue placeholder={
                      activeWhatsappTemplates.length === 0
                        ? "No active templates for this project"
                        : "Select template"
                    } />
                  </SelectTrigger>
                  <SelectContent>
                    {activeWhatsappTemplates.map((t) => (
                      <SelectItem key={t.id} value={t.template_key}>
                        {t.template_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  onClick={handleSendWhatsApp}
                  disabled={!whatsappTemplateKey || sendingWhatsapp}
                >
                  <Send className="h-4 w-4 mr-1" />
                  {sendingWhatsapp ? 'Sending...' : 'Send'}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Will send to <strong>{contactedMobileNo || selectedSchool?.mobile1 || '(no number)'}</strong>.
                Manage templates in Admin → WhatsApp Templates.
              </p>
              {whatsappError && (
                <div className="text-xs text-destructive bg-destructive/10 border border-destructive/30 rounded p-2 break-words whitespace-pre-line">
                  <strong>AskEVA error:</strong> {whatsappError}
                </div>
              )}
            </div>
          )}

          {/* Contact Details */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="contacted-person">Contact Person Name</Label>
              <Input
                id="contacted-person"
                value={contactedPersonName}
                onChange={(e) => setContactedPersonName(e.target.value)}
                placeholder="Person contacted"
              />
            </div>
            <div>
              <Label htmlFor="designation">Designation</Label>
              <Input
                id="designation"
                value={designation}
                onChange={(e) => setDesignation(e.target.value)}
                placeholder="Their role/position"
              />
            </div>
          </div>

          <div>
            <Label htmlFor="mobile-no">Contact Mobile Number</Label>
            <Input
              id="mobile-no"
              value={contactedMobileNo}
              onChange={(e) => setContactedMobileNo(e.target.value)}
              placeholder="Mobile number used"
            />
          </div>

          {/* Workflow Editor */}
          <CommunicationWorkflowEditor
            school={selectedSchool}
            onWorkflowUpdate={handleWorkflowUpdate}
          />

          {/* Follow-up Scheduling */}
          <div className="space-y-3">
            <Label className="text-sm font-medium">Schedule Follow-up (Optional)</Label>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="follow-up-date" className="text-xs">Follow-up Date</Label>
                <Input
                  id="follow-up-date"
                  type="date"
                  value={followUpDate}
                  onChange={(e) => setFollowUpDate(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="follow-up-time" className="text-xs">Follow-up Time</Label>
                <Input
                  id="follow-up-time"
                  type="time"
                  value={followUpTime}
                  onChange={(e) => setFollowUpTime(e.target.value)}
                />
              </div>
            </div>
          </div>

          {/* Submit Button */}
          <div className="flex justify-end gap-2 pt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button 
              type="submit" 
              disabled={
                !message.trim() || 
                (workflowUpdates?.status === 'Not Interested' && !workflowUpdates?.comment)
              }
            >
              Log Communication
              {workflowUpdates && (
                <span className="ml-2 text-xs">& Update Status</span>
              )}
            </Button>
          </div>
            </form>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default CommunicationDialog;