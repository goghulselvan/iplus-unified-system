import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { School } from '@/types/database';
import { useAuth } from '@/hooks/useAuth';
import { useSchoolsPaginated } from '@/hooks/useSchoolsPaginated';
import { WorkflowPipeline } from '@/components/schools/WorkflowPipeline';
import { PortalRegistrationJourney } from '@/components/schools/PortalRegistrationJourney';
import { useFollowUps } from '@/hooks/useFollowUps';
import { useCommunications } from '@/hooks/useCommunications';
import { useActiveProject } from '@/hooks/useOlympiadProjects';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import Navbar from '@/components/layout/Navbar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ArrowLeft, Calendar, Clock, MessageSquare, User, Phone, Mail, Edit, Save, X, Download, Bot, Send, Plus, Trash2, PhoneCall, Loader2, Globe } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { format } from 'date-fns';
import WorkflowEditor from '@/components/workflow/WorkflowEditor';
import ConsentFormManager from '@/components/consent/ConsentFormManager';
import WorkflowStatusBadge from '@/components/workflow/WorkflowStatusBadge';
import StudentRegistrationForm from '@/components/olympiad/StudentRegistrationFormSimple';
import { EnhancedPaymentTracker } from '@/components/schools/EnhancedPaymentTracker';
import { ExamScheduleManager } from '@/components/schools/ExamScheduleManager';
import { RegistrationSummaryTable } from '@/components/schools/RegistrationSummaryTable';
import { SchoolResultsSummary } from '@/components/results/SchoolResultsSummary';
import { PortalRegistrationView } from '@/components/schools/PortalRegistrationView';
import { SendEbrochureDialog } from '@/components/schools/SendEbrochureDialog';
import { useToast } from '@/hooks/use-toast';

const SchoolDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const { updateSchool, getSchoolById, getFilterOptions, getDistrictsByState, getBoardsFromDatabase } = useSchoolsPaginated();
  const { createFollowUp } = useFollowUps();
  const { communications, addCommunication } = useCommunications(id);
  const { data: activeProject } = useActiveProject();
  const { data: portalStudentCount = 0 } = useQuery({
    queryKey: ['portal-student-count', id],
    enabled: !!id,
    queryFn: async () => {
      const { count } = await supabase
        .from('portal_registered_students')
        .select('id', { count: 'exact', head: true })
        .eq('school_id', id!)
        .eq('project_id', 'dd5de83d-64f8-4113-a231-27024058396b');
      return count ?? 0;
    },
  });
  const { toast } = useToast();
  
  const [school, setSchool] = useState<School | null>(null);
  const [loading, setLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState<Partial<School>>({});
  
  // Dropdown options for fixed values
  const [states, setStates] = useState<string[]>([
    'TAMIL NADU', 'PUDUCHERRY', 'ANDHRA PRADESH', 'ARUNACHAL PRADESH', 'ASSAM', 
    'BIHAR', 'CHHATTISGARH', 'GOA', 'GUJARAT', 'HARYANA', 'HIMACHAL PRADESH', 
    'JHARKHAND', 'KARNATAKA', 'KERALA', 'MADHYA PRADESH', 'MAHARASHTRA', 
    'MANIPUR', 'MEGHALAYA', 'MIZORAM', 'NAGALAND', 'ODISHA', 'PUNJAB', 
    'RAJASTHAN', 'SIKKIM', 'TELANGANA', 'TRIPURA', 'UTTAR PRADESH', 
    'UTTARAKHAND', 'WEST BENGAL', 'ANDAMAN AND NICOBAR ISLANDS', 'CHANDIGARH', 
    'DADRA AND NAGAR HAVELI AND DAMAN AND DIU', 'DELHI', 'JAMMU AND KASHMIR', 
    'LADAKH', 'LAKSHADWEEP'
  ]);
  const [districts, setDistricts] = useState<string[]>([]);
  const [boards, setBoards] = useState<string[]>([]);
  
  const [newCommunication, setNewCommunication] = useState({
    type: 'Phone' as 'Phone' | 'Email' | 'WhatsApp',
    message: '',
    contactedPersonName: '',
    contactedMobileNo: '',
    designation: '',
  });
  
  const [followUpDate, setFollowUpDate] = useState('');
  const [followUpTime, setFollowUpTime] = useState('');

  // Mobile field handler — digits only, keep the LAST 10 (not first 10), so
  // pasting with a +91/91/0 prefix keeps the real number instead of the
  // country code plus a truncated tail (was causing wrong numbers → WA
  // sends silently failing on schools whose number was pasted this way).
  const onMobileChange = (field: string, val: string) =>
    setEditForm(prev => ({ ...prev, [field]: val.replace(/\D/g, '').slice(-10) }));

  // Click2Call via Bonvoice
  const [callDialogOpen, setCallDialogOpen] = useState(false);
  const [callTargetPhone, setCallTargetPhone] = useState('');
  const [callStaffPhone, setCallStaffPhone] = useState('7598321769');
  const [calling, setCalling] = useState(false);

  const initiateClick2Call = async () => {
    if (!callTargetPhone || !callStaffPhone) return;
    setCalling(true);
    try {
      const { error } = await supabase.functions.invoke('bonvoice-click2call', {
        body: {
          type: 'click2call',
          school_phone: callTargetPhone,
          staff_phone: callStaffPhone,
        },
      });
      if (error) throw new Error(error.message);
      // Log communication via hook (handles project_id, activity_log, workflow status)
      await addCommunication(
        id!,
        'Phone',
        `Click2Call initiated to ${callTargetPhone} via Bonvoice`,
        undefined,
        callTargetPhone,
      );
      toast({ title: 'Call initiated!', description: `Bonvoice will call you (${callStaffPhone}), then connect to the school.` });
      setCallDialogOpen(false);
    } catch (e: any) {
      toast({ title: 'Call failed', description: e.message, variant: 'destructive' });
    } finally {
      setCalling(false);
    }
  };

  const [ebrochureOpen, setEbrochureOpen] = useState(false);

  // Fetch school data when component mounts or ID changes
  useEffect(() => {
    const fetchSchool = async () => {
      if (!id || authLoading || !user) return;

      setLoading(true);
      const { data, error } = await getSchoolById(id);
      
      if (error) {
        toast({
          title: 'Error',
          description: 'Failed to fetch school details',
          variant: 'destructive',
        });
      } else {
        setSchool(data);
      }
      
      setLoading(false);
    };

    fetchSchool();
  }, [id, getSchoolById, user, authLoading]);

  // Initialize edit form when school loads or edit mode starts
  useEffect(() => {
    if (school && isEditing) {
      setEditForm({
        school_name: school.school_name,
        ss_no: school.ss_no,
        school_address: school.school_address,
        district: school.district,
        state: school.state,
        board: school.board,
        mobile1: school.mobile1 || '',
        mobile2: school.mobile2 || '',
        email: school.email || '',
        contact_person_name: school.contact_person_name || '',
        pincode: school.pincode,
        registration_interest: school.registration_interest,
        registration_interest_comment: school.registration_interest_comment || '',
        consent_form_requested: school.consent_form_requested,
        consent_form_comment: school.consent_form_comment || '',
        address1: school.address1 || '',
        address2: school.address2 || '',
        iplus_coordinator: school.iplus_coordinator || '',
        corr_name: school.corr_name || '',
        corr_mobile: school.corr_mobile || '',
        principal_name: school.principal_name || '',
        principal_mobile: school.principal_mobile || '',
        coord_mobile: school.coord_mobile || '',
        teacher_epo: school.teacher_epo || '',
        teacher_epo_mob: school.teacher_epo_mob || '',
        teacher_mpo: school.teacher_mpo || '',
        teacher_mpo_mob: school.teacher_mpo_mob || '',
        teacher_spo: school.teacher_spo || '',
        teacher_spo_mob: school.teacher_spo_mob || '',
        teacher_gksspo: school.teacher_gksspo || '',
        teacher_gksspo_mob: school.teacher_gksspo_mob || '',
        teacher_lrpo: school.teacher_lrpo || '',
        teacher_lrpo_mob: school.teacher_lrpo_mob || '',
        teacher_kidspo: school.teacher_kidspo || '',
        teacher_kidspo_mob: school.teacher_kidspo_mob || '',
      });
    }
  }, [school, isEditing]);

  // Load dropdown options when editing starts
  useEffect(() => {
    if (isEditing) {
      const loadOptions = async () => {
        try {
          console.log('Loading boards...');
          // Load boards only (states are already preset)
          const boardsData = await getBoardsFromDatabase();
          console.log('Loaded boards:', boardsData);
          setBoards(boardsData);
          
          // Load districts for current state if one is selected
          if (editForm.state) {
            console.log('Loading districts for state:', editForm.state);
            const stateDistricts = await getDistrictsByState(editForm.state);
            console.log('Loaded districts:', stateDistricts);
            setDistricts(stateDistricts);
          }
        } catch (error) {
          console.error('Error loading filter options:', error);
        }
      };
      loadOptions();
    }
  }, [isEditing, getBoardsFromDatabase, getDistrictsByState]);

  // Load districts when state changes
  useEffect(() => {
    if (isEditing && editForm.state) {
      const loadDistricts = async () => {
        try {
          const stateDistricts = await getDistrictsByState(editForm.state);
          setDistricts(stateDistricts);
          // Clear district if it's not valid for the new state
          if (editForm.district && !stateDistricts.includes(editForm.district)) {
            setEditForm(prev => ({ ...prev, district: '' }));
          }
        } catch (error) {
          console.error('Error loading districts:', error);
        }
      };
      loadDistricts();
    }
  }, [editForm.state, isEditing, getDistrictsByState]);

  const handleSchoolUpdate = async (updates: Partial<School>) => {
    if (school) {
      // For workflow updates, just update local state since the workflow hook handles DB updates
      setSchool(prev => prev ? { ...prev, ...updates } : null);
    }
  };

  const handleSaveEdit = async () => {
    if (!school) return;
    
    try {
      // Only include fields that have actually changed from the original school data
      const updates: Partial<School> = {};
      
      // Helper function to check if a value has actually changed
      const hasChanged = (newValue: any, originalValue: any) => {
        // Handle null vs empty string equivalence
        const normalizeValue = (val: any) => {
          if (val === null || val === undefined || val === '') return null;
          return val;
        };
        
        console.log('Checking changes for mobile1:', {
          editForm: editForm.mobile1,
          school: school.mobile1,
          editFormNormalized: normalizeValue(editForm.mobile1),
          schoolNormalized: normalizeValue(school.mobile1)
        });
        
        console.log('Checking changes for mobile2:', {
          editForm: editForm.mobile2,
          school: school.mobile2,
          editFormNormalized: normalizeValue(editForm.mobile2),
          schoolNormalized: normalizeValue(school.mobile2)
        });
        
        console.log('Checking changes for email:', {
          editForm: editForm.email,
          school: school.email,
          editFormNormalized: normalizeValue(editForm.email),
          schoolNormalized: normalizeValue(school.email)
        });
        
        return normalizeValue(newValue) !== normalizeValue(originalValue);
      };
      
      // Check each field and only include if it's different from the original
      if (hasChanged(editForm.ss_no, school.ss_no)) updates.ss_no = editForm.ss_no;
      if (hasChanged(editForm.school_name, school.school_name)) updates.school_name = editForm.school_name;
      if (hasChanged(editForm.school_address, school.school_address)) updates.school_address = editForm.school_address;
      if (hasChanged(editForm.pincode, school.pincode)) updates.pincode = editForm.pincode;
      
      // For state, district, board - only update if explicitly changed and not empty
      if (editForm.state && editForm.state !== school.state) updates.state = editForm.state;
      if (editForm.district && editForm.district !== school.district) updates.district = editForm.district;
      if (editForm.board && editForm.board !== school.board) updates.board = editForm.board;
      
      // Always include contact fields to prevent them from being nullified
      // This ensures that partial updates don't accidentally clear other contact fields
      updates.mobile1 = editForm.mobile1?.trim() || null;
      updates.mobile2 = editForm.mobile2?.trim() || null;
      updates.email = editForm.email?.trim() || null;
      if (hasChanged(editForm.contact_person_name, school.contact_person_name)) {
        updates.contact_person_name = editForm.contact_person_name?.trim() || null;
      }
      
      // Handle workflow fields if they exist in the form
      if ('registration_interest' in editForm && editForm.registration_interest !== school.registration_interest) {
        updates.registration_interest = editForm.registration_interest;
      }
      if (hasChanged(editForm.registration_interest_comment, school.registration_interest_comment)) {
        updates.registration_interest_comment = editForm.registration_interest_comment?.trim() || null;
      }
      if ('consent_form_requested' in editForm && editForm.consent_form_requested !== school.consent_form_requested) {
        updates.consent_form_requested = editForm.consent_form_requested;
      }
      if (hasChanged(editForm.consent_form_comment, school.consent_form_comment)) {
        updates.consent_form_comment = editForm.consent_form_comment?.trim() || null;
      }

      // Address fields
      if (hasChanged(editForm.address1, school.address1)) updates.address1 = editForm.address1?.trim() || null;
      if (hasChanged(editForm.address2, school.address2)) updates.address2 = editForm.address2?.trim() || null;

      // Contact fields from registration
      if (hasChanged(editForm.iplus_coordinator, school.iplus_coordinator)) updates.iplus_coordinator = editForm.iplus_coordinator?.trim() || null;
      if (hasChanged(editForm.corr_name, school.corr_name)) updates.corr_name = editForm.corr_name?.trim() || null;
      if (hasChanged(editForm.corr_mobile, school.corr_mobile)) updates.corr_mobile = editForm.corr_mobile?.trim() || null;
      if (hasChanged(editForm.principal_name, school.principal_name)) updates.principal_name = editForm.principal_name?.trim() || null;
      if (hasChanged(editForm.principal_mobile, school.principal_mobile)) updates.principal_mobile = editForm.principal_mobile?.trim() || null;
      if (hasChanged(editForm.coord_mobile, school.coord_mobile)) updates.coord_mobile = editForm.coord_mobile?.trim() || null;

      // Teacher fields
      if (hasChanged(editForm.teacher_epo, school.teacher_epo)) updates.teacher_epo = editForm.teacher_epo?.trim() || null;
      if (hasChanged(editForm.teacher_epo_mob, school.teacher_epo_mob)) updates.teacher_epo_mob = editForm.teacher_epo_mob?.trim() || null;
      if (hasChanged(editForm.teacher_mpo, school.teacher_mpo)) updates.teacher_mpo = editForm.teacher_mpo?.trim() || null;
      if (hasChanged(editForm.teacher_mpo_mob, school.teacher_mpo_mob)) updates.teacher_mpo_mob = editForm.teacher_mpo_mob?.trim() || null;
      if (hasChanged(editForm.teacher_spo, school.teacher_spo)) updates.teacher_spo = editForm.teacher_spo?.trim() || null;
      if (hasChanged(editForm.teacher_spo_mob, school.teacher_spo_mob)) updates.teacher_spo_mob = editForm.teacher_spo_mob?.trim() || null;
      if (hasChanged(editForm.teacher_gksspo, school.teacher_gksspo)) updates.teacher_gksspo = editForm.teacher_gksspo?.trim() || null;
      if (hasChanged(editForm.teacher_gksspo_mob, school.teacher_gksspo_mob)) updates.teacher_gksspo_mob = editForm.teacher_gksspo_mob?.trim() || null;
      if (hasChanged(editForm.teacher_lrpo, school.teacher_lrpo)) updates.teacher_lrpo = editForm.teacher_lrpo?.trim() || null;
      if (hasChanged(editForm.teacher_lrpo_mob, school.teacher_lrpo_mob)) updates.teacher_lrpo_mob = editForm.teacher_lrpo_mob?.trim() || null;
      if (hasChanged(editForm.teacher_kidspo, school.teacher_kidspo)) updates.teacher_kidspo = editForm.teacher_kidspo?.trim() || null;
      if (hasChanged(editForm.teacher_kidspo_mob, school.teacher_kidspo_mob)) updates.teacher_kidspo_mob = editForm.teacher_kidspo_mob?.trim() || null;

      console.log('Final updates object:', updates);
      
      // If no changes were made, just exit
      if (Object.keys(updates).length === 0) {
        setIsEditing(false);
        toast({
          title: 'No Changes',
          description: 'No changes were made to the school details',
        });
        return;
      }
      
      console.log('Sending updates to database:', updates);
      const result = await updateSchool(school.id, updates, true); // Enable manual edit mode
      if (result.error) {
        toast({
          title: 'Error',
          description: `Failed to update school details: ${result.error.message || 'Unknown error'}`,
          variant: 'destructive',
        });
      } else {
        // Update local state with the changes
        setSchool(prev => prev ? { ...prev, ...updates } : null);
        toast({
          title: 'Success',
          description: 'School details updated successfully',
        });
        setIsEditing(false);
      }
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to update school details',
        variant: 'destructive',
      });
    }
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    setEditForm({});
  };

  const handleAddCommunication = async () => {
    if (!newCommunication.message.trim() || !id) return;

    // Check mandatory fields for Phone and WhatsApp
    if ((newCommunication.type === 'Phone' || newCommunication.type === 'WhatsApp') && 
        (!newCommunication.contactedPersonName || !newCommunication.contactedMobileNo || !newCommunication.designation)) {
      toast({
        title: 'Error',
        description: 'Contacted person name, mobile number, and designation are required for phone and WhatsApp communications',
        variant: 'destructive',
      });
      return;
    }

    const result = await addCommunication(
      id,
      newCommunication.type,
      newCommunication.message,
      newCommunication.contactedPersonName,
      newCommunication.contactedMobileNo,
      newCommunication.designation
    );

    if (result.error) {
      console.error('Communication logging failed:', result.error);
      return;
    }

    // Create follow-up if provided
    if (followUpDate) {
      const followUpResult = await createFollowUp(id, followUpDate, followUpTime || '09:00');
      if (followUpResult.error) {
        console.error('Follow-up creation failed:', followUpResult.error);
      }
    }

    // Reset form
    setNewCommunication({ 
      type: 'Phone', 
      message: '', 
      contactedPersonName: '', 
      contactedMobileNo: '', 
      designation: '' 
    });
    setFollowUpDate('');
    setFollowUpTime('');
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="text-center py-12">
            <div className="text-lg font-medium mb-2">Loading...</div>
            <p className="text-muted-foreground">Fetching school details...</p>
          </div>
        </div>
      </div>
    );
  }

  if (!school) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="text-center py-12">
            <h3 className="text-lg font-medium mb-2">School Not Found</h3>
            <p className="text-muted-foreground mb-4">
              The school you're looking for doesn't exist.
            </p>
            <Button onClick={() => navigate('/schools')}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Schools
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <Button 
            variant="ghost" 
            onClick={() => navigate(-1)}
            className="mb-4"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Schools
          </Button>
          
          <div className="flex justify-between items-start">
            <div>
              <h1 className="text-3xl font-bold text-foreground">{school.school_name}</h1>
              <div className="flex items-center gap-2 mt-2">
                <p className="text-muted-foreground">SS No: {school.ss_no}</p>
                {school.portal_registered ? (
                  <Badge variant="outline" className="border-blue-300 bg-blue-50 text-blue-700 gap-1">
                    <Globe className="h-3 w-3" /> Portal
                  </Badge>
                ) : (
                  <Badge variant="outline" className="border-gray-300 bg-gray-50 text-gray-600 gap-1">
                    <Phone className="h-3 w-3" /> Manual
                  </Badge>
                )}
              </div>
            </div>
            <div className="flex items-center space-x-2">
              <Button 
                variant="outline" 
                onClick={() => {
                  // Export school ledger
                  try {
                    const headers = [
                      'Field', 'Value'
                    ];

                    const schoolData = [
                      ['SS No', school.ss_no],
                      ['School Name', school.school_name],
                      ['Address', school.school_address],
                      ['District', school.district],
                      ['Board', school.board],
                      ['Pincode', school.pincode],
                      ['Contact Person', school.contact_person_name || ''],
                      ['Mobile 1', school.mobile1 || ''],
                      ['WhatsApp No.', school.mobile2 || ''],
                      ['Email', school.email || ''],
                      ['', ''], // Empty row
                      ['WORKFLOW STATUS', ''],
                      ['Courier Status', school.courier_status],
                      ['Contacted', school.contacted],
                      ['Registration Interest', school.registration_interest || ''],
                      ['Consent Form Requested', school.consent_form_requested],
                      ['Consent Form Sent', school.consent_form_sent || ''],
                      ['Registration Status', school.registration_status],
                      ['Name List Status', school.name_list_status],
                      ['Payment Status', school.payment_status],
                      ['Payment Mode', school.payment_mode || ''],
                      ['Payment Date', school.payment_date || ''],
                      ['Payment Amount', school.payment_amount || ''],
                      ['Question Paper Sent', school.question_paper_sent],
                      ['Answer Sheet Status', school.answer_sheet_status],
                      ['Result Status', school.result_status],
                      ['', ''], // Empty row
                      ['COMMENTS', ''],
                      ['Registration Interest Comment', school.registration_interest_comment || ''],
                      ['Consent Form Comment', school.consent_form_comment || ''],
                      ['', ''], // Empty row
                      ['COMMUNICATIONS', ''],
                      ...communications.map(comm => [
                        `${comm.communication_type} - ${format(new Date(comm.created_at), 'MMM dd, yyyy HH:mm')}`,
                        comm.message
                      ])
                    ];

                    const csvContent = [
                      headers,
                      ...schoolData
                    ].map(row => row.map(cell => `"${cell}"`).join(',')).join('\n');

                    const blob = new Blob([csvContent], { type: 'text/csv' });
                    const url = window.URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `school_ledger_${school.ss_no}_${school.school_name.replace(/[^a-zA-Z0-9]/g, '_')}_${new Date().toISOString().split('T')[0]}.csv`;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    window.URL.revokeObjectURL(url);

                    toast({
                      title: 'Success',
                      description: 'School ledger exported successfully'
                    });
                  } catch (error: any) {
                    toast({
                      title: 'Error',
                      description: error.message || 'Failed to export school ledger',
                      variant: 'destructive',
                    });
                  }
                }}
              >
                <Download className="h-4 w-4 mr-2" />
                Export Ledger
              </Button>
              <Button variant="default" onClick={() => setEbrochureOpen(true)}>
                <Send className="h-4 w-4 mr-2" />
                Send Message
              </Button>
              <WorkflowStatusBadge school={school} />
            </div>
          </div>
        </div>

        <WorkflowPipeline school={school} />

        {school.portal_registered && <PortalRegistrationJourney school={school} />}

        <SendEbrochureDialog
          open={ebrochureOpen}
          onOpenChange={setEbrochureOpen}
          target={{
            kind: 'school',
            schoolId: id!,
            schoolName: school.school_name,
            district: school.district,
            state: school.state,
            mobile1: school.mobile1 ?? null,
            mobile2: school.mobile2 ?? null,
            email: school.email ?? null,
            contacts: school.additional_contacts ?? [],
            principalMobile: school.principal_mobile ?? null,
            coordMobile: school.coord_mobile ?? null,
            corrMobile: school.corr_mobile ?? null,
          }}
          onSent={async () => {
            const { data } = await supabase.from('schools').select('*').eq('id', id).single();
            if (data) setSchool(data as any);
          }}
        />

        {/* Click2Call dialog */}
        <Dialog open={callDialogOpen} onOpenChange={open => { if (!calling) setCallDialogOpen(open); }}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <PhoneCall className="h-5 w-5 text-green-600" />
                Click2Call
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-1">
              <div>
                <Label className="text-xs text-muted-foreground">Calling school number</Label>
                <p className="font-mono font-semibold text-gray-900 mt-0.5">{callTargetPhone}</p>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block">Your phone (staff)</Label>
                <Input
                  type="tel"
                  placeholder="10-digit mobile"
                  value={callStaffPhone}
                  onChange={e => setCallStaffPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
                  className="h-9"
                />
                <p className="text-xs text-muted-foreground mt-1.5">Bonvoice calls your phone first, then bridges to the school.</p>
              </div>
              <div className="flex gap-2 pt-1">
                <Button className="flex-1 bg-green-600 hover:bg-green-700" onClick={initiateClick2Call} disabled={calling || callStaffPhone.length !== 10}>
                  {calling ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <PhoneCall className="h-4 w-4 mr-2" />}
                  {calling ? 'Initiating…' : 'Call Now'}
                </Button>
                <Button variant="outline" onClick={() => setCallDialogOpen(false)} disabled={calling}>Cancel</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        <Tabs defaultValue="details" className="space-y-6">
          <TabsList className="flex-wrap h-auto gap-1">
            <TabsTrigger value="details">School Details</TabsTrigger>
            <TabsTrigger value="workflow">School Status</TabsTrigger>
            <TabsTrigger value="consent">Consent Form</TabsTrigger>
            <TabsTrigger value="payment">Payment</TabsTrigger>
            <TabsTrigger value="portal-reg">Name List</TabsTrigger>
            <TabsTrigger value="summary">Summary</TabsTrigger>
            <TabsTrigger value="exams">Exam Dates</TabsTrigger>
            <TabsTrigger value="communications">Communications</TabsTrigger>
            <TabsTrigger value="results">Results</TabsTrigger>
            <TabsTrigger value="students">Archived</TabsTrigger>
          </TabsList>

          <TabsContent value="details">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>School Information</CardTitle>
                  <div className="flex space-x-2">
                    {!isEditing ? (
                      <Button onClick={() => setIsEditing(true)} variant="outline">
                        <Edit className="h-4 w-4 mr-2" />
                        Edit Details
                      </Button>
                    ) : (
                      <>
                        <Button onClick={handleSaveEdit} variant="default">
                          <Save className="h-4 w-4 mr-2" />
                          Save Changes
                        </Button>
                        <Button onClick={handleCancelEdit} variant="outline">
                          <X className="h-4 w-4 mr-2" />
                          Cancel
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {!isEditing ? (
                  <div className="space-y-8">
                    {/* Basic Info */}
                    <div>
                      <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-4">Basic Information</h4>
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        <div>
                          <Label className="text-sm font-medium text-muted-foreground">School Name</Label>
                          <p className="text-sm font-medium mt-1">{school.school_name}</p>
                        </div>
                        <div>
                          <Label className="text-sm font-medium text-muted-foreground">SS Number</Label>
                          <p className="text-sm font-medium mt-1">{school.ss_no}</p>
                        </div>
                        <div>
                          <Label className="text-sm font-medium text-muted-foreground">State</Label>
                          <p className="text-sm font-medium mt-1">{school.state}</p>
                        </div>
                        <div>
                          <Label className="text-sm font-medium text-muted-foreground">District</Label>
                          <p className="text-sm font-medium mt-1">{school.district}</p>
                        </div>
                        <div>
                          <Label className="text-sm font-medium text-muted-foreground">Board</Label>
                          <p className="text-sm font-medium mt-1">{school.board}</p>
                        </div>
                        <div>
                          <Label className="text-sm font-medium text-muted-foreground">Pincode</Label>
                          <p className="text-sm font-medium mt-1">{school.pincode}</p>
                        </div>
                        <div>
                          <Label className="text-sm font-medium text-muted-foreground">Email</Label>
                          <p className="text-sm font-medium mt-1">{school.email || 'N/A'}</p>
                        </div>
                        <div>
                          <Label className="text-sm font-medium text-muted-foreground">Mobile 1</Label>
                          <div className="flex items-center gap-2 mt-1">
                            <p className="text-sm font-medium">{school.mobile1 || 'N/A'}</p>
                            {school.mobile1 && (
                              <button
                                onClick={() => { setCallTargetPhone(school.mobile1!); setCallDialogOpen(true); }}
                                className="flex items-center gap-1 px-1.5 py-0.5 rounded text-xs bg-green-50 border border-green-200 text-green-700 hover:bg-green-100 transition-colors"
                                title="Click2Call via Bonvoice"
                              >
                                <PhoneCall className="h-3 w-3" /> Call
                              </button>
                            )}
                          </div>
                        </div>
                        <div>
                          <Label className="text-sm font-medium text-muted-foreground">WhatsApp No.</Label>
                          <div className="flex items-center gap-2 mt-1">
                            <p className="text-sm font-medium">{school.mobile2 || 'N/A'}</p>
                            {school.mobile2 && (
                              <button
                                onClick={() => { setCallTargetPhone(school.mobile2!); setCallDialogOpen(true); }}
                                className="flex items-center gap-1 px-1.5 py-0.5 rounded text-xs bg-green-50 border border-green-200 text-green-700 hover:bg-green-100 transition-colors"
                                title="Click2Call via Bonvoice"
                              >
                                <PhoneCall className="h-3 w-3" /> Call
                              </button>
                            )}
                          </div>
                        </div>
                        <div className="md:col-span-2">
                          <Label className="text-sm font-medium text-muted-foreground">Address 1</Label>
                          <p className="text-sm font-medium mt-1">{school.address1 || school.school_address || 'N/A'}</p>
                        </div>
                        <div>
                          <Label className="text-sm font-medium text-muted-foreground">Address 2</Label>
                          <p className="text-sm font-medium mt-1">{school.address2 || 'N/A'}</p>
                        </div>
                      </div>
                    </div>

                    {/* Contacts */}
                    <div>
                      <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-4">Contact Persons</h4>
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        <div>
                          <Label className="text-sm font-medium text-muted-foreground">Correspondent Name</Label>
                          <p className="text-sm font-medium mt-1">{school.corr_name || school.contact_person_name || 'N/A'}</p>
                        </div>
                        <div>
                          <Label className="text-sm font-medium text-muted-foreground">Correspondent Mobile</Label>
                          <div className="flex items-center gap-2 mt-1">
                            <p className="text-sm font-medium">{school.corr_mobile || 'N/A'}</p>
                            {school.corr_mobile && (
                              <button
                                onClick={() => { setCallTargetPhone(school.corr_mobile!); setCallDialogOpen(true); }}
                                className="flex items-center gap-1 px-1.5 py-0.5 rounded text-xs bg-green-50 border border-green-200 text-green-700 hover:bg-green-100 transition-colors"
                                title="Click2Call via Bonvoice"
                              >
                                <PhoneCall className="h-3 w-3" /> Call
                              </button>
                            )}
                          </div>
                        </div>
                        <div>
                          <Label className="text-sm font-medium text-muted-foreground">Principal Name</Label>
                          <p className="text-sm font-medium mt-1">{school.principal_name || 'N/A'}</p>
                        </div>
                        <div>
                          <Label className="text-sm font-medium text-muted-foreground">Principal Mobile</Label>
                          <div className="flex items-center gap-2 mt-1">
                            <p className="text-sm font-medium">{school.principal_mobile || 'N/A'}</p>
                            {school.principal_mobile && (
                              <button onClick={() => { setCallTargetPhone(school.principal_mobile!); setCallDialogOpen(true); }} className="flex items-center gap-1 px-1.5 py-0.5 rounded text-xs bg-green-50 border border-green-200 text-green-700 hover:bg-green-100 transition-colors"><PhoneCall className="h-3 w-3" /> Call</button>
                            )}
                          </div>
                        </div>
                        <div>
                          <Label className="text-sm font-medium text-muted-foreground">iPlus Coordinator</Label>
                          <p className="text-sm font-medium mt-1">{school.iplus_coordinator || 'N/A'}</p>
                        </div>
                        <div>
                          <Label className="text-sm font-medium text-muted-foreground">Coordinator Mobile</Label>
                          <div className="flex items-center gap-2 mt-1">
                            <p className="text-sm font-medium">{school.coord_mobile || 'N/A'}</p>
                            {school.coord_mobile && (
                              <button onClick={() => { setCallTargetPhone(school.coord_mobile!); setCallDialogOpen(true); }} className="flex items-center gap-1 px-1.5 py-0.5 rounded text-xs bg-green-50 border border-green-200 text-green-700 hover:bg-green-100 transition-colors"><PhoneCall className="h-3 w-3" /> Call</button>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Additional Contacts */}
                    {((school as any).additional_contacts?.length > 0) && (
                      <div>
                        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-4">Additional Contacts</h4>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                          {(school as any).additional_contacts.map((c: any, i: number) => (
                            <div key={i} className="border rounded-md p-3">
                              <p className="text-xs text-muted-foreground">{c.role || 'Contact'}</p>
                              <p className="text-sm font-medium">{c.name}</p>
                              <div className="flex items-center gap-2 mt-0.5">
                                <p className="text-sm text-muted-foreground">{c.mobile}</p>
                                {c.mobile && (
                                  <button onClick={() => { setCallTargetPhone(c.mobile); setCallDialogOpen(true); }} className="flex items-center gap-1 px-1.5 py-0.5 rounded text-xs bg-green-50 border border-green-200 text-green-700 hover:bg-green-100 transition-colors"><PhoneCall className="h-3 w-3" /> Call</button>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Teachers */}
                    <div>
                      <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-4">Olympiad In-charge Teachers</h4>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {[
                          { label: 'English Plus (EPO)', name: school.teacher_epo, mob: school.teacher_epo_mob },
                          { label: 'Maths Plus (MPO)', name: school.teacher_mpo, mob: school.teacher_mpo_mob },
                          { label: 'Science Plus (SPO)', name: school.teacher_spo, mob: school.teacher_spo_mob },
                          { label: 'GK + SS Plus (GKSSPO)', name: school.teacher_gksspo, mob: school.teacher_gksspo_mob },
                          { label: 'Logical Reasoning Plus (LRPO)', name: school.teacher_lrpo, mob: school.teacher_lrpo_mob },
                          { label: 'Kids Plus (KidsPO)', name: school.teacher_kidspo, mob: school.teacher_kidspo_mob },
                        ].map(t => (
                          <div key={t.label} className="flex items-start gap-3 p-3 rounded-lg border border-border/60 bg-muted/20">
                            <div className="flex-1 min-w-0">
                              <Label className="text-xs font-medium text-muted-foreground">{t.label}</Label>
                              <p className="text-sm font-medium mt-0.5">{t.name || 'N/A'}</p>
                            </div>
                            <div className="flex-1 min-w-0">
                              <Label className="text-xs font-medium text-muted-foreground">Mobile</Label>
                              <div className="flex items-center gap-2 mt-0.5">
                                <p className="text-sm font-medium">{t.mob || 'N/A'}</p>
                                {t.mob && (
                                  <button onClick={() => { setCallTargetPhone(t.mob!); setCallDialogOpen(true); }} className="flex items-center gap-1 px-1.5 py-0.5 rounded text-xs bg-green-50 border border-green-200 text-green-700 hover:bg-green-100 transition-colors"><PhoneCall className="h-3 w-3" /> Call</button>
                                )}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Comments */}
                    <div>
                      <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-4">Comments</h4>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div>
                          <Label className="text-sm font-medium text-muted-foreground">Registration Interest Comment</Label>
                          <p className="text-sm font-medium mt-1">{school.registration_interest_comment || 'N/A'}</p>
                        </div>
                        <div>
                          <Label className="text-sm font-medium text-muted-foreground">Consent Form Comment</Label>
                          <p className="text-sm font-medium mt-1">{school.consent_form_comment || 'N/A'}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-6">
                    {/* Basic Information */}
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      <div>
                        <Label htmlFor="school_name">School Name</Label>
                        <Input
                          id="school_name"
                          value={editForm.school_name || ''}
                          onChange={(e) => setEditForm({...editForm, school_name: e.target.value})}
                        />
                      </div>
                      <div>
                        <Label htmlFor="ss_no">SS Number</Label>
                        <Input
                          id="ss_no"
                          type="number"
                          value={editForm.ss_no || ''}
                          onChange={(e) => setEditForm({...editForm, ss_no: parseInt(e.target.value) || 0})}
                        />
                      </div>
                      <div>
                        <Label htmlFor="state">State</Label>
                        <Select 
                          value={editForm.state || ''} 
                          onValueChange={(value) => setEditForm({...editForm, state: value})}
                        >
                          <SelectTrigger className="bg-background">
                            <SelectValue placeholder="Select state" />
                          </SelectTrigger>
                          <SelectContent className="bg-background border shadow-lg z-50">
                            {states.length === 0 ? (
                              <SelectItem value="loading" disabled>Loading states...</SelectItem>
                            ) : (
                              states.map((state) => (
                                <SelectItem key={state} value={state}>
                                  {state}
                                </SelectItem>
                              ))
                            )}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label htmlFor="district">District</Label>
                        <Select 
                          value={editForm.district || ''} 
                          onValueChange={(value) => setEditForm({...editForm, district: value})}
                          disabled={!editForm.state}
                        >
                          <SelectTrigger className="bg-background">
                            <SelectValue placeholder={editForm.state ? "Select district" : "Select state first"} />
                          </SelectTrigger>
                          <SelectContent className="bg-background border shadow-lg z-50">
                            {districts.length === 0 && editForm.state ? (
                              <SelectItem value="loading" disabled>Loading districts...</SelectItem>
                            ) : (
                              districts.map((district) => (
                                <SelectItem key={district} value={district}>
                                  {district}
                                </SelectItem>
                              ))
                            )}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label htmlFor="board">Board</Label>
                        <Select 
                          value={editForm.board || ''} 
                          onValueChange={(value) => setEditForm({...editForm, board: value})}
                        >
                          <SelectTrigger className="bg-background">
                            <SelectValue placeholder="Select board" />
                          </SelectTrigger>
                          <SelectContent className="bg-background border shadow-lg z-50">
                            {boards.length === 0 ? (
                              <SelectItem value="loading" disabled>Loading boards...</SelectItem>
                            ) : (
                              boards.map((board) => (
                                <SelectItem key={board} value={board}>
                                  {board}
                                </SelectItem>
                              ))
                            )}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label htmlFor="contact_person_name">Contact Person</Label>
                        <Input
                          id="contact_person_name"
                          value={editForm.contact_person_name || ''}
                          onChange={(e) => setEditForm({...editForm, contact_person_name: e.target.value})}
                        />
                      </div>
                      <div>
                        <Label htmlFor="pincode">Pincode</Label>
                        <Input
                          id="pincode"
                          value={editForm.pincode || ''}
                          onChange={(e) => setEditForm({...editForm, pincode: e.target.value})}
                        />
                      </div>
                    </div>

                    {/* Contact Information */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div>
                        <Label htmlFor="email">Email</Label>
                        <Input
                          id="email"
                          type="email"
                          value={editForm.email || ''}
                          onChange={(e) => setEditForm({...editForm, email: e.target.value})}
                        />
                      </div>
                      <div>
                        <Label htmlFor="mobile1">Mobile 1</Label>
                        <Input
                          id="mobile1"
                          type="tel"
                          value={editForm.mobile1 || ''}
                          onChange={(e) => onMobileChange('mobile1', e.target.value)}
                          placeholder="10 digits only"
                        />
                      </div>
                      <div>
                        <Label htmlFor="mobile2">WhatsApp No.</Label>
                        <Input
                          id="mobile2"
                          type="tel"
                          value={editForm.mobile2 || ''}
                          onChange={(e) => onMobileChange('mobile2', e.target.value)}
                          placeholder="10 digits only"
                        />
                      </div>
                    </div>

                    {/* Address */}
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Address</p>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <Label htmlFor="address1">Address 1</Label>
                          <Textarea
                            id="address1"
                            value={editForm.address1 || ''}
                            onChange={(e) => setEditForm({...editForm, address1: e.target.value})}
                            rows={2}
                          />
                        </div>
                        <div>
                          <Label htmlFor="address2">Address 2</Label>
                          <Textarea
                            id="address2"
                            value={editForm.address2 || ''}
                            onChange={(e) => setEditForm({...editForm, address2: e.target.value})}
                            rows={2}
                          />
                        </div>
                      </div>
                    </div>

                    {/* Contact Persons */}
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Contact Persons</p>
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        <div>
                          <Label htmlFor="corr_name">Correspondent Name</Label>
                          <Input
                            id="corr_name"
                            value={editForm.corr_name || ''}
                            onChange={(e) => setEditForm({...editForm, corr_name: e.target.value})}
                          />
                        </div>
                        <div>
                          <Label htmlFor="corr_mobile">Correspondent Mobile</Label>
                          <Input
                            id="corr_mobile"
                            type="tel"
                            value={editForm.corr_mobile || ''}
                            onChange={(e) => onMobileChange('corr_mobile', e.target.value)}
                            placeholder="10 digits only"
                          />
                        </div>
                        <div>
                          <Label htmlFor="principal_name">Principal Name</Label>
                          <Input
                            id="principal_name"
                            value={editForm.principal_name || ''}
                            onChange={(e) => setEditForm({...editForm, principal_name: e.target.value})}
                          />
                        </div>
                        <div>
                          <Label htmlFor="principal_mobile">Principal Mobile</Label>
                          <Input
                            id="principal_mobile"
                            type="tel"
                            value={editForm.principal_mobile || ''}
                            onChange={(e) => onMobileChange('principal_mobile', e.target.value)}
                            placeholder="10 digits only"
                          />
                        </div>
                        <div>
                          <Label htmlFor="iplus_coordinator">iPlus Coordinator Name</Label>
                          <Input
                            id="iplus_coordinator"
                            value={editForm.iplus_coordinator || ''}
                            onChange={(e) => setEditForm({...editForm, iplus_coordinator: e.target.value})}
                          />
                        </div>
                        <div>
                          <Label htmlFor="coord_mobile">Coordinator Mobile</Label>
                          <Input
                            id="coord_mobile"
                            type="tel"
                            value={editForm.coord_mobile || ''}
                            onChange={(e) => onMobileChange('coord_mobile', e.target.value)}
                            placeholder="10 digits only"
                          />
                        </div>
                      </div>
                    </div>

                    {/* Teachers */}
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Olympiad In-charge Teachers</p>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {[
                          { label: 'English Plus (EPO)', nameKey: 'teacher_epo' as const, mobKey: 'teacher_epo_mob' as const },
                          { label: 'Maths Plus (MPO)', nameKey: 'teacher_mpo' as const, mobKey: 'teacher_mpo_mob' as const },
                          { label: 'Science Plus (SPO)', nameKey: 'teacher_spo' as const, mobKey: 'teacher_spo_mob' as const },
                          { label: 'GK + SS Plus (GKSSPO)', nameKey: 'teacher_gksspo' as const, mobKey: 'teacher_gksspo_mob' as const },
                          { label: 'Logical Reasoning Plus (LRPO)', nameKey: 'teacher_lrpo' as const, mobKey: 'teacher_lrpo_mob' as const },
                          { label: 'Kids Plus (KidsPO)', nameKey: 'teacher_kidspo' as const, mobKey: 'teacher_kidspo_mob' as const },
                        ].map(t => (
                          <div key={t.label} className="p-3 rounded-lg border border-border/60 space-y-2">
                            <p className="text-xs font-medium text-muted-foreground">{t.label}</p>
                            <div className="grid grid-cols-2 gap-2">
                              <div>
                                <Label className="text-xs">Name</Label>
                                <Input
                                  value={editForm[t.nameKey] || ''}
                                  onChange={(e) => setEditForm({...editForm, [t.nameKey]: e.target.value})}
                                  className="h-8 text-sm"
                                />
                              </div>
                              <div>
                                <Label className="text-xs">Mobile</Label>
                                <Input
                                  value={editForm[t.mobKey] || ''}
                                  onChange={(e) => setEditForm({...editForm, [t.mobKey]: e.target.value})}
                                  className="h-8 text-sm"
                                />
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Comments */}
                    <div className="space-y-4">
                      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Comments</p>
                      <div>
                        <Label htmlFor="registration_interest_comment">Registration Interest Comment</Label>
                        <Textarea
                          id="registration_interest_comment"
                          value={editForm.registration_interest_comment || ''}
                          onChange={(e) => setEditForm({...editForm, registration_interest_comment: e.target.value})}
                          rows={2}
                        />
                      </div>
                      <div>
                        <Label htmlFor="consent_form_comment">Consent Form Comment</Label>
                        <Textarea
                          id="consent_form_comment"
                          value={editForm.consent_form_comment || ''}
                          onChange={(e) => setEditForm({...editForm, consent_form_comment: e.target.value})}
                          rows={2}
                        />
                      </div>
                    </div>
                  </div>
                )}

                {/* Payment Details (if payment received) */}
                {school.payment_status === 'Received' && (school.payment_mode || school.payment_date || school.payment_amount) && (
                  <div className="mt-6 p-4 bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 rounded-lg">
                    <h4 className="font-medium text-green-800 dark:text-green-200 mb-3">Payment Details</h4>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div>
                        <Label className="text-sm font-medium text-muted-foreground">Payment Mode</Label>
                        <p className="text-sm font-medium mt-1">{school.payment_mode || 'N/A'}</p>
                      </div>
                      <div>
                        <Label className="text-sm font-medium text-muted-foreground">Payment Date</Label>
                        <p className="text-sm font-medium mt-1">
                          {school.payment_date ? format(new Date(school.payment_date), 'MMM dd, yyyy') : 'N/A'}
                        </p>
                      </div>
                      <div>
                        <Label className="text-sm font-medium text-muted-foreground">Amount</Label>
                        <p className="text-sm font-medium mt-1">
                          {school.payment_amount ? `₹${school.payment_amount}` : 'N/A'}
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="workflow">
            <WorkflowEditor school={school} onUpdate={handleSchoolUpdate} />
          </TabsContent>

          <TabsContent value="payment">
            <EnhancedPaymentTracker 
              school={school} 
              onUpdate={() => {
                // Refresh school data after payment update
                const fetchSchool = async () => {
                  const { data } = await getSchoolById(school.id);
                  if (data) setSchool(data);
                };
                fetchSchool();
              }}
            />
          </TabsContent>

          <TabsContent value="consent">
            <ConsentFormManager 
              schoolId={school.id} 
              isRequestedYes={school.consent_form_requested === 'Yes'} 
            />
          </TabsContent>

          <TabsContent value="portal-reg">
            <PortalRegistrationView schoolId={school.id} paymentStatus={school.payment_status} portalRegistered={!!school.portal_registered} />
          </TabsContent>

          <TabsContent value="students">
            <div className="mb-6 p-5 rounded-xl bg-amber-50 border-2 border-amber-300">
              <p className="text-base font-bold text-amber-900 mb-1">⚠ You are viewing the 2025 Archive</p>
              <p className="text-sm text-amber-800">
                This data is read-only historical data from the 2025 project.{' '}
                {portalStudentCount > 0 && (
                  <>Active registrations for this school (<strong>{portalStudentCount} student{portalStudentCount !== 1 ? 's' : ''}</strong>) are in the <strong>Registrations</strong> tab.</>
                )}
                {portalStudentCount === 0 && <>All current registrations should be added via the <strong>Registrations</strong> tab.</>}
              </p>
            </div>
            <StudentRegistrationForm
              schoolId={school.id}
              schoolName={school.school_name}
              schoolSSNo={school.ss_no}
            />
          </TabsContent>

          <TabsContent value="summary">
            <RegistrationSummaryTable schoolId={school.id} schoolName={school.school_name} />
          </TabsContent>

          <TabsContent value="exams">
            <ExamScheduleManager school={school} />
          </TabsContent>

          <TabsContent value="communications">
            <div className="space-y-6">
              {/* Add Communication */}
              <Card>
                <CardHeader>
                  <CardTitle>Add Communication</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <Label>Communication Type</Label>
                      <Select 
                        value={newCommunication.type} 
                        onValueChange={(value: 'Phone' | 'Email' | 'WhatsApp') => 
                          setNewCommunication({...newCommunication, type: value})
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Phone">Phone</SelectItem>
                          <SelectItem value="Email">Email</SelectItem>
                          <SelectItem value="WhatsApp">WhatsApp</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    
                    <div>
                      <Label>Follow-up Date (Optional)</Label>
                      <Input
                        type="date"
                        value={followUpDate}
                        onChange={(e) => setFollowUpDate(e.target.value)}
                      />
                    </div>
                    
                    <div>
                      <Label>Follow-up Time (Optional)</Label>
                      <Input
                        type="time"
                        value={followUpTime}
                        onChange={(e) => setFollowUpTime(e.target.value)}
                      />
                    </div>
                  </div>

                  {/* Communication Details Fields */}
                  {(newCommunication.type === 'Phone' || newCommunication.type === 'WhatsApp') && (
                    <div className="grid grid-cols-3 gap-4">
                      <div>
                        <Label htmlFor="contacted_person_name">Contacted Person Name *</Label>
                        <Input
                          id="contacted_person_name"
                          placeholder="Name of person contacted"
                          value={newCommunication.contactedPersonName}
                          onChange={(e) => setNewCommunication({...newCommunication, contactedPersonName: e.target.value})}
                          required
                        />
                      </div>
                      <div>
                        <Label htmlFor="contacted_mobile_no">Contacted Mobile No *</Label>
                        <Input
                          id="contacted_mobile_no"
                          placeholder="Mobile number"
                          value={newCommunication.contactedMobileNo}
                          onChange={(e) => setNewCommunication({...newCommunication, contactedMobileNo: e.target.value})}
                          required
                        />
                      </div>
                      <div>
                        <Label htmlFor="designation">Designation *</Label>
                        <Input
                          id="designation"
                          placeholder="Role/Position"
                          value={newCommunication.designation}
                          onChange={(e) => setNewCommunication({...newCommunication, designation: e.target.value})}
                          required
                        />
                      </div>
                    </div>
                  )}
                  
                  <div>
                    <Label>Message</Label>
                    <Textarea
                      value={newCommunication.message}
                      onChange={(e) => setNewCommunication({...newCommunication, message: e.target.value})}
                      placeholder="Enter communication details..."
                      rows={3}
                    />
                  </div>
                  
                  <Button 
                    onClick={handleAddCommunication}
                    disabled={!newCommunication.message.trim()}
                    className="w-full"
                  >
                    <MessageSquare className="h-4 w-4 mr-2" />
                    Log Communication
                  </Button>
                </CardContent>
              </Card>

              {/* Communication History */}
              <Card>
                <CardHeader>
                  <CardTitle>Communication History</CardTitle>
                </CardHeader>
                <CardContent>
                  {communications.length === 0 ? (
                    <p className="text-center text-muted-foreground py-8">
                      No communications logged yet.
                    </p>
                  ) : (
                    <div className="space-y-4">
                      {communications.map(comm => (
                        <div key={comm.id} className="border rounded-lg p-4 space-y-2">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center space-x-2">
                              <Badge variant="outline" className={comm.communication_type === 'AI Call' ? 'border-purple-400 text-purple-700 bg-purple-50' : ''}>
                                {comm.communication_type === 'Phone' && <Phone className="h-3 w-3 mr-1" />}
                                {comm.communication_type === 'Email' && <Mail className="h-3 w-3 mr-1" />}
                                {comm.communication_type === 'WhatsApp' && <MessageSquare className="h-3 w-3 mr-1" />}
                                {comm.communication_type === 'AI Call' && <Bot className="h-3 w-3 mr-1" />}
                                {comm.communication_type}
                              </Badge>
                              <span className="text-sm text-muted-foreground">
                                {comm.communication_type === 'AI Call' ? 'AI Agent' : `by ${(comm as any).profiles?.username || 'User'}`}
                              </span>
                            </div>
                            <span className="text-sm text-muted-foreground">
                              {format(new Date(comm.created_at), 'MMM dd, yyyy HH:mm')}
                            </span>
                          </div>
                          <p className="text-sm">{comm.message}</p>
                          {(comm.communication_type === 'AI Call' || comm.communication_type === 'Phone') && (
                            <div className="mt-2 space-y-1">
                              {(comm as any).ai_summary && (
                                <p className="text-sm text-purple-700 bg-purple-50 rounded px-2 py-1">{(comm as any).ai_summary}</p>
                              )}
                              <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                                {(comm as any).direction && <span className="capitalize">📞 {(comm as any).direction}</span>}
                                {(comm as any).language_used && <span>🗣 {(comm as any).language_used}</span>}
                                {(comm as any).duration_seconds != null && (
                                  <span>⏱ {Math.floor((comm as any).duration_seconds / 60)}m {(comm as any).duration_seconds % 60}s</span>
                                )}
                                {(comm as any).outcome && <span className="capitalize font-medium">Outcome: {(comm as any).outcome.replace(/_/g, ' ')}</span>}
                                {(comm as any).recording_url && (
                                  <a href={(comm as any).recording_url} target="_blank" rel="noopener noreferrer" className="text-blue-500 underline">▶ Recording</a>
                                )}
                              </div>
                            </div>
                          )}
                          {comm.contacted_person_name && (
                            <div className="flex gap-4 text-xs text-muted-foreground mt-2">
                              <span>Contact: {comm.contacted_person_name}</span>
                              {comm.contacted_mobile_no && <span>Mobile: {comm.contacted_mobile_no}</span>}
                              {comm.designation && <span>Designation: {comm.designation}</span>}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="results">
            <SchoolResultsSummary ssNo={school.ss_no} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
};

export default SchoolDetail;