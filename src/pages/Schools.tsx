import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useSchoolsPaginated } from '@/hooks/useSchoolsPaginated';
import { useAuth } from '@/hooks/useAuth';
import { School } from '@/types/database';
import Navbar from '@/components/layout/Navbar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Search, Edit, Eye, Trash2, Upload, Download, Star, Building2 } from 'lucide-react';
import { AddSchoolDialog } from '@/components/schools/AddSchoolDialog';
import { BulkActionBar } from '@/components/schools/BulkActionBar';
import { BulkStageDialog } from '@/components/schools/BulkStageDialog';
import { useActiveProject } from '@/hooks/useOlympiadProjects';
import { ExportFilteredSchools } from '@/components/export/ExportFilteredSchools';
import { useToast } from '@/hooks/use-toast';
import { SchoolFilters } from '@/components/schools/SchoolFilters';
import { SchoolCard } from '@/components/schools/SchoolCard';
import { Pagination, PaginationContent, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious, PaginationEllipsis } from '@/components/ui/pagination';
import { supabase } from '@/integrations/supabase/client';
const Schools = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { profile } = useAuth();
  const { data: activeProject } = useActiveProject();
  const [interestedSchools, setInterestedSchools] = useState<any[]>([]);
  const [showAllInterested, setShowAllInterested] = useState(false);
  const {
    schools,
    loading,
    totalCount,
    currentPage,
    totalPages,
    goToPage,
    applyFilters,
    createSchool,
    getNextSSNo,
    deleteSchool,
    getFilterOptions,
    getDistrictsByState
  } = useSchoolsPaginated(activeProject?.id);
  const { toast } = useToast();
  
  // Load saved filters from session storage
  const loadSavedFilters = () => {
    const saved = sessionStorage.getItem('schoolFilters');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        return null;
      }
    }
    return null;
  };

  const savedFilters = loadSavedFilters();
  
  const [searchTerm, setSearchTerm] = useState(savedFilters?.searchTerm || '');
  const [statusFilter, setStatusFilter] = useState(savedFilters?.statusFilter || 'all');
  const [workflowFilter, setWorkflowFilter] = useState(savedFilters?.workflowFilter || 'all');
  const [paymentFilter, setPaymentFilter] = useState(savedFilters?.paymentFilter || 'all');
  const [stateFilter, setStateFilter] = useState(savedFilters?.stateFilter || 'all');
  const [districtFilter, setDistrictFilter] = useState(savedFilters?.districtFilter || 'all');
  const [boardFilter, setBoardFilter] = useState(savedFilters?.boardFilter || 'all');
  const [initialFiltersApplied, setInitialFiltersApplied] = useState(false);
  const [isInterestedDialogOpen, setIsInterestedDialogOpen] = useState(false);
  const [projectSchoolIds, setProjectSchoolIds] = useState<string[]>([]);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [uniqueStates, setUniqueStates] = useState<string[]>([]);
  const [uniqueDistricts, setUniqueDistricts] = useState<string[]>([]);
  const [uniqueBoards, setUniqueBoards] = useState<string[]>([]);
  const [filteredDistricts, setFilteredDistricts] = useState<string[]>([]);
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [stageDialogOpen, setStageDialogOpen] = useState(false);
  const [newSchool, setNewSchool] = useState({
    ss_no: '', // Will be auto-populated
    school_name: '',
    school_address: '',
    state: '',
    district: '',
    board: '',
    mobile1: '',
    mobile2: '',
    email: '',
    contact_person_name: '',
    pincode: ''
  });
  
  const [nextSSNo, setNextSSNo] = useState<number | null>(null);
  
  // Fetch next SS No when dialog opens
  useEffect(() => {
    if (isCreateDialogOpen && !nextSSNo) {
      const fetchNextSSNo = async () => {
        const { data } = await getNextSSNo();
        if (data) {
          setNextSSNo(data);
          setNewSchool(prev => ({ ...prev, ss_no: data.toString() }));
        }
      };
      fetchNextSSNo();
    }
  }, [isCreateDialogOpen, nextSSNo, getNextSSNo]);
  const [availableStates, setAvailableStates] = useState<any[]>([]);
  const [availableDistricts, setAvailableDistricts] = useState<any[]>([]);
  const [filteredAvailableDistricts, setFilteredAvailableDistricts] = useState<any[]>([]);
  const [availableBoards, setAvailableBoards] = useState<any[]>([]);

  // Reset district filter when state changes
  useEffect(() => {
    if (stateFilter !== 'all') {
      setDistrictFilter('all');
    }
  }, [stateFilter]);

  // Save filters to session storage whenever they change
  useEffect(() => {
    const filters = {
      searchTerm,
      statusFilter,
      workflowFilter,
      paymentFilter,
      stateFilter,
      districtFilter,
      boardFilter
    };
    sessionStorage.setItem('schoolFilters', JSON.stringify(filters));
  }, [searchTerm, statusFilter, workflowFilter, paymentFilter, stateFilter, districtFilter, boardFilter]);

  // Clear filters when navigating away from schools page
  useEffect(() => {
    return () => {
      // Only clear if we're actually leaving the schools page
      const currentPath = window.location.pathname;
      if (!currentPath.includes('/schools')) {
        sessionStorage.removeItem('schoolFilters');
      }
    };
  }, []);

  // Load filter options on mount and when schools data changes
  useEffect(() => {
    const loadFilterOptions = async () => {
      const { uniqueStates: states, uniqueDistricts: districts, uniqueBoards: boards } = await getFilterOptions();
      setUniqueStates(states);
      setUniqueDistricts(districts);
      setUniqueBoards(boards || []);
      setFilteredDistricts(districts); // Initialize with all districts
    };
    loadFilterOptions();
  }, [getFilterOptions, schools]); // Re-run when schools data changes to pick up new districts/boards

  // Update filtered districts when state filter changes
  useEffect(() => {
    const updateFilteredDistricts = async () => {
      if (stateFilter === 'all') {
        setFilteredDistricts(uniqueDistricts);
      } else {
        try {
          const stateDistricts = await getDistrictsByState(stateFilter);
          setFilteredDistricts(stateDistricts);
          
          // Reset district filter if current selection is not in filtered list
          if (districtFilter !== 'all' && !stateDistricts.includes(districtFilter)) {
            setDistrictFilter('all');
          }
        } catch (error) {
          console.error('Error filtering districts:', error);
          setFilteredDistricts([]);
        }
      }
    };
    
    if (uniqueDistricts.length > 0) { // Only run when we have districts loaded
      updateFilteredDistricts();
    }
  }, [stateFilter, uniqueDistricts, getDistrictsByState, districtFilter]);

  // Load dropdown options for form
  useEffect(() => {
    const loadDropdownOptions = async () => {
      try {
        // Load states
        const { data: statesData } = await supabase
          .from('state_codes')
          .select('*')
          .eq('is_active', true)
          .order('state_name');
        setAvailableStates(statesData || []);

        // Load all districts
        const { data: districtsData } = await supabase
          .from('district_codes')
          .select('*')
          .eq('is_active', true)
          .order('district_name');
        setAvailableDistricts(districtsData || []);

        // Load boards (only active ones)
        const { data: boardsData } = await supabase
          .from('boards')
          .select('*')
          .eq('is_active', true)
          .order('board_name');
        setAvailableBoards(boardsData || []);
      } catch (error) {
        console.error('Error loading dropdown options:', error);
      }
    };
    loadDropdownOptions();
  }, []);

  // Update form districts when form state changes (for create dialog)
  useEffect(() => {
    const filterFormDistricts = async () => {
      if (newSchool.state) {
        try {
          const filtered = await getDistrictsByState(newSchool.state);
          setFilteredAvailableDistricts(filtered.map(district => ({ 
            district_name: district, 
            states: { state_name: newSchool.state } 
          })));
          
          // Reset district if it's not in the filtered list
          if (newSchool.district && !filtered.includes(newSchool.district)) {
            setNewSchool(prev => ({ ...prev, district: '' }));
          }
        } catch (error) {
          console.error('Error filtering form districts:', error);
          setFilteredAvailableDistricts([]);
        }
      } else {
        setFilteredAvailableDistricts([]);
        setNewSchool(prev => ({ ...prev, district: '' }));
      }
    };
    
    filterFormDistricts();
  }, [newSchool.state, getDistrictsByState]);

  // Handle URL parameters from dashboard
  useEffect(() => {
    if (initialFiltersApplied) return;
    
    // Map URL parameters to filters
    const courierStatus = searchParams.get('courier_status');
    const contacted = searchParams.get('contacted');
    const registrationInterest = searchParams.get('registration_interest');
    const consentRequested = searchParams.get('consent_form_requested');
    const consentSent = searchParams.get('consent_form_sent');
    const registrationStatus = searchParams.get('registration_status');
    const nameListStatus = searchParams.get('name_list_status');
    const paymentStatus = searchParams.get('payment_status');
    const questionPaperSent = searchParams.get('question_paper_sent');
    const answerSheetStatus = searchParams.get('answer_sheet_status');
    const resultStatus = searchParams.get('result_status');
    const dateFilter = searchParams.get('date');

    // Build workflow filter based on URL parameters
    let workflowValue = savedFilters?.workflowFilter || 'all';
    
    // URL parameters take precedence over saved filters
    if (courierStatus === 'Sent') workflowValue = 'courier_sent';
    else if (contacted === 'Yes') workflowValue = 'contacted_yes';
    else if (registrationInterest === 'Interested') workflowValue = 'registration_interested';
    else if (registrationInterest === 'Not Interested') workflowValue = 'registration_not_interested';
    else if (consentRequested === 'Yes') workflowValue = 'consent_requested';
    else if (consentSent === 'Sent') workflowValue = 'consent_sent_physical';
    else if (consentSent === 'Sent Digitally') workflowValue = 'consent_sent_digital';
    else if (consentSent === 'Sent,Sent Digitally') workflowValue = 'consent_sent_total';
    else if (registrationStatus === 'Confirmed') workflowValue = 'registration_confirmed';
    else if (registrationStatus === 'In Progress') workflowValue = 'registration_in_progress';
    else if (registrationStatus === 'Pending') workflowValue = 'registration_pending';
    else if (nameListStatus === 'Received') workflowValue = 'name_list_received';
    else if (nameListStatus === 'Uploaded') workflowValue = 'name_list_uploaded';
    else if (paymentStatus === 'Received') workflowValue = 'payment_received';
    else if (questionPaperSent === 'Sent') workflowValue = 'question_paper_sent';
    else if (answerSheetStatus === 'Received') workflowValue = 'answer_sheet_received';
    else if (resultStatus === 'Sent') workflowValue = 'result_sent';

    if (workflowValue !== 'all') {
      setWorkflowFilter(workflowValue);
    }

    // Apply the filters - URL parameters always trigger a fresh filter
    if (workflowValue !== 'all' || dateFilter) {
      setTimeout(() => {
        applyFilters({
          search: searchTerm,
          statusFilter,
          workflowFilter: workflowValue,
          paymentFilter,
          stateFilter,
          districtFilter,
          boardFilter,
          schoolIds: projectSchoolIds,
          projectId: activeProject?.id,
        });
        setInitialFiltersApplied(true);
      }, 100);
    } else {
      // Apply saved filters or default filters
      setTimeout(() => {
        applyFilters({
          search: searchTerm,
          statusFilter,
          workflowFilter,
          paymentFilter,
          stateFilter,
          districtFilter,
          boardFilter,
          schoolIds: projectSchoolIds,
          projectId: activeProject?.id,
        });
        setInitialFiltersApplied(true);
      }, 100);
    }
  }, [searchParams, initialFiltersApplied]);

  // Apply filters with debouncing
  useEffect(() => {
    if (!initialFiltersApplied) return;
    
    const timeoutId = setTimeout(() => {
      applyFilters({
        search: searchTerm,
        statusFilter,
        workflowFilter,
        paymentFilter,
        stateFilter,
        districtFilter,
        boardFilter,
        schoolIds: projectSchoolIds,
      });
    }, 300); // 300ms debounce

    return () => clearTimeout(timeoutId);
  }, [searchTerm, statusFilter, workflowFilter, paymentFilter, stateFilter, districtFilter, boardFilter, initialFiltersApplied, projectSchoolIds]); // Removed applyFilters dependency

  // Fetch all school IDs for active project, then immediately refilter
  useEffect(() => {
    if (!activeProject?.id) return;
    supabase
      .from('school_project_workflow')
      .select('school_id')
      .eq('project_id', activeProject.id)
      .then(({ data }) => {
        const ids = (data || []).map(r => r.school_id);
        setProjectSchoolIds(ids);
        // Immediately apply filter once IDs are ready (don't wait for debounce)
        applyFilters({
          search: searchTerm, statusFilter, workflowFilter, paymentFilter,
          stateFilter, districtFilter, boardFilter,
          schoolIds: ids,
          projectId: activeProject?.id,
        });
      });
  }, [activeProject?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch interested (Pending) schools for active project
  useEffect(() => {
    if (!activeProject?.id) return;
    supabase
      .from('school_project_workflow')
      .select('school_id, registration_status, schools(id, school_name, district, state, ss_no, mobile1, email)')
      .eq('project_id', activeProject.id)
      .eq('registration_status', 'Pending')
      .order('created_at', { ascending: false })
      .then(({ data }) => setInterestedSchools(data || []));
  }, [activeProject?.id]);

  const handleCreateSchool = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Validate required fields
    if (!newSchool.school_name || !newSchool.state || !newSchool.district || !newSchool.board) {
      toast({
        title: 'Error',
        description: 'School name, State, District, and Board are required fields',
        variant: 'destructive'
      });
      return;
    }

    const schoolData = {
      ...newSchool,
      // Convert SS No to number, or let database auto-assign if empty
      ss_no: newSchool.ss_no ? parseInt(newSchool.ss_no) : 0,
      courier_status: 'Sent' as const,
      contacted: 'No' as const,
      consent_form_requested: 'No' as const,
      consent_form_sent: 'Not Sent' as const,
      registration_status: 'Pending' as const,
      name_list_status: 'Pending' as const,
      payment_status: 'Pending' as const,
      question_paper_sent: 'Not Sent' as const,
      answer_sheet_status: 'Waiting' as const,
      result_status: 'Not Sent' as const,
      brochure_delivery_status: 'Physical Only' as const
    };
    
    const { error } = await createSchool(schoolData);
    
    if (!error) {
      setIsCreateDialogOpen(false);
      setNewSchool({
        ss_no: '',
        school_name: '',
        school_address: '',
        state: '',
        district: '',
        board: '',
        mobile1: '',
        mobile2: '',
        email: '',
        contact_person_name: '',
        pincode: ''
      });
      setNextSSNo(null); // Reset for next time
    }
  };
  
  const handleDeleteSchool = async (id: string) => {
    await deleteSchool(id);
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === schools.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(schools.map(s => s.id)));
    }
  };
  
  return <div className="min-h-screen bg-background">
      <Navbar />
      
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl font-bold text-foreground">
              {activeProject?.project_name ?? 'School Database'}
            </h1>
            <p className="text-muted-foreground mt-1">
              Registered schools for {activeProject?.project_name ?? 'this project'}
            </p>
          </div>
          
          <div className="flex space-x-2">
            <Button variant="outline" onClick={() => navigate('/bulk-import-export')}>
              <Upload className="h-4 w-4 mr-2" />
              Status Updates
            </Button>
            
            {profile?.role === 'superadmin' && (
              <Button 
                variant="outline" 
                onClick={() => setShowExportDialog(true)}
                className={
                  (searchTerm || statusFilter !== 'all' || workflowFilter !== 'all' || stateFilter !== 'all' || districtFilter !== 'all' || boardFilter !== 'all') 
                    ? 'border-primary text-primary' 
                    : ''
                }
              >
                <Download className="h-4 w-4 mr-2" />
                Export {(searchTerm || statusFilter !== 'all' || workflowFilter !== 'all' || stateFilter !== 'all' || districtFilter !== 'all' || boardFilter !== 'all') ? 'Filtered' : 'All'} ({totalCount})
              </Button>
            )}
            
            
            <Button variant="outline" onClick={() => setIsInterestedDialogOpen(true)}
              className="border-amber-300 text-amber-700 hover:bg-amber-50">
              <Star className="h-4 w-4 mr-2 fill-amber-400" />
              Add Interested School
            </Button>
            <Button onClick={() => setIsCreateDialogOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Add School
            </Button>
            <AddSchoolDialog
              open={isCreateDialogOpen}
              onOpenChange={setIsCreateDialogOpen}
              onCreated={() => applyFilters({ search: searchTerm, statusFilter, workflowFilter, paymentFilter, stateFilter, districtFilter, boardFilter, schoolIds: projectSchoolIds, projectId: activeProject?.id})}
            />
            <AddSchoolDialog
              open={isInterestedDialogOpen}
              onOpenChange={setIsInterestedDialogOpen}
              mode="interested"
              onCreated={() => {
                applyFilters({ search: searchTerm, statusFilter, workflowFilter, paymentFilter, stateFilter, districtFilter, boardFilter, schoolIds: projectSchoolIds, projectId: activeProject?.id});
                supabase.from('school_project_workflow')
                  .select('school_id, registration_status, schools(id,school_name,district,state,ss_no,mobile1,email)')
                  .eq('project_id', activeProject?.id || '')
                  .eq('registration_status', 'Pending')
                  .order('created_at', { ascending: false })
                  .then(({ data }) => setInterestedSchools(data || []));
              }}
            />
          </div>
        </div>

        {/* Interested Schools Banner */}
        {interestedSchools.length > 0 && (
          <div className="mb-6 bg-amber-50 border border-amber-200 rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Star className="h-5 w-5 text-amber-600 fill-amber-400" />
                <span className="font-semibold text-amber-900 text-base">
                  Interested Schools
                </span>
                <span className="bg-amber-200 text-amber-800 text-sm font-bold px-2.5 py-0.5 rounded-full">
                  {interestedSchools.length}
                </span>
                <span className="text-amber-700 text-sm">— contacted and interested, pending registration</span>
              </div>
              <button
                onClick={() => setShowAllInterested(v => !v)}
                className="text-sm text-amber-700 font-medium hover:text-amber-900 underline underline-offset-2"
              >
                {showAllInterested ? 'Show less' : 'Show all'}
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {(showAllInterested ? interestedSchools : interestedSchools.slice(0, 6)).map((row: any) => {
                const school = row.schools;
                if (!school) return null;
                return (
                  <button
                    key={row.school_id}
                    onClick={() => navigate(`/schools/${school.id}`)}
                    className="flex items-center gap-3 bg-white border border-amber-200 rounded-lg px-3 py-2.5 text-left hover:border-amber-400 hover:shadow-sm transition-all"
                  >
                    <div className="w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0">
                      <span className="text-xs font-bold text-amber-700">{String(school.ss_no).slice(-2)}</span>
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-gray-900 truncate">{school.school_name}</p>
                      <p className="text-xs text-gray-500">{school.district}, {school.state}</p>
                    </div>
                  </button>
                );
              })}
            </div>
            {!showAllInterested && interestedSchools.length > 6 && (
              <p className="text-xs text-amber-600 mt-2 ml-1">+{interestedSchools.length - 6} more — click "Show all"</p>
            )}
          </div>
        )}

        <SchoolFilters
          searchTerm={searchTerm}
          setSearchTerm={setSearchTerm}
          statusFilter={statusFilter}
          setStatusFilter={setStatusFilter}
          workflowFilter={workflowFilter}
          setWorkflowFilter={setWorkflowFilter}
          paymentFilter={paymentFilter}
          setPaymentFilter={setPaymentFilter}
          stateFilter={stateFilter}
          setStateFilter={setStateFilter}
          districtFilter={districtFilter}
          setDistrictFilter={setDistrictFilter}
          boardFilter={boardFilter}
          setBoardFilter={setBoardFilter}
          uniqueStates={uniqueStates}
          uniqueDistricts={uniqueDistricts}
          uniqueBoards={uniqueBoards}
          filteredDistricts={filteredDistricts}
        />

        <div className="mb-4 text-sm text-muted-foreground">
          Showing {schools.length} of {totalCount} schools
          {(searchTerm || statusFilter !== 'all' || workflowFilter !== 'all' || stateFilter !== 'all' || districtFilter !== 'all' || boardFilter !== 'all') && 
            <span className="ml-2 text-primary font-medium">(filtered)</span>
          }
        </div>

        {loading && schools.length === 0 ? (
          <div className="flex items-center justify-center h-96">
            <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-primary"></div>
          </div>
        ) : schools.length > 0 ? (
          <>
            <div className="flex items-center gap-2 mb-2 px-1">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-gray-300 text-indigo-600 cursor-pointer"
                checked={selectedIds.size === schools.length && schools.length > 0}
                onChange={toggleSelectAll}
              />
              <span className="text-sm text-muted-foreground">
                {selectedIds.size > 0 ? `${selectedIds.size} selected` : 'Select all on page'}
              </span>
            </div>
            <div className="space-y-3 border rounded-lg p-4">
              {schools.map((school) => (
                <SchoolCard
                  key={school.id}
                  school={school}
                  onDelete={handleDeleteSchool}
                  showDeleteButton={profile?.role === 'superadmin'}
                  selected={selectedIds.has(school.id)}
                  onToggleSelect={toggleSelect}
                />
              ))}
            </div>
            
            {totalPages > 1 && (
              <div className="mt-6 flex justify-center">
                <Pagination>
                  <PaginationContent>
                    <PaginationItem>
                      <PaginationPrevious 
                        onClick={() => currentPage > 1 && goToPage(currentPage - 1)}
                        className={currentPage === 1 ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
                      />
                    </PaginationItem>
                    
                    {/* First page */}
                    {currentPage > 2 && (
                      <>
                        <PaginationItem>
                          <PaginationLink onClick={() => goToPage(1)} className="cursor-pointer">
                            1
                          </PaginationLink>
                        </PaginationItem>
                        {currentPage > 3 && <PaginationEllipsis />}
                      </>
                    )}
                    
                    {/* Previous page */}
                    {currentPage > 1 && (
                      <PaginationItem>
                        <PaginationLink onClick={() => goToPage(currentPage - 1)} className="cursor-pointer">
                          {currentPage - 1}
                        </PaginationLink>
                      </PaginationItem>
                    )}
                    
                    {/* Current page */}
                    <PaginationItem>
                      <PaginationLink isActive className="cursor-default">
                        {currentPage}
                      </PaginationLink>
                    </PaginationItem>
                    
                    {/* Next page */}
                    {currentPage < totalPages && (
                      <PaginationItem>
                        <PaginationLink onClick={() => goToPage(currentPage + 1)} className="cursor-pointer">
                          {currentPage + 1}
                        </PaginationLink>
                      </PaginationItem>
                    )}
                    
                    {/* Last page */}
                    {currentPage < totalPages - 1 && (
                      <>
                        {currentPage < totalPages - 2 && <PaginationEllipsis />}
                        <PaginationItem>
                          <PaginationLink onClick={() => goToPage(totalPages)} className="cursor-pointer">
                            {totalPages}
                          </PaginationLink>
                        </PaginationItem>
                      </>
                    )}
                    
                    <PaginationItem>
                      <PaginationNext 
                        onClick={() => currentPage < totalPages && goToPage(currentPage + 1)}
                        className={currentPage === totalPages ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
                      />
                    </PaginationItem>
                  </PaginationContent>
                </Pagination>
              </div>
            )}
          </>
        ) : (
          <div className="text-center py-20 bg-white rounded-2xl border border-dashed border-gray-200 mt-4">
            <Building2 className="h-14 w-14 text-gray-200 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-gray-700 mb-1">
              No schools in {activeProject?.project_name ?? 'this project'} yet
            </h3>
            <p className="text-gray-400 text-sm max-w-sm mx-auto mb-6">
              Schools appear here only after a staff member marks them as interested or registers them from the Prospect Schools module.
            </p>
            <Button variant="outline" onClick={() => navigate('/prospect/schools')}>
              Go to Prospect Schools →
            </Button>
          </div>
        )}
      </div>
      
      <ExportFilteredSchools
        isOpen={showExportDialog}
        onClose={() => setShowExportDialog(false)}
        filters={{
          search: searchTerm,
          statusFilter,
          workflowFilter,
          stateFilter,
          districtFilter,
          boardFilter
        }}
        totalCount={totalCount}
      />

      {selectedIds.size > 0 && (
        <BulkActionBar
          count={selectedIds.size}
          onStage={() => setStageDialogOpen(true)}
          onClear={() => setSelectedIds(new Set())}
        />
      )}

      <BulkStageDialog
        open={stageDialogOpen}
        onOpenChange={setStageDialogOpen}
        schoolIds={Array.from(selectedIds)}
        projectId={activeProject?.id ?? ''}
        onDone={() => {
          setSelectedIds(new Set());
          applyFilters({ search: searchTerm, statusFilter, workflowFilter, paymentFilter, stateFilter, districtFilter, boardFilter, schoolIds: projectSchoolIds });
        }}
      />
    </div>;
};
export default Schools;