import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { School, type Communication as CommunicationType } from '@/types/database';
import { useCommunications, useAllCommunications } from '@/hooks/useCommunications';
import { useActiveProject } from '@/hooks/useOlympiadProjects';
import { useFollowUps } from '@/hooks/useFollowUps';
import { useWorkflow } from '@/hooks/useWorkflow';
import Navbar from '@/components/layout/Navbar';
import CommunicationDialog from '@/components/communication/CommunicationDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Search, MessageSquare, Phone, Mail, Plus, Calendar, Bot } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';

const Communication = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState<School[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedSchool, setSelectedSchool] = useState<School | null>(null);
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [communicationSearchTerm, setCommunicationSearchTerm] = useState('');
  const [dateFilter, setDateFilter] = useState('');
  const [userFilter, setUserFilter] = useState('all');
  const [users, setUsers] = useState<any[]>([]);
  const { data: activeProject } = useActiveProject();
  const [communicationForm, setCommunicationForm] = useState({
    type: '' as 'Phone' | 'Email' | 'WhatsApp' | 'AI Call' | '',
    message: '',
    contactedPersonName: '',
    contactedMobileNo: '',
    designation: '',
    followUpDate: '',
    followUpTime: ''
  });

  const { addCommunication } = useCommunications();
  const { createFollowUp } = useFollowUps();
  const { updateWorkflowStatus } = useWorkflow();
  const { communications: filteredCommunications, loading: communicationsLoading, fetchAllCommunications } = useAllCommunications();

  const searchSchools = async () => {
    if (!searchTerm.trim()) {
      setSearchResults([]);
      return;
    }

    setLoading(true);
    try {
      // Try to parse as number for SS search, otherwise search by name
      const isNumeric = !isNaN(Number(searchTerm));
      let query = supabase.from('schools').select('*');
      
      if (isNumeric) {
        query = query.or(`ss_no.eq.${searchTerm},school_name.ilike.%${searchTerm}%`);
      } else {
        query = query.ilike('school_name', `%${searchTerm}%`);
      }
      
      const { data, error } = await query.limit(10);

      if (error) throw error;
      setSearchResults((data || []) as School[]);
    } catch (error: any) {
      toast({
        title: 'Error',
        description: 'Failed to search schools',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const fetchUsers = async () => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('user_id, full_name, username')
        .order('full_name');
      
      if (error) throw error;
      setUsers(data || []);
    } catch (error: any) {
      console.error('Error fetching users:', error);
    }
  };

  const handleCommunicationSearch = async () => {
    if (!activeProject?.id) {
      const event = new CustomEvent('communications-updated', { detail: [] });
      window.dispatchEvent(event);
      return;
    }

    let query = supabase
      .from('communications')
      .select(`
        *,
        schools!communications_school_id_fkey (
          school_name,
          ss_no,
          district
        ),
        profiles (
          full_name,
          username
        )
      `)
      .eq('project_id', activeProject.id)
      .order('created_at', { ascending: false });

    // Apply filters
    if (communicationSearchTerm.trim()) {
      query = query.or(`message.ilike.%${communicationSearchTerm}%,contacted_person_name.ilike.%${communicationSearchTerm}%,contacted_mobile_no.ilike.%${communicationSearchTerm}%`);
    }

    if (dateFilter) {
      const startDate = new Date(dateFilter);
      const endDate = new Date(startDate);
      endDate.setDate(endDate.getDate() + 1);
      query = query.gte('created_at', startDate.toISOString()).lt('created_at', endDate.toISOString());
    }

    if (userFilter && userFilter !== 'all') {
      query = query.eq('user_id', userFilter);
    }

    try {
      const { data, error } = await query;
      if (error) throw error;
      
      // Update the communications state directly since we're not using the hook's search anymore
      const event = new CustomEvent('communications-updated', { detail: data || [] });
      window.dispatchEvent(event);
    } catch (error: any) {
      toast({
        title: 'Error',
        description: 'Failed to fetch communications',
        variant: 'destructive',
      });
    }
  };

  const handleAddCommunication = async (data: any) => {
    if (!selectedSchool) return;

    try {
      // 1. Log communication first
      const { error: commError } = await addCommunication(
        selectedSchool.id,
        data.communication_type,
        data.message,
        data.contacted_person_name,
        data.contacted_mobile_no,
        data.designation
      );

      if (commError) throw commError;

      // 2. Auto-set contacted to "Yes" since communication happened
      if (selectedSchool.contacted !== 'Yes') {
        await updateWorkflowStatus(
          selectedSchool.id,
          'contacted',
          'Yes',
          selectedSchool.contacted
        );
      }

      // 3. Handle workflow updates if provided
      if (data.workflowUpdates) {
        const { stage, status, comment, paymentDetails } = data.workflowUpdates;
        const currentStageValue = selectedSchool[stage as keyof School] as string;
        
        const additionalUpdates: any = {};
        
        // Add comment if provided
        if (comment) {
          if (stage === 'registration_interest') {
            additionalUpdates.registration_interest_comment = comment;
          } else if (stage === 'consent_form_sent') {
            additionalUpdates.consent_form_comment = comment;
          }
        }

        // Add payment details if provided
        if (paymentDetails && stage === 'payment_status' && status === 'Received') {
          additionalUpdates.payment_mode = paymentDetails.mode;
          additionalUpdates.payment_date = paymentDetails.date;
          additionalUpdates.payment_amount = parseFloat(paymentDetails.amount) || null;
          additionalUpdates.total_participants = parseInt(paymentDetails.participants) || null;
        }

        await updateWorkflowStatus(
          selectedSchool.id,
          stage,
          status,
          currentStageValue,
          additionalUpdates
        );
      }

      // 4. Create follow-up if scheduled
      if (data.follow_up_date && data.follow_up_time) {
        await createFollowUp(
          selectedSchool.id,
          data.follow_up_date,
          data.follow_up_time
        );
      }

      setIsAddDialogOpen(false);
      setSelectedSchool(null);
      await handleCommunicationSearch();
      
      toast({
        title: 'Success',
        description: 'Communication logged and status updated successfully'
      });
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to log communication',
        variant: 'destructive'
      });
    }
  };

  useEffect(() => {
    const delayedSearch = setTimeout(() => {
      searchSchools();
    }, 300);

    return () => clearTimeout(delayedSearch);
  }, [searchTerm]);

  useEffect(() => {
    fetchUsers();
    handleCommunicationSearch(); // Load all communications initially
  }, []);

  useEffect(() => {
    const delayedSearch = setTimeout(() => {
      handleCommunicationSearch();
    }, 300);

    return () => clearTimeout(delayedSearch);
  }, [communicationSearchTerm, dateFilter, userFilter, activeProject?.id]);

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl font-bold text-foreground">Communication</h1>
            <p className="text-muted-foreground mt-2">
              Search for schools to view details and log communications
            </p>
          </div>
          
          <Button onClick={() => setIsAddDialogOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Add New Communication
          </Button>
        </div>

        {/* Communication Dialog */}
        <CommunicationDialog
          isOpen={isAddDialogOpen}
          onOpenChange={setIsAddDialogOpen}
          selectedSchool={selectedSchool}
          onSubmit={handleAddCommunication}
          searchTerm={searchTerm}
          setSearchTerm={setSearchTerm}
          searchResults={searchResults}
          onSchoolSelect={(school) => {
            setSelectedSchool(school);
            setSearchTerm(school.school_name);
            setSearchResults([]);
          }}
        />

        <div className="space-y-6">
          {/* Communications Search Bar */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Search className="h-5 w-5" />
                Search Communications History
              </CardTitle>
              <div className="space-y-4 mt-4">
                <div className="flex gap-4">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Search communications by school name, contact name, mobile, or message..."
                      value={communicationSearchTerm}
                      onChange={(e) => setCommunicationSearchTerm(e.target.value)}
                      className="pl-10"
                    />
                  </div>
                  {(communicationSearchTerm || dateFilter || (userFilter && userFilter !== 'all')) && (
                    <Button 
                      variant="outline" 
                      onClick={() => {
                        setCommunicationSearchTerm('');
                        setDateFilter('');
                        setUserFilter('all');
                      }}
                    >
                      Clear All
                    </Button>
                  )}
                </div>
                
                <div className="flex gap-4">
                  <div className="flex-1">
                    <Label htmlFor="date-filter">Filter by Date</Label>
                    <Input
                      id="date-filter"
                      type="date"
                      value={dateFilter}
                      onChange={(e) => setDateFilter(e.target.value)}
                      className="mt-1"
                    />
                  </div>
                  
                  <div className="flex-1">
                    <Label htmlFor="user-filter">Filter by User</Label>
                    <Select value={userFilter} onValueChange={setUserFilter}>
                      <SelectTrigger className="mt-1">
                        <SelectValue placeholder="Select user" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Users</SelectItem>
                        {users.map((user) => (
                          <SelectItem key={user.user_id} value={user.user_id}>
                            {user.full_name || user.username}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
            </CardHeader>
          </Card>

          {/* Communications Results */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MessageSquare className="h-5 w-5" />
                All Communications
              </CardTitle>
            </CardHeader>
            <CardContent>
              {communicationsLoading ? (
                <div className="flex justify-center py-8">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                </div>
              ) : filteredCommunications.length > 0 ? (
                <div className="space-y-4">
                  {filteredCommunications.map((comm) => (
                    <div key={comm.id} className="flex items-start justify-between p-4 border rounded-lg">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <Badge variant="outline" className={comm.communication_type === 'AI Call' ? 'border-purple-400 text-purple-700 bg-purple-50' : ''}>
                            {comm.communication_type === 'Phone' && <Phone className="h-3 w-3 mr-1" />}
                            {comm.communication_type === 'Email' && <Mail className="h-3 w-3 mr-1" />}
                            {comm.communication_type === 'WhatsApp' && <MessageSquare className="h-3 w-3 mr-1" />}
                            {comm.communication_type === 'AI Call' && <Bot className="h-3 w-3 mr-1" />}
                            {comm.communication_type}
                          </Badge>
                          <span className="font-medium">{comm.schools?.school_name}</span>
                          <span className="text-sm text-muted-foreground">SS No: {comm.schools?.ss_no}</span>
                        </div>
                        <p className="text-sm text-muted-foreground mb-2">{comm.message}</p>
                        <div className="flex items-center gap-4 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Calendar className="h-3 w-3" />
                            {format(new Date(comm.created_at), 'MMM dd, yyyy HH:mm')}
                          </span>
                          <span>By: {comm.profiles?.full_name || comm.profiles?.username}</span>
                          {comm.contacted_person_name && (
                            <span>Contact: {comm.contacted_person_name}</span>
                          )}
                          {comm.contacted_mobile_no && (
                            <span>Mobile: {comm.contacted_mobile_no}</span>
                          )}
                          {comm.designation && (
                            <span>Designation: {comm.designation}</span>
                          )}
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => navigate(`/schools/${comm.school_id}`)}
                      >
                        View School
                      </Button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  No communications found with the applied filters
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Search Schools</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by SS Number or School Name..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
            </CardContent>
          </Card>

          {loading && (
            <div className="flex justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
          )}

          {searchResults.length > 0 && (
            <div className="space-y-4">
              <h2 className="text-xl font-semibold">Search Results</h2>
              <div className="grid gap-4">
                {searchResults.map((school) => (
                  <Card key={school.id} className="hover:shadow-lg transition-shadow">
                    <CardContent className="pt-6">
                      <div className="flex justify-between items-start">
                        <div className="space-y-2">
                          <h3 className="text-lg font-semibold">{school.school_name}</h3>
                          <p className="text-sm text-muted-foreground">
                            SS No: {school.ss_no} | District: {school.district}
                          </p>
                          <p className="text-sm">{school.school_address}</p>
                          
                          <div className="flex space-x-4 text-sm">
                            {school.mobile1 && (
                              <div className="flex items-center space-x-1">
                                <Phone className="h-3 w-3" />
                                <span>{school.mobile1}</span>
                              </div>
                            )}
                            {school.email && (
                              <div className="flex items-center space-x-1">
                                <Mail className="h-3 w-3" />
                                <span>{school.email}</span>
                              </div>
                            )}
                          </div>

                          <div className="flex space-x-2 text-xs">
                            <span className={`px-2 py-1 rounded ${
                              school.contacted === 'Yes' 
                                ? 'bg-green-100 text-green-800' 
                                : 'bg-gray-100 text-gray-800'
                            }`}>
                              Contacted: {school.contacted}
                            </span>
                            <span className={`px-2 py-1 rounded ${
                              school.registration_status === 'Confirmed'
                                ? 'bg-green-100 text-green-800'
                                : 'bg-yellow-100 text-yellow-800'
                            }`}>
                              Registration: {school.registration_status}
                            </span>
                          </div>
                        </div>

                        <div className="flex space-x-2">
                          <Button
                            onClick={() => navigate(`/schools/${school.id}`)}
                            size="sm"
                          >
                            <MessageSquare className="h-4 w-4 mr-1" />
                            View & Communicate
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}

          {searchTerm && !loading && searchResults.length === 0 && (
            <Card>
              <CardContent className="text-center py-8">
                <p className="text-muted-foreground">
                  No schools found matching "{searchTerm}"
                </p>
              </CardContent>
            </Card>
          )}

          {!searchTerm && (
            <Card>
              <CardContent className="text-center py-8">
                <MessageSquare className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <p className="text-muted-foreground">
                  Enter a school name or SS number to search and communicate
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
};

export default Communication;