import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { Download, Loader2 } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { School } from '@/types/database';
import { supabase } from '@/integrations/supabase/client';
import { toCSV } from '@/utils/csvExport';

interface SchoolFilters {
  search?: string;
  statusFilter?: string;
  workflowFilter?: string;
  stateFilter?: string;
  districtFilter?: string;
  boardFilter?: string;
}
import ExportOTPDialog from './ExportOTPDialog';

interface ExportFilteredSchoolsProps {
  isOpen: boolean;
  onClose: () => void;
  filters: SchoolFilters;
  totalCount: number;
}

export const ExportFilteredSchools: React.FC<ExportFilteredSchoolsProps> = ({
  isOpen,
  onClose,
  filters,
  totalCount
}) => {
  const { profile } = useAuth();
  const { toast } = useToast();
  const [isExporting, setIsExporting] = useState(false);
  const [showOTPDialog, setShowOTPDialog] = useState(false);

  const isSuperAdmin = profile?.role === 'superadmin';

  const handleExport = async () => {
    if (!isSuperAdmin) {
      toast({
        title: 'Access Denied',
        description: 'Only super admins can export school data',
        variant: 'destructive',
      });
      return;
    }

    setShowOTPDialog(true);
  };

  const handleOTPVerified = async () => {
    setShowOTPDialog(false);
    setIsExporting(true);

    try {
      // Build direct Supabase query to fetch all filtered schools
      let query = supabase
        .from('schools')
        .select('*', { count: 'exact' });

      // Apply search filter
      if (filters.search) {
        const searchTerms = filters.search.split(' ').filter(term => term.length > 0);
        
        const orConditions = searchTerms.map(term => {
          const numericTerm = parseInt(term);
          if (!isNaN(numericTerm)) {
            return `ss_no.eq.${numericTerm}`;
          }
          return [
            `school_name.ilike.%${term}%`,
            `district.ilike.%${term}%`,
            `contact_person_name.ilike.%${term}%`,
            `mobile1.ilike.%${term}%`,
            `mobile2.ilike.%${term}%`,
            `email.ilike.%${term}%`
          ].join(',');
        });
        
        query = query.or(orConditions.join(','));
      }

      // Apply status filter
      if (filters.statusFilter && filters.statusFilter !== 'all') {
        if (filters.statusFilter === 'pending') {
          query = query.eq('registration_status', 'Pending');
        } else if (filters.statusFilter === 'confirmed') {
          query = query.eq('registration_status', 'Confirmed');
        } else if (filters.statusFilter === 'in_progress') {
          query = query.eq('registration_status', 'In Progress');
        }
      }

      // Apply workflow filter
      if (filters.workflowFilter && filters.workflowFilter !== 'all') {
        switch (filters.workflowFilter) {
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
          case 'registration_in_progress':
            query = query.eq('registration_status', 'In Progress');
            break;
          case 'consent_requested':
            query = query.eq('consent_form_requested', 'Yes');
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
          case 'result_sent':
            query = query.eq('result_status', 'Sent');
            break;
        }
      }

      // Apply district filter
      if (filters.districtFilter && filters.districtFilter !== 'all') {
        query = query.ilike('district', filters.districtFilter);
      }

      // Apply state filter by filtering districts belonging to that state
      if (filters.stateFilter && filters.stateFilter !== 'all' && !filters.districtFilter) {
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
          'PUDUCHERRY': ['PUDUCHERRY', 'KARAIKAL', 'MAHE', 'YANAM']
        };
        
        const stateDistricts = stateDistrictMap[filters.stateFilter.toUpperCase()] || [];
        if (stateDistricts.length > 0) {
          const districtPattern = stateDistricts.map(d => `district.ilike.%${d}%`).join(',');
          query = query.or(districtPattern);
        } else {
          // State doesn't exist in our data - return no results
          query = query.eq('id', '00000000-0000-0000-0000-000000000000');
        }
      }

      // Apply board filter
      if (filters.boardFilter && filters.boardFilter !== 'all') {
        query = query.ilike('board', filters.boardFilter);
      }

      const { data: schools, error } = await query;

      if (error) {
        throw new Error(error.message);
      }

      if (!schools || schools.length === 0) {
        toast({
          title: 'No Data',
          description: 'No schools found matching the current filters',
          variant: 'destructive',
        });
        return;
      }

      // Create CSV content
      const headers = [
        'SS No',
        'School Name',
        'District',
        'Board',
        'Address',
        'Pincode',
        'Contact Person',
        'Mobile 1',
        'WhatsApp No.',
        'Email',
        'Courier Status',
        'Contacted',
        'Registration Interest',
        'Registration Status',
        'Consent Form Requested',
        'Consent Form Sent',
        'Name List Status',
        'Payment Status',
        'Payment Mode',
        'Payment Date',
        'Payment Amount',
        'Question Paper Sent',
        'Answer Sheet Status',
        'Result Status',
        'Registration Interest Comment',
        'Consent Form Comment',
        'Created At',
        'Updated At'
      ];

      const csvData = schools.map((school: any) => [
        school.ss_no,
        school.school_name,
        school.district,
        school.board,
        school.school_address,
        school.pincode,
        school.contact_person_name || '',
        school.mobile1 || '',
        school.mobile2 || '',
        school.email || '',
        school.courier_status,
        school.contacted,
        school.registration_interest || '',
        school.registration_status,
        school.consent_form_requested,
        school.consent_form_sent || '',
        school.name_list_status,
        school.payment_status,
        school.payment_mode || '',
        school.payment_date || '',
        school.payment_amount || '',
        school.question_paper_sent,
        school.answer_sheet_status,
        school.result_status,
        school.registration_interest_comment || '',
        school.consent_form_comment || '',
        new Date(school.created_at).toLocaleDateString(),
        new Date(school.updated_at).toLocaleDateString()
      ]);

      // Use shared CSV serializer — wraps every cell and escapes internal quotes.
      const csvContent = toCSV([headers, ...csvData]);

      // Create and download the file
      const blob = new Blob([csvContent], { type: 'text/csv' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      
      // Create filename with filter info
      const filterInfo = Object.entries(filters)
        .filter(([_, value]) => value && value !== 'all')
        .map(([key, value]) => `${key}_${value}`)
        .join('_');
      
      const filename = `schools_export${filterInfo ? '_' + filterInfo : ''}_${new Date().toISOString().split('T')[0]}.csv`;
      a.download = filename;
      
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);

      toast({
        title: 'Export Successful',
        description: `Exported ${schools.length} schools to CSV`,
      });

      onClose();
    } catch (error: any) {
      toast({
        title: 'Export Failed',
        description: error.message || 'Failed to export schools',
        variant: 'destructive',
      });
    } finally {
      setIsExporting(false);
    }
  };

  if (!isSuperAdmin) {
    return null;
  }

  return (
    <>
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Export Filtered Schools</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              You are about to export {totalCount} schools that match the current filters as a CSV file.
              This action requires security verification.
            </p>
            <div className="flex justify-end space-x-2">
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button onClick={handleExport} disabled={isExporting}>
                {isExporting ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Download className="h-4 w-4 mr-2" />
                )}
                Export CSV
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <ExportOTPDialog
        isOpen={showOTPDialog}
        onClose={() => setShowOTPDialog(false)}
        onVerified={handleOTPVerified}
      />
    </>
  );
};