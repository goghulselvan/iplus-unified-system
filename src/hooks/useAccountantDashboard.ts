import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { downloadCSV as downloadCSVFile } from '@/utils/csvExport';

interface AccountantMetrics {
  total_paid_schools: number;
  total_registrations: number;
  total_payment_amount: number;
  total_expected_amount: number;
  total_concessions: number;
  total_outstanding: number;
}

interface PaymentRecord {
  transaction_id: string;
  school_id: string;
  ss_no: number;
  school_name: string;
  district: string;
  state: string;
  payment_date: string;
  payment_amount: number;
  payment_mode: string;
  registration_count: number;
  expected_amount: number;
  total_received: number;
  outstanding_balance: number;
  transaction_reference?: string;
  created_at: string;
}

interface AccountantFilters {
  startDate?: string;
  endDate?: string;
}

export const useAccountantDashboard = () => {
  const [metrics, setMetrics] = useState<AccountantMetrics | null>(null);
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [filteredPayments, setFilteredPayments] = useState<PaymentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<AccountantFilters>({});

  const fetchMetrics = async () => {
    try {
      const { data, error } = await supabase.rpc('get_enhanced_accountant_dashboard_metrics');
      
      if (error) throw error;
      
      if (data && data.length > 0) {
        const result = data[0];
        setMetrics({
          total_paid_schools: Number(result.total_paid_schools) || 0,
          total_registrations: Number(result.total_registrations) || 0,
          total_payment_amount: Number(result.total_payment_amount) || 0,
          total_expected_amount: Number(result.total_expected_amount) || 0,
          total_concessions: Number(result.total_concessions) || 0,
          total_outstanding: Number(result.total_outstanding) || 0,
        });
      }
    } catch (error) {
      console.error('Error fetching enhanced accountant metrics:', error);
      setMetrics({
        total_paid_schools: 0,
        total_registrations: 0,
        total_payment_amount: 0,
        total_expected_amount: 0,
        total_concessions: 0,
        total_outstanding: 0,
      });
    }
  };

  const fetchPayments = async () => {
    try {
      console.log('Fetching payment transactions...');
      const { data, error } = await supabase.rpc('get_payment_transactions_for_accountant');
      
      if (error) {
        console.error('Error fetching payment transactions:', error);
        toast.error('Failed to fetch payment data');
        return;
      }

      console.log('Payment transactions received:', data?.length || 0, 'records');
      console.log('Sample data:', data?.[0]);
      
      // Data is already sorted by payment_date DESC in the RPC function
      setPayments(data || []);
      setFilteredPayments(data || []);
    } catch (error) {
      console.error('Error in fetchPayments:', error);
      toast.error('Failed to fetch payment data');
    }
  };

  const applyFilters = (newFilters: AccountantFilters) => {
    setFilters(newFilters);
    let filtered = [...payments];

    if (newFilters.startDate) {
      filtered = filtered.filter(payment => 
        payment.payment_date && payment.payment_date >= newFilters.startDate!
      );
    }

    if (newFilters.endDate) {
      filtered = filtered.filter(payment => 
        payment.payment_date && payment.payment_date <= newFilters.endDate!
      );
    }

    // Sort by payment_date DESC (already sorted from RPC but re-sort for consistency)
    filtered.sort((a: PaymentRecord, b: PaymentRecord) => 
      new Date(b.payment_date).getTime() - new Date(a.payment_date).getTime()
    );

    setFilteredPayments(filtered);
  };

  const exportToCSV = (data: PaymentRecord[], filename: string = 'payment_data.csv') => {
    const headers = [
      'Serial No',
      'Payment Date',
      'SS No',
      'School Name',
      'No of Registrations',
      'Expected Amount',
      'This Payment',
      'Total Received',
      'Pending Amount',
      'Payment Mode',
      'District',
      'State'
    ];

    const csvData = [
      headers,
      ...data.map((record, index) => [
        index + 1,
        record.payment_date,
        record.ss_no,
        record.school_name,
        record.registration_count,
        record.expected_amount || '',
        record.payment_amount || '',
        record.total_received || '',
        record.outstanding_balance || '',
        record.payment_mode || '',
        record.district,
        record.state
      ])
    ];

    downloadCSVFile(csvData, filename);
  };

  const exportFiltered = () => {
    const filename = `payment_data_${filters.startDate || 'all'}_to_${filters.endDate || 'all'}.csv`;
    exportToCSV(filteredPayments, filename);
  };

  const exportAll = () => {
    exportToCSV(payments, 'all_payment_data.csv');
  };

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      await Promise.all([fetchMetrics(), fetchPayments()]);
      setLoading(false);
    };

    loadData();
  }, []);

  return {
    metrics,
    payments: filteredPayments,
    loading,
    filters,
    applyFilters,
    exportFiltered,
    exportAll,
    refreshData: () => {
      fetchMetrics();
      fetchPayments();
    }
  };
};