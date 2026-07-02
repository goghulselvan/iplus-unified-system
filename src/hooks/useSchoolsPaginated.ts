import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { School, DashboardMetrics, DashboardMetricsByDate } from '@/types/database';
import { useToast } from '@/hooks/use-toast';

interface PaginatedSchoolsResult {
  schools: School[];
  totalCount: number;
  hasMore: boolean;
}

interface SchoolFilters {
  search?: string;
  statusFilter?: string;
  workflowFilter?: string;
  paymentFilter?: string;
  stateFilter?: string;
  districtFilter?: string;
  boardFilter?: string;
  schoolIds?: string[]; // filter to specific school IDs (for project view)
  projectId?: string;   // scope list to schools in this project's workflow
}

// scopeProjectId: when provided, EVERY fetch is scoped to schools in that
// project's workflow. Injected at the hook level so no call path (mount fetch,
// loadMore, stale filters) can accidentally drop it — the source of the
// recurring "all schools show" bug.
export const useSchoolsPaginated = (scopeProjectId?: string) => {
  const [schools, setSchools] = useState<School[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalCount, setTotalCount] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [filters, setFilters] = useState<SchoolFilters>({});
  const { toast } = useToast();

  const PAGE_SIZE = 25; // Reduced for better performance with large datasets

  const buildQuery = useCallback((offset = 0, limit = PAGE_SIZE, searchFilters: SchoolFilters = {}) => {
    let query = supabase
      .from('schools')
      .select('*', { count: 'exact' })
      .range(offset, offset + limit - 1)
      .order('updated_at', { ascending: false }); // Order by updated_at for better performance

    // Filter to specific school IDs (project view)
    if (searchFilters.schoolIds && searchFilters.schoolIds.length > 0) {
      query = query.in('id', searchFilters.schoolIds);
    } else if (searchFilters.schoolIds && searchFilters.schoolIds.length === 0) {
      // Active project has no schools yet — return empty
      query = query.eq('id', '00000000-0000-0000-0000-000000000000');
    }

    // Optimize search filter - use specific columns for better indexing
    if (searchFilters.search?.trim()) {
      const searchTerm = searchFilters.search.trim();
      // Check if it's a number first for SS_NO search
      if (!isNaN(parseInt(searchTerm))) {
        query = query.eq('ss_no', parseInt(searchTerm));
      } else {
        // For text search, use case-insensitive search across multiple fields
        query = query.or(`school_name.ilike.%${searchTerm}%,district.ilike.%${searchTerm}%,contact_person_name.ilike.%${searchTerm}%,email.ilike.%${searchTerm}%,mobile1.ilike.%${searchTerm}%,mobile2.ilike.%${searchTerm}%`);
      }
    }

    // Apply status filter
    if (searchFilters.statusFilter && searchFilters.statusFilter !== 'all') {
      query = query.eq('registration_status', searchFilters.statusFilter === 'pending' ? 'Pending' : 'Confirmed');
    }

    // Apply workflow filter with detailed logging
    if (searchFilters.workflowFilter && searchFilters.workflowFilter !== 'all') {
      console.log('🔍 Applying workflow filter:', searchFilters.workflowFilter);
      switch(searchFilters.workflowFilter) {
        case 'courier_sent':
          query = query.eq('courier_status', 'Sent');
          break;
        case 'courier_returned':
          query = query.eq('courier_status', 'Returned');
          break;
        case 'contacted_yes':
          query = query.eq('contacted', 'Yes');
          break;
        case 'contacted_no':
          query = query.eq('contacted', 'No');
          break;
      case 'registration_interested':
        query = query.eq('registration_interest', 'Interested');
        break;
      case 'registration_not_interested':
        query = query.eq('registration_interest', 'Not Interested');
        break;
      case 'registration_pending':
        console.log('🎯 Applying registration_pending filter');
        query = query.eq('registration_status', 'Pending');
        break;
      case 'registration_confirmed':
        console.log('🎯 Applying registration_confirmed filter');
        query = query.eq('registration_status', 'Confirmed');
        break;
      case 'registration_in_progress':
        console.log('🎯 Applying registration_in_progress filter');
        query = query.eq('registration_status', 'In Progress');
        break;
        case 'consent_requested':
          query = query.eq('consent_form_requested', 'Yes');
          break;
        case 'consent_sent_physical':
          query = query.eq('consent_form_sent', 'Sent');
          break;
        case 'consent_sent_digital':
          query = query.eq('consent_form_sent', 'Sent Digitally');
          break;
        case 'consent_sent_total':
          query = query.in('consent_form_sent', ['Sent', 'Sent Digitally']);
          break;
        case 'payment_received':
          query = query.eq('payment_status', 'Received');
          break;
        case 'question_paper_sent':
          query = query.eq('question_paper_sent', 'Sent');
          break;
        case 'answer_sheet_received':
          query = query.eq('answer_sheet_status', 'Received');
          break;
        case 'name_list_received':
          query = query.eq('name_list_status', 'Received');
          break;
        case 'name_list_uploaded':
          console.log('🎯 Applying name_list_uploaded filter');
          query = query.eq('name_list_status', 'Uploaded');
          break;
        case 'result_sent':
          query = query.eq('result_status', 'Sent');
          break;
      }
    }

    // Apply state filter (case-insensitive) - match by state directly
    if (searchFilters.stateFilter && searchFilters.stateFilter !== 'all') {
      if (!searchFilters.districtFilter || searchFilters.districtFilter === 'all') {
        // Filter by state directly
        query = query.ilike('state', `%${searchFilters.stateFilter}%`);
      }
    }

    // Apply district filter (case-insensitive)
    if (searchFilters.districtFilter && searchFilters.districtFilter !== 'all') {
      query = query.ilike('district', searchFilters.districtFilter);
    }

    // Apply board filter (case-insensitive)
    if (searchFilters.boardFilter && searchFilters.boardFilter !== 'all') {
      query = query.ilike('board', searchFilters.boardFilter);
    }

    // Apply payment filter
    if (searchFilters.paymentFilter && searchFilters.paymentFilter !== 'all') {
      query = query.eq('payment_status', searchFilters.paymentFilter as 'Pending' | 'Partial' | 'Received');
    }

    return query;
  }, []);

  // Optimized fetch schools using database function for better performance
  const fetchSchools = useCallback(async (page = 1, searchFilters: SchoolFilters = {}) => {
    try {
      console.log('fetchSchools called with:', { page, searchFilters });
      setLoading(true);
      const offset = (page - 1) * PAGE_SIZE;
      
      // Convert "all" values to null for proper database filtering
      const cleanFilters = {
        search: searchFilters.search && searchFilters.search.trim() !== '' ? searchFilters.search.trim() : null,
        state: searchFilters.stateFilter && searchFilters.stateFilter !== 'all' ? searchFilters.stateFilter : null,
        district: searchFilters.districtFilter && searchFilters.districtFilter !== 'all' ? searchFilters.districtFilter : null,
        status: searchFilters.statusFilter && searchFilters.statusFilter !== 'all' ? searchFilters.statusFilter : null
      };
      
      console.log('Clean filters for database:', cleanFilters);
      
      // Use new case-insensitive search function for consistent formatting
      const { data, error } = await supabase.rpc('search_schools_case_insensitive', {
        search_term: cleanFilters.search,
        state_filter: cleanFilters.state,
        district_filter: cleanFilters.district,  
        status_filter: cleanFilters.status,
        workflow_filter: searchFilters.workflowFilter && searchFilters.workflowFilter !== 'all' ? searchFilters.workflowFilter : null,
        payment_filter: searchFilters.paymentFilter && searchFilters.paymentFilter !== 'all' ? searchFilters.paymentFilter : null,
        board_filter: searchFilters.boardFilter && searchFilters.boardFilter !== 'all' ? searchFilters.boardFilter : null,
        limit_count: PAGE_SIZE,
        offset_count: offset,
        // Hook-level scope wins; never let a stale/empty filter object drop it.
        project_filter: scopeProjectId ?? searchFilters.projectId ?? null,
      });

      console.log('search_schools_case_insensitive result:', { data: data?.length, error });

      if (error) throw error;

      const newSchools = data || [];
      const count = newSchools.length > 0 ? newSchools[0].total_count : 0;
      
      console.log('Processing schools:', { newSchoolsCount: newSchools.length, totalCount: count });
      
      setSchools(newSchools.map(({ total_count, ...school }) => school) as School[]);
      setCurrentPage(page);
      setTotalCount(Number(count));
      setHasMore(offset + newSchools.length < Number(count));
    } catch (error: any) {
      console.error('fetchSchools error:', error);
      toast({
        title: 'Error',
        description: 'Failed to fetch schools',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }, [toast, scopeProjectId]);

  const loadMore = useCallback(() => {
    if (!loading && hasMore) {
      fetchSchools(currentPage + 1, filters);
    }
  }, [loading, hasMore, fetchSchools, filters, currentPage]);

  const goToPage = useCallback((page: number) => {
    fetchSchools(page, filters);
  }, [fetchSchools, filters]);

  const applyFilters = useCallback((newFilters: SchoolFilters) => {
    setFilters(newFilters);
    setCurrentPage(1);
    fetchSchools(1, newFilters);
  }, [fetchSchools]);

  const refreshSchools = useCallback(() => {
    fetchSchools(currentPage, filters);
  }, [fetchSchools, filters, currentPage]);

  // Get next available SS No
  const getNextSSNo = async () => {
    try {
      const { data, error } = await supabase.rpc('get_next_ss_no');
      
      if (error) throw error;
      
      return { data, error: null };
    } catch (error: any) {
      console.error('Error getting next SS No:', error);
      return { data: null, error };
    }
  };

  const createSchool = async (schoolData: Omit<School, 'id' | 'created_at' | 'updated_at'>) => {
    try {
      // Import normalization functions
      const { normalizeSchoolData, validateSchoolData } = await import('@/utils/dataHelpers');
      
      // If SS No is not provided or is 0, the database trigger will auto-assign it
      // So we don't need to validate SS No as a required field for creation
      const schoolDataForValidation = { ...schoolData };
      
      // Validate the data (excluding SS No since it's auto-assigned)
      const validation = validateSchoolData(schoolDataForValidation, true); // Use partial validation
      if (!validation.isValid) {
        toast({
          title: 'Validation Error',
          description: validation.errors.join(', '),
          variant: 'destructive',
        });
        return { data: null, error: new Error(validation.errors.join(', ')) };
      }

      // Normalize the data before saving
      const normalizedData = normalizeSchoolData(schoolData);

      const { data, error } = await supabase
        .from('schools')
        .insert([normalizedData])
        .select()
        .single();

      if (error) throw error;
      
      // Refresh to maintain consistency
      refreshSchools();
      
      toast({
        title: 'Success',
        description: `School created successfully with SS No: ${data.ss_no}`,
      });
      return { data, error: null };
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      });
      return { data: null, error };
    }
  };

  const updateSchool = async (id: string, updates: Partial<School>, isManualEdit: boolean = false) => {
    try {
      // Import normalization functions
      const { normalizeSchoolData, validateSchoolData } = await import('@/utils/dataHelpers');
      
      // Protected fields that require manual edit mode
      const protectedFields = ['ss_no', 'school_name', 'school_address', 'district', 'state', 'board', 'mobile1', 'mobile2', 'email', 'contact_person_name', 'pincode'];
      const hasProtectedFields = Object.keys(updates).some(key => protectedFields.includes(key));
      
      // Validate the data if it contains required fields (but use partial validation for manual edits)
      const hasRequiredFields = Object.keys(updates).some(key => 
        ['school_name', 'state', 'district', 'board'].includes(key)
      );
      
      if (hasRequiredFields) {
        const validation = validateSchoolData(updates, isManualEdit); // Pass isManualEdit for partial validation
        if (!validation.isValid) {
          toast({
            title: 'Validation Error',
            description: validation.errors.join(', '),
            variant: 'destructive',
          });
          return { data: null, error: new Error(validation.errors.join(', ')) };
        }
      }

      // Normalize the data before saving
      const normalizedUpdates = normalizeSchoolData(updates);

      let data, error;

      // Use manual edit function for protected fields
      if (hasProtectedFields && isManualEdit) {
        const result = await supabase.rpc('update_school_with_manual_edit', {
          p_school_id: id,
          p_updates: normalizedUpdates
        });
        
        if (result.error) {
          error = result.error;
        } else {
          // Fetch the complete updated record
          const fetchResult = await supabase
            .from('schools')
            .select('*')
            .eq('id', id)
            .single();
          
          data = fetchResult.data;
          error = fetchResult.error;
        }
      } else {
        // Standard update for workflow fields only
        const result = await supabase
          .from('schools')
          .update(normalizedUpdates)
          .eq('id', id)
          .select()
          .single();
        
        data = result.data;
        error = result.error;
      }

      if (error) throw error;
      
      setSchools(prev => prev.map(school => 
        school.id === id ? { ...school, ...normalizedUpdates } : school
      ));
      
      toast({
        title: 'Success',
        description: isManualEdit ? 'School details updated successfully (Manual Edit)' : 'School updated successfully',
      });
      return { data, error: null };
    } catch (error: any) {
      // Enhanced error handling for protected fields
      if (error.message?.includes('Protected field') || error.message?.includes('Manual edit required')) {
        toast({
          title: 'Protected Field Update Blocked',
          description: 'Basic school details are protected. Use the Edit button to modify these fields manually.',
          variant: 'destructive',
        });
      } else {
        toast({
          title: 'Error',
          description: error.message || 'Failed to update school',
          variant: 'destructive',
        });
      }
      return { data: null, error };
    }
  };

  const deleteSchool = async (id: string) => {
    try {
      const { data: schoolRow } = await supabase
        .from('schools')
        .select('prospect_school_id')
        .eq('id', id)
        .maybeSingle();

      const { error } = await supabase
        .from('schools')
        .delete()
        .eq('id', id);

      if (error) throw error;

      if (schoolRow?.prospect_school_id) {
        await supabase
          .from('prospect_schools')
          .update({ stage: 'uncontacted', linked_to_crm: false })
          .eq('id', schoolRow.prospect_school_id);
      }
      
      setSchools(prev => prev.filter(school => school.id !== id));
      setTotalCount(prev => Math.max(0, prev - 1));
      
      toast({
        title: 'Success',
        description: 'School deleted successfully',
      });
      return { error: null };
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      });
      return { error };
    }
  };

  const getSchoolById = useCallback(async (id: string): Promise<{ data: School | null; error: any }> => {
    try {
      const { data, error } = await supabase
        .from('schools')
        .select('*')
        .eq('id', id)
        .maybeSingle();

      if (error) throw error;
      
      return { data: data as School, error: null };
    } catch (error: any) {
      return { data: null, error };
    }
  }, []);

  const getDashboardMetrics = async (): Promise<DashboardMetrics> => {
    try {
      const { data, error } = await supabase.rpc('get_dashboard_metrics');
      
      if (error) throw error;
      
      const metrics = data[0];
      return {
        total_schools: Number(metrics.total_schools),
        courier_sent: Number(metrics.courier_sent),
        courier_returned: Number(metrics.courier_returned),
        contacted_yes: Number(metrics.contacted_yes),
        contacted_no: Number(metrics.contacted_no),
        registration_interested: Number(metrics.registration_interested),
        registration_not_interested: Number(metrics.registration_not_interested),
        consent_requested: Number(metrics.consent_requested),
        consent_form_sent_total: Number(metrics.consent_form_sent_total),
        consent_form_sent_physical: Number(metrics.consent_form_sent_physical),
        consent_form_sent_digital: Number(metrics.consent_form_sent_digital),
        registration_confirmed: Number(metrics.registration_confirmed),
        registration_in_progress: Number((metrics as any).registration_in_progress || 0),
        name_list_received: Number(metrics.name_list_received),
        name_list_uploaded: Number(metrics.name_list_uploaded),
        payment_received: Number(metrics.payment_received),
        question_paper_sent: Number(metrics.question_paper_sent),
        answer_sheet_received: Number(metrics.answer_sheet_received),
        result_sent: Number(metrics.result_sent),
        total_consent_forms: { 'Total': 0 }
      };
    } catch (error) {
      // Fallback to client-side calculation if RPC fails
      const metrics: DashboardMetrics = {
        total_schools: totalCount,
        courier_sent: 0,
        courier_returned: 0,
        contacted_yes: 0,
        contacted_no: 0,
        registration_interested: 0,
        registration_not_interested: 0,
        consent_requested: 0,
        consent_form_sent_total: 0,
        consent_form_sent_physical: 0,
        consent_form_sent_digital: 0,
        registration_confirmed: 0,
        registration_in_progress: 0,
        name_list_received: 0,
        name_list_uploaded: 0,
        payment_received: 0,
        question_paper_sent: 0,
        answer_sheet_received: 0,
        result_sent: 0,
        total_consent_forms: { 'Total': 0 }
      };
      return metrics;
    }
  };

  const getDashboardMetricsByProject = async (projectId?: string): Promise<DashboardMetrics & { total_registrations: number }> => {
    try {
      const { data, error } = await supabase.rpc('get_dashboard_metrics_by_project', { 
        p_project_id: projectId || null 
      });
      
      if (error) throw error;
      
      const metrics = data[0];
      return {
        total_schools: Number(metrics.total_schools),
        courier_sent: Number(metrics.courier_sent),
        courier_returned: Number(metrics.courier_returned),
        contacted_yes: Number(metrics.contacted_yes),
        contacted_no: Number(metrics.contacted_no),
        registration_interested: Number(metrics.registration_interested),
        registration_not_interested: Number(metrics.registration_not_interested),
        consent_requested: Number(metrics.consent_requested),
        consent_form_sent_total: Number(metrics.consent_form_sent_total),
        consent_form_sent_physical: Number(metrics.consent_form_sent_physical),
        consent_form_sent_digital: Number(metrics.consent_form_sent_digital),
        registration_confirmed: Number(metrics.registration_confirmed),
        registration_in_progress: Number((metrics as any).registration_in_progress || 0),
        name_list_received: Number(metrics.name_list_received),
        name_list_uploaded: Number((metrics as any).name_list_uploaded || 0),
        payment_received: Number(metrics.payment_received),
        question_paper_sent: Number(metrics.question_paper_sent),
        answer_sheet_received: Number(metrics.answer_sheet_received),
        result_sent: Number(metrics.result_sent),
        total_consent_forms: { 'Total': Number(metrics.consent_form_sent_total) },
        total_registrations: Number(metrics.total_registrations)
      };
    } catch (error) {
      console.error('Failed to fetch project dashboard metrics:', error);
      const metrics = {
        total_schools: 0,
        courier_sent: 0,
        courier_returned: 0,
        contacted_yes: 0,
        contacted_no: 0,
        registration_interested: 0,
        registration_not_interested: 0,
        consent_requested: 0,
        consent_form_sent_total: 0,
        consent_form_sent_physical: 0,
        consent_form_sent_digital: 0,
        registration_confirmed: 0,
        registration_in_progress: 0,
        name_list_received: 0,
        name_list_uploaded: 0,
        payment_received: 0,
        question_paper_sent: 0,
        answer_sheet_received: 0,
        result_sent: 0,
        total_consent_forms: { 'Total': 0 },
        total_registrations: 0
      };
      return metrics;
    }
  };

  const getDashboardMetricsByDate = async (targetDate: string): Promise<DashboardMetricsByDate> => {
    try {
      const { data, error } = await supabase.rpc('get_dashboard_metrics_by_date', { target_date: targetDate });
      
      if (error) throw error;
      
      const metrics = data[0];
      return {
        total_schools: Number(metrics.total_schools),
        courier_sent: Number(metrics.courier_sent),
        courier_returned: Number(metrics.courier_returned),
        contacted_yes: Number(metrics.contacted_yes),
        contacted_no: Number(metrics.contacted_no),
        registration_interested: Number(metrics.registration_interested),
        registration_not_interested: Number(metrics.registration_not_interested),
        consent_requested: Number(metrics.consent_requested),
        consent_form_sent_total: Number(metrics.consent_form_sent_total),
        consent_form_sent_physical: Number(metrics.consent_form_sent_physical),
        consent_form_sent_digital: Number(metrics.consent_form_sent_digital),
        registration_confirmed: Number(metrics.registration_confirmed),
        name_list_received: Number(metrics.name_list_received),
        name_list_uploaded: Number((metrics as any).name_list_uploaded || 0),
        payment_received: Number(metrics.payment_received),
        question_paper_sent: Number(metrics.question_paper_sent),
        answer_sheet_received: Number(metrics.answer_sheet_received),
        result_sent: Number(metrics.result_sent),
        communications_count: Number(metrics.communications_count),
        follow_ups_created: Number(metrics.follow_ups_created),
        follow_ups_completed: Number(metrics.follow_ups_completed),
      };
    } catch (error) {
      return {
        total_schools: 0,
        courier_sent: 0,
        courier_returned: 0,
        contacted_yes: 0,
        contacted_no: 0,
        registration_interested: 0,
        registration_not_interested: 0,
        consent_requested: 0,
        consent_form_sent_total: 0,
        consent_form_sent_physical: 0,
        consent_form_sent_digital: 0,
        registration_confirmed: 0,
        name_list_received: 0,
        name_list_uploaded: 0,
        payment_received: 0,
        question_paper_sent: 0,
        answer_sheet_received: 0,
        result_sent: 0,
        communications_count: 0,
        follow_ups_created: 0,
        follow_ups_completed: 0,
      };
    }
  };

  // Dynamic state to district mapping from database with fallback
  const getDistrictsByState = useCallback(async (state: string): Promise<string[]> => {
    try {
      // First try to fetch districts from the districts table joined with states
      const { data: stateDistricts, error: districtError } = await supabase
        .from('district_codes')
        .select('district_name, state_code')
        .eq('is_active', true);

      // Filter by state code after fetching
      const stateCode = await supabase
        .from('state_codes')
        .select('state_code')
        .ilike('state_name', state)
        .eq('is_active', true)
        .single();

      if (!districtError && stateDistricts && stateCode.data) {
        const filteredDistricts = stateDistricts
          .filter(item => item.state_code === stateCode.data.state_code)
          .map(item => item.district_name?.toString().trim())
          .filter(district => district && district.length > 0)
          .map(district => {
            // Normalize to proper title case for consistent display
            return district!.toLowerCase()
              .split(' ')
              .map(word => word.charAt(0).toUpperCase() + word.slice(1))
              .join(' ');
          })
          .sort();

        console.log(`Found ${filteredDistricts.length} districts for ${state} from district_codes table:`, filteredDistricts);
        if (filteredDistricts.length > 0) {
          return filteredDistricts;
        }
      }

      // Fallback: Fetch districts from schools table where state matches
      const { data: schoolDistricts, error } = await supabase
        .from('schools')
        .select('district')
        .ilike('state', state)
        .not('district', 'is', null)
        .neq('district', '');

      if (error) throw error;

      // Process districts and normalize names
      const districtSet = new Set<string>();
      
      schoolDistricts?.forEach(item => {
        const district = item.district?.toString().trim();
        if (district && district.length > 0) {
          // Normalize to proper title case for consistent display
          const normalizedDistrict = district.toLowerCase()
            .split(' ')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ');
          
          districtSet.add(normalizedDistrict);
        }
      });

      // Convert to sorted array
      const uniqueDistricts = Array.from(districtSet).sort();

      console.log(`Found ${uniqueDistricts.length} districts for ${state} from schools table (fallback):`, uniqueDistricts);

      // Return districts from schools or use predefined mapping
      if (uniqueDistricts.length > 0) {
        return uniqueDistricts;
      }

      // Fallback to predefined mapping for known states
      const stateDistrictMap: { [key: string]: string[] } = {
        'TAMIL NADU': [
          'ARIYALUR', 'CHENGALPATTU', 'CHENNAI', 'COIMBATORE', 'CUDDALORE', 
          'DHARMAPURI', 'DINDIGUL', 'ERODE', 'KALLAKURICHI', 'KANCHEEPURAM', 
          'KANNIYAKUMARI', 'KARUR', 'KRISHNAGIRI', 'MADURAI', 'MAYILADUTHURAI', 
          'NAGAPATTINAM', 'NAMAKKAL', 'THE NILGIRIS', 'PERAMBALUR', 'PUDUKKOTTAI', 
          'RAMANATHAPURAM', 'RANIPET', 'SALEM', 'SIVAGANGAI', 'TENKASI', 'THANJAVUR', 
          'THENI', 'TIRUPATHUR', 'TIRUVALLUR', 'TIRUVARUR', 'THOOTHUKUDI', 
          'TIRUCHIRAPPALLI', 'TIRUNELVELI', 'TIRUPPUR', 'TIRUVANNAMALAI', 
          'VELLORE', 'VILLUPURAM', 'VIRUDHUNAGAR'
        ],
        'PUDUCHERRY': ['PUDUCHERRY', 'KARAIKAL', 'MAHE', 'YANAM'],
        'KARNATAKA': [
          'BAGALKOT', 'BALLARI', 'BANGALORE RURAL', 'BANGALORE URBAN', 'BELGAUM', 
          'BIDAR', 'CHAMARAJANAGAR', 'CHIKBALLAPUR', 'CHIKKAMAGALURU', 'CHITRADURGA', 
          'DAKSHINA KANNADA', 'DAVANAGERE', 'DHARWAD', 'GADAG', 'GULBARGA', 
          'HASSAN', 'HAVERI', 'KODAGU', 'KOLAR', 'KOPPAL', 'MANDYA', 'MYSORE', 
          'RAICHUR', 'RAMANAGARA', 'SHIMOGA', 'TUMKUR', 'UDUPI', 'UTTARA KANNADA', 
          'YADGIR', 'BANGALORE', 'BENGALURU'
        ]
      };

      return stateDistrictMap[state.toUpperCase()] || [];
    } catch (error) {
      console.error('Error fetching districts for state:', error);
      return [];
    }
  }, [])

  // Board filter - only show active boards from board management
  const getBoardsFromDatabase = useCallback(async (): Promise<string[]> => {
    try {
      // First get active boards from board management table
      const { data: activeBoards, error: boardError } = await supabase
        .from('boards')
        .select('board_name')
        .eq('is_active', true)
        .order('board_name');

      if (boardError) throw boardError;

      // If we have active boards defined, use only those
      if (activeBoards && activeBoards.length > 0) {
        return activeBoards.map(board => board.board_name);
      }

      // Fallback to unique boards from schools table if no board management data
      const { data, error } = await supabase
        .from('schools')
        .select('board')
        .not('board', 'is', null)
        .not('board', 'eq', '');

      if (error) throw error;

      // Get unique boards and normalize them for consistent display
      const uniqueBoards = [...new Set(data.map(item => item.board))].sort();
      return uniqueBoards;
    } catch (error) {
      return [];
    }
  }, []);

  // Dynamic filter options that fetch unique values from database
  const getFilterOptions = useCallback(async () => {
    const allStates = [
      'TAMIL NADU', 'PUDUCHERRY', 'ANDHRA PRADESH', 'ARUNACHAL PRADESH', 'ASSAM', 
      'BIHAR', 'CHHATTISGARH', 'GOA', 'GUJARAT', 'HARYANA', 'HIMACHAL PRADESH', 
      'JHARKHAND', 'KARNATAKA', 'KERALA', 'MADHYA PRADESH', 'MAHARASHTRA', 
      'MANIPUR', 'MEGHALAYA', 'MIZORAM', 'NAGALAND', 'ODISHA', 'PUNJAB', 
      'RAJASTHAN', 'SIKKIM', 'TELANGANA', 'TRIPURA', 'UTTAR PRADESH', 
      'UTTARAKHAND', 'WEST BENGAL', 'ANDAMAN AND NICOBAR ISLANDS', 'CHANDIGARH', 
      'DADRA AND NAGAR HAVELI AND DAMAN AND DIU', 'DELHI', 'JAMMU AND KASHMIR', 
      'LADAKH', 'LAKSHADWEEP'
    ];

    try {
      // Fetch ALL districts without pagination limits
      const { data: districtData, error: districtError } = await supabase
        .from('schools')
        .select('district')
        .not('district', 'is', null)
        .neq('district', '');

      // Extract unique values from database
      const dbDistricts = districtData
        ?.map(item => item.district?.toString().trim().toUpperCase())
        .filter(district => district && district.length > 0) || [];

      // Get all districts from state mapping for fallback
      const allStateDistricts = Object.values({
        'TAMIL NADU': [
          'ARIYALUR', 'CHENGALPATTU', 'CHENNAI', 'COIMBATORE', 'CUDDALORE', 
          'DHARMAPURI', 'DINDIGUL', 'ERODE', 'KALLAKURICHI', 'KANCHEEPURAM', 
          'KANNIYAKUMARI', 'KARUR', 'KRISHNAGIRI', 'MADURAI', 'MAYILADUTHURAI', 
          'NAGAPATTINAM', 'NAMAKKAL', 'THE NILGIRIS', 'PERAMBALUR', 'PUDUKKOTTAI', 
          'RAMANATHAPURAM', 'RANIPET', 'SALEM', 'SIVAGANGAI', 'TENKASI', 'THANJAVUR', 
          'THENI', 'TIRUPATHUR', 'TIRUVALLUR', 'TIRUVARUR', 'THOOTHUKUDI', 
          'TIRUCHIRAPPALLI', 'TIRUNELVELI', 'TIRUPPUR', 'TIRUVANNAMALAI', 
          'VELLORE', 'VILLUPURAM', 'VIRUDHUNAGAR'
        ],
        'PUDUCHERRY': ['PUDUCHERRY', 'KARAIKAL', 'MAHE', 'YANAM']
      }).flat();

      // Combine database results with fallback and remove duplicates
      const uniqueDistricts = [...new Set([...dbDistricts, ...allStateDistricts])].sort();

      // Get active boards
      const uniqueBoards = await getBoardsFromDatabase();

      return { uniqueStates: allStates, uniqueDistricts, uniqueBoards };
    } catch (error) {
      console.error('Error fetching filter options:', error);
      // Return fallback if database query fails
      return { uniqueStates: allStates, uniqueDistricts: [], uniqueBoards: [] };
    }
  }, []);

  useEffect(() => {
    console.log('useSchoolsPaginated: Initial mount, calling fetchSchools with filters:', filters);
    fetchSchools(1, filters);
  }, [fetchSchools]);

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  return {
    schools,
    loading,
    totalCount,
    hasMore,
    currentPage,
    totalPages,
    loadMore,
    goToPage,
    applyFilters,
    refreshSchools,
    createSchool,
    getNextSSNo,
    updateSchool,
    deleteSchool,
    getSchoolById,
    getDashboardMetrics,
    getDashboardMetricsByProject,
    getDashboardMetricsByDate,
    getFilterOptions,
    getDistrictsByState,
    getBoardsFromDatabase
  };
};