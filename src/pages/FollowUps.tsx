import { useState, useMemo } from 'react';
import { useFollowUps } from '@/hooks/useFollowUps';
import { useLastCommunication } from '@/hooks/useLastCommunication';
import { useSchoolsPaginated } from '@/hooks/useSchoolsPaginated';
import { useAuth } from '@/hooks/useAuth';
import Navbar from '@/components/layout/Navbar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Calendar, Clock, Phone, Search, CheckCircle, Download, Trash2, MessageSquare } from 'lucide-react';
import { format, isToday, isBefore, startOfDay } from 'date-fns';
import { useNavigate } from 'react-router-dom';
import WorkflowStatusBadge from '@/components/workflow/WorkflowStatusBadge';
import CompleteFollowUpDialog from '@/components/followup/CompleteFollowUpDialog';
import { PhoneNumberDialog } from '@/components/followup/PhoneNumberDialog';
import { useToast } from '@/hooks/use-toast';

const FollowUps = () => {
  const { followUps, loading, updateFollowUpStatus, deleteFollowUp, refreshFollowUps } = useFollowUps();
  const { profile } = useAuth();
  const { toast } = useToast();
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedFollowUp, setSelectedFollowUp] = useState<any>(null);
  const [isCompleteDialogOpen, setIsCompleteDialogOpen] = useState(false);
  const [selectedSchoolForPhone, setSelectedSchoolForPhone] = useState<any>(null);
  const [isPhoneDialogOpen, setIsPhoneDialogOpen] = useState(false);
  const navigate = useNavigate();

  // Get school IDs for last communication hook
  const schoolIds = useMemo(() => {
    return followUps
      .map(followUp => (followUp as any).schools?.id)
      .filter(id => id);
  }, [followUps]);

  const { lastCommunications } = useLastCommunication(schoolIds);

  // Add a manual refresh button functionality
  const handleRefresh = () => {
    refreshFollowUps();
  };

  const handleCompleteFollowUp = (followUp: any) => {
    setSelectedFollowUp(followUp);
    setIsCompleteDialogOpen(true);
  };

  const handleShowPhoneNumbers = (school: any) => {
    setSelectedSchoolForPhone(school);
    setIsPhoneDialogOpen(true);
  };

  const handleDeleteFollowUp = async (followUpId: string) => {
    if (window.confirm('Are you sure you want to delete this follow-up?')) {
      await deleteFollowUp(followUpId);
    }
  };

  const exportFollowUps = (type: 'all' | 'today' | 'overdue' | 'today_overdue') => {
    try {
      let dataToExport: any[] = [];
      let filename = '';
      
      switch (type) {
        case 'all':
          dataToExport = allFollowUps;
          filename = 'all_follow_ups';
          break;
        case 'today':
          dataToExport = todayFollowUps;
          filename = 'today_follow_ups';
          break;
        case 'overdue':
          dataToExport = overdueFollowUps;
          filename = 'overdue_follow_ups';
          break;
        case 'today_overdue':
          dataToExport = todayAndOverdueFollowUps;
          filename = 'today_overdue_follow_ups';
          break;
      }
      
      if (dataToExport.length === 0) {
        toast({
          title: 'Info',
          description: 'No follow-ups found to export for the selected category',
        });
        return;
      }

      const headers = [
        'SS No', 'School Name', 'District', 'Contact Person', 'Mobile1', 'Mobile2', 'Email',
        'Follow-up Date', 'Follow-up Time', 'Status', 'Priority', 'Address',
        'Courier Status', 'Contacted', 'Registration Status', 'Payment Status'
      ];

      const csvContent = [
        headers,
        ...dataToExport.map(followUp => {
          const school = (followUp as any).schools;
          const isOverdue = isBefore(new Date(followUp.follow_up_date), startOfDay(new Date()));
          const priority = isOverdue ? 'OVERDUE' : isToday(new Date(followUp.follow_up_date)) ? 'TODAY' : 'UPCOMING';
          
          return [
            school.ss_no || '',
            school.school_name || '',
            school.district || '',
            school.contact_person_name || '',
            school.mobile1 || '',
            school.mobile2 || '',
            school.email || '',
            format(new Date(followUp.follow_up_date), 'dd/MM/yyyy'),
            followUp.follow_up_time || '',
            followUp.status || '',
            priority,
            school.school_address || '',
            school.courier_status || '',
            school.contacted || '',
            school.registration_status || '',
            school.payment_status || ''
          ];
        })
      ].map(row => row.map(cell => `"${cell}"`).join(',')).join('\n');

      const blob = new Blob([csvContent], { type: 'text/csv' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${filename}_export_${new Date().toISOString().split('T')[0]}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);

      toast({
        title: 'Success',
        description: `Exported ${dataToExport.length} follow-ups successfully`
      });
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to export follow-ups',
        variant: 'destructive',
      });
    }
  };

  const allFollowUps = followUps.filter(followUp => {
    const hasSchoolData = !!(followUp as any).schools;
    if (!hasSchoolData) return false;
    if (!searchTerm.trim()) return true;
    
    const school = (followUp as any).schools;
    const lowerSearchTerm = searchTerm.toLowerCase();
    return school.ss_no.toString().includes(searchTerm) ||
           school.school_name.toLowerCase().includes(lowerSearchTerm) ||
           (school.contact_person_name && school.contact_person_name.toLowerCase().includes(lowerSearchTerm)) ||
           (school.mobile1 && school.mobile1.includes(searchTerm)) ||
           (school.mobile2 && school.mobile2.includes(searchTerm)) ||
           (school.email && school.email.toLowerCase().includes(lowerSearchTerm));
  });

  const todayAndOverdueFollowUps = followUps.filter(followUp => {
    const followUpDate = new Date(followUp.follow_up_date + 'T00:00:00');
    const today = startOfDay(new Date());
    const isToday = followUpDate.getTime() === today.getTime();
    const isOverdue = followUpDate < today;
    
    return (isToday || isOverdue) && followUp.status === 'pending';
  }).filter(followUp => {
    const hasSchoolData = !!(followUp as any).schools;
    if (!hasSchoolData) return false;
    if (!searchTerm.trim()) return true;
    
    const school = (followUp as any).schools;
    const lowerSearchTerm = searchTerm.toLowerCase();
    return school.ss_no.toString().includes(searchTerm) ||
           school.school_name.toLowerCase().includes(lowerSearchTerm) ||
           (school.contact_person_name && school.contact_person_name.toLowerCase().includes(lowerSearchTerm)) ||
           (school.mobile1 && school.mobile1.includes(searchTerm)) ||
           (school.mobile2 && school.mobile2.includes(searchTerm)) ||
           (school.email && school.email.toLowerCase().includes(lowerSearchTerm));
  });

  const todayFollowUps = followUps.filter(followUp => {
    const followUpDate = new Date(followUp.follow_up_date + 'T00:00:00');
    const today = startOfDay(new Date());
    const isToday = followUpDate.getTime() === today.getTime();
    
    return isToday && followUp.status === 'pending';
  }).filter(followUp => {
    const hasSchoolData = !!(followUp as any).schools;
    if (!hasSchoolData) return false;
    if (!searchTerm.trim()) return true;
    
    const school = (followUp as any).schools;
    const lowerSearchTerm = searchTerm.toLowerCase();
    return school.ss_no.toString().includes(searchTerm) ||
           school.school_name.toLowerCase().includes(lowerSearchTerm) ||
           (school.contact_person_name && school.contact_person_name.toLowerCase().includes(lowerSearchTerm)) ||
           (school.mobile1 && school.mobile1.includes(searchTerm)) ||
           (school.mobile2 && school.mobile2.includes(searchTerm)) ||
           (school.email && school.email.toLowerCase().includes(lowerSearchTerm));
  });

  const overdueFollowUps = followUps.filter(followUp => {
    const followUpDate = new Date(followUp.follow_up_date + 'T00:00:00');
    const today = startOfDay(new Date());
    const isOverdue = followUpDate < today;
    
    return isOverdue && followUp.status === 'pending';
  }).filter(followUp => {
    const hasSchoolData = !!(followUp as any).schools;
    if (!hasSchoolData) return false;
    if (!searchTerm.trim()) return true;
    
    const school = (followUp as any).schools;
    const lowerSearchTerm = searchTerm.toLowerCase();
    return school.ss_no.toString().includes(searchTerm) ||
           school.school_name.toLowerCase().includes(lowerSearchTerm) ||
           (school.contact_person_name && school.contact_person_name.toLowerCase().includes(lowerSearchTerm)) ||
           (school.mobile1 && school.mobile1.includes(searchTerm)) ||
           (school.mobile2 && school.mobile2.includes(searchTerm)) ||
           (school.email && school.email.toLowerCase().includes(lowerSearchTerm));
  });

  const upcomingFollowUps = followUps.filter(followUp => {
    const followUpDate = new Date(followUp.follow_up_date + 'T00:00:00');
    const today = startOfDay(new Date());
    const isFuture = followUpDate > today;
    
    return isFuture && followUp.status === 'pending';
  }).filter(followUp => {
    const hasSchoolData = !!(followUp as any).schools;
    if (!hasSchoolData) return false;
    if (!searchTerm.trim()) return true;
    
    const school = (followUp as any).schools;
    const lowerSearchTerm = searchTerm.toLowerCase();
    return school.ss_no.toString().includes(searchTerm) ||
           school.school_name.toLowerCase().includes(lowerSearchTerm) ||
           (school.contact_person_name && school.contact_person_name.toLowerCase().includes(lowerSearchTerm)) ||
           (school.mobile1 && school.mobile1.includes(searchTerm)) ||
           (school.mobile2 && school.mobile2.includes(searchTerm)) ||
           (school.email && school.email.toLowerCase().includes(lowerSearchTerm));
  });

  if (loading) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <div className="flex items-center justify-center h-96">
          <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-primary"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-3xl font-bold text-foreground">Follow-up Reminders</h1>
              <p className="text-muted-foreground mt-2">
                Schools scheduled for follow-up today and overdue items
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {profile?.role === 'superadmin' && (
                <>
                  <Button onClick={() => exportFollowUps('all')} variant="outline" size="sm">
                    <Download className="h-4 w-4 mr-2" />
                    Export All
                  </Button>
                  <Button onClick={() => exportFollowUps('today')} variant="outline" size="sm">
                    <Download className="h-4 w-4 mr-2" />
                    Export Today
                  </Button>
                  <Button onClick={() => exportFollowUps('overdue')} variant="outline" size="sm">
                    <Download className="h-4 w-4 mr-2" />
                    Export Overdue
                  </Button>
                  <Button onClick={() => exportFollowUps('today_overdue')} variant="outline" size="sm">
                    <Download className="h-4 w-4 mr-2" />
                    Export Today + Overdue
                  </Button>
                </>
              )}
              <Button onClick={handleRefresh} variant="outline">
                Refresh
              </Button>
            </div>
          </div>
        </div>

        {/* Statistics Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <Card>
            <CardContent className="pt-6">
              <div className="text-2xl font-bold text-blue-600">{allFollowUps.length}</div>
              <p className="text-xs text-muted-foreground">Total Follow-ups</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="text-2xl font-bold text-red-600">{overdueFollowUps.length}</div>
              <p className="text-xs text-muted-foreground">Overdue</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="text-2xl font-bold text-orange-600">{todayFollowUps.length}</div>
              <p className="text-xs text-muted-foreground">Today</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="text-2xl font-bold text-green-600">{upcomingFollowUps.length}</div>
              <p className="text-xs text-muted-foreground">Upcoming</p>
            </CardContent>
          </Card>
        </div>

        {/* Search */}
        <div className="mb-6">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by SS No, School Name, Contact Person, Mobile, or Email..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>
        </div>

        {allFollowUps.length === 0 ? (
          <Card>
            <CardContent className="text-center py-12">
              <Calendar className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-lg font-medium mb-2">No Follow-ups</h3>
              <p className="text-muted-foreground">
                No schools scheduled for follow-up.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-6">
            {/* Overdue Follow-ups */}
            {overdueFollowUps.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center space-x-2">
                    <Calendar className="h-5 w-5 text-red-500" />
                    <span>Overdue Follow-ups ({overdueFollowUps.length})</span>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                     {overdueFollowUps.map(followUp => {
                       const school = (followUp as any).schools;
                       const lastComm = lastCommunications[school?.id];
                       if (!school) return null;
                       
                       return (
                         <div key={followUp.id} className="p-4 border rounded-lg bg-red-50 border-red-200 space-y-3">
                           <div className="flex items-center justify-between">
                             <div className="flex-1">
                               <div className="flex items-center space-x-3">
                                 <Badge variant="outline">SS {school.ss_no}</Badge>
                                 <h4 className="font-medium">{school.school_name}</h4>
                                 <Badge variant="destructive">Overdue</Badge>
                               </div>
                               <p className="text-sm text-muted-foreground mt-1">{school.district}</p>
                               <div className="flex items-center space-x-4 mt-2">
                                 <div className="flex items-center space-x-1">
                                   <Calendar className="h-4 w-4" />
                                   <span className="text-sm">{format(new Date(followUp.follow_up_date), 'MMM dd, yyyy')}</span>
                                 </div>
                                 <div className="flex items-center space-x-1">
                                   <Clock className="h-4 w-4" />
                                   <span className="text-sm">{followUp.follow_up_time}</span>
                                 </div>
                                 <WorkflowStatusBadge school={school} />
                               </div>
                             </div>
                             <div className="flex space-x-2">
                               <Button
                                 variant="outline"
                                 size="sm"
                                 onClick={() => handleCompleteFollowUp(followUp)}
                               >
                                 <CheckCircle className="h-4 w-4 mr-1" />
                                 Complete
                               </Button>
                               <Button
                                 variant="outline"
                                 size="sm"
                                 onClick={() => handleShowPhoneNumbers(school)}
                               >
                                 <Phone className="h-4 w-4" />
                               </Button>
                               {profile?.role === 'superadmin' && (
                                 <Button
                                   variant="outline"
                                   size="sm"
                                   onClick={() => handleDeleteFollowUp(followUp.id)}
                                   className="text-destructive hover:text-destructive"
                                 >
                                   <Trash2 className="h-4 w-4" />
                                 </Button>
                               )}
                               <Button
                                 variant="default"
                                 size="sm"
                                 onClick={() => navigate(`/schools/${school.id}`)}
                               >
                                 View School
                               </Button>
                             </div>
                           </div>
                           
                           {/* Last Communication */}
                           {lastComm && (
                             <div className="bg-white/70 p-3 rounded border border-red-300">
                               <div className="flex items-center space-x-2 mb-2">
                                 <MessageSquare className="h-4 w-4 text-red-600" />
                                 <span className="text-sm font-medium">Last Communication</span>
                                 <Badge variant="outline" className="text-xs">
                                   {lastComm.communication_type}
                                 </Badge>
                                 <span className="text-xs text-muted-foreground">
                                   {format(new Date(lastComm.created_at), 'MMM dd, HH:mm')}
                                 </span>
                               </div>
                               <p className="text-sm text-gray-700 mb-1">
                                 {lastComm.message.length > 100 ? `${lastComm.message.substring(0, 100)}...` : lastComm.message}
                               </p>
                               {lastComm.contacted_person_name && (
                                 <p className="text-xs text-gray-600">
                                   Contact: {lastComm.contacted_person_name}
                                   {lastComm.contacted_mobile_no && ` (${lastComm.contacted_mobile_no})`}
                                 </p>
                               )}
                               {lastComm.profiles && (
                                 <p className="text-xs text-gray-600">
                                   By: {lastComm.profiles.full_name || lastComm.profiles.username}
                                 </p>
                               )}
                             </div>
                           )}
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Today Follow-ups */}
            {todayFollowUps.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center space-x-2">
                    <Calendar className="h-5 w-5 text-orange-500" />
                    <span>Today's Follow-ups ({todayFollowUps.length})</span>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                     {todayFollowUps.map(followUp => {
                       const school = (followUp as any).schools;
                       const lastComm = lastCommunications[school?.id];
                       if (!school) return null;
                       
                       return (
                         <div key={followUp.id} className="p-4 border rounded-lg bg-orange-50 border-orange-200 space-y-3">
                           <div className="flex items-center justify-between">
                             <div className="flex-1">
                               <div className="flex items-center space-x-3">
                                 <Badge variant="outline">SS {school.ss_no}</Badge>
                                 <h4 className="font-medium">{school.school_name}</h4>
                                 <Badge className="bg-orange-500">Today</Badge>
                               </div>
                               <p className="text-sm text-muted-foreground mt-1">{school.district}</p>
                               <div className="flex items-center space-x-4 mt-2">
                                 <div className="flex items-center space-x-1">
                                   <Calendar className="h-4 w-4" />
                                   <span className="text-sm">{format(new Date(followUp.follow_up_date), 'MMM dd, yyyy')}</span>
                                 </div>
                                 <div className="flex items-center space-x-1">
                                   <Clock className="h-4 w-4" />
                                   <span className="text-sm">{followUp.follow_up_time}</span>
                                 </div>
                                 <WorkflowStatusBadge school={school} />
                               </div>
                              </div>
                              <div className="flex space-x-2">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => handleCompleteFollowUp(followUp)}
                                >
                                  <CheckCircle className="h-4 w-4 mr-1" />
                                  Complete
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => handleShowPhoneNumbers(school)}
                                >
                                  <Phone className="h-4 w-4" />
                                </Button>
                                {profile?.role === 'superadmin' && (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => handleDeleteFollowUp(followUp.id)}
                                    className="text-destructive hover:text-destructive"
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                )}
                                <Button
                                  variant="default"
                                  size="sm"
                                  onClick={() => navigate(`/schools/${school.id}`)}
                                >
                                  View School
                                </Button>
                              </div>
                            </div>
                            
                            {/* Last Communication */}
                            {lastComm && (
                              <div className="bg-white/70 p-3 rounded border border-orange-300">
                                <div className="flex items-center space-x-2 mb-2">
                                  <MessageSquare className="h-4 w-4 text-orange-600" />
                                  <span className="text-sm font-medium">Last Communication</span>
                                  <Badge variant="outline" className="text-xs">
                                    {lastComm.communication_type}
                                  </Badge>
                                  <span className="text-xs text-muted-foreground">
                                    {format(new Date(lastComm.created_at), 'MMM dd, HH:mm')}
                                  </span>
                                </div>
                                <p className="text-sm text-gray-700 mb-1">
                                  {lastComm.message.length > 100 ? `${lastComm.message.substring(0, 100)}...` : lastComm.message}
                                </p>
                                {lastComm.contacted_person_name && (
                                  <p className="text-xs text-gray-600">
                                    Contact: {lastComm.contacted_person_name}
                                    {lastComm.contacted_mobile_no && ` (${lastComm.contacted_mobile_no})`}
                                  </p>
                                )}
                                {lastComm.profiles && (
                                  <p className="text-xs text-gray-600">
                                    By: {lastComm.profiles.full_name || lastComm.profiles.username}
                                  </p>
                                )}
                              </div>
                            )}
                          </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Upcoming Follow-ups */}
            {upcomingFollowUps.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center space-x-2">
                    <Calendar className="h-5 w-5 text-green-500" />
                    <span>Upcoming Follow-ups ({upcomingFollowUps.length})</span>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {upcomingFollowUps.map(followUp => {
                      const school = (followUp as any).schools;
                      if (!school) return null;
                      
                      return (
                        <div key={followUp.id} className="flex items-center justify-between p-4 border rounded-lg bg-green-50 border-green-200">
                          <div className="flex-1">
                            <div className="flex items-center space-x-3">
                              <Badge variant="outline">SS {school.ss_no}</Badge>
                              <h4 className="font-medium">{school.school_name}</h4>
                              <Badge variant="secondary">Upcoming</Badge>
                            </div>
                            <p className="text-sm text-muted-foreground mt-1">{school.district}</p>
                            <div className="flex items-center space-x-4 mt-2">
                              <div className="flex items-center space-x-1">
                                <Calendar className="h-4 w-4" />
                                <span className="text-sm">{format(new Date(followUp.follow_up_date), 'MMM dd, yyyy')}</span>
                              </div>
                              <div className="flex items-center space-x-1">
                                <Clock className="h-4 w-4" />
                                <span className="text-sm">{followUp.follow_up_time}</span>
                              </div>
                              <WorkflowStatusBadge school={school} />
                            </div>
                          </div>
                          <div className="flex space-x-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleShowPhoneNumbers(school)}
                            >
                              <Phone className="h-4 w-4" />
                            </Button>
                            {profile?.role === 'superadmin' && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleDeleteFollowUp(followUp.id)}
                                className="text-destructive hover:text-destructive"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            )}
                            <Button
                              variant="default"
                              size="sm"
                              onClick={() => navigate(`/schools/${school.id}`)}
                            >
                              View School
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </div>

      {/* Complete Follow-up Dialog */}
      {selectedFollowUp && (
        <CompleteFollowUpDialog
          isOpen={isCompleteDialogOpen}
          onOpenChange={(open) => {
            setIsCompleteDialogOpen(open);
            if (!open) {
              setSelectedFollowUp(null);
            }
          }}
          followUp={selectedFollowUp}
          school={selectedFollowUp.schools}
        />
      )}

      {/* Phone Number Dialog */}
      {selectedSchoolForPhone && (
        <PhoneNumberDialog
          school={selectedSchoolForPhone}
          isOpen={isPhoneDialogOpen}
          onClose={() => {
            setIsPhoneDialogOpen(false);
            setSelectedSchoolForPhone(null);
          }}
        />
      )}
    </div>
  );
};

export default FollowUps;