import { useState, useMemo, useCallback } from 'react';
import { useDebounce } from './useDebounce';

interface SearchFilters {
  search?: string;
  statusFilter?: string;
  workflowFilter?: string;
  paymentFilter?: string;
  stateFilter?: string;
  districtFilter?: string;
  boardFilter?: string;
}

export const useOptimizedSearch = (onSearch: (filters: SearchFilters) => void) => {
  const [filters, setFilters] = useState<SearchFilters>({});
  const [searchTerm, setSearchTerm] = useState('');
  
  // Debounce search term to reduce API calls
  const debouncedSearchTerm = useDebounce(searchTerm, 1000); // 1000ms for 100+ concurrent users with 60K schools
  
  // Memoized search handler to prevent unnecessary re-renders
  const handleSearch = useCallback((newFilters: SearchFilters) => {
    setFilters(newFilters);
    onSearch(newFilters);
  }, [onSearch]);
  
  // Effect to trigger search when debounced term changes
  useMemo(() => {
    if (debouncedSearchTerm !== filters.search) {
      handleSearch({ ...filters, search: debouncedSearchTerm });
    }
  }, [debouncedSearchTerm, filters, handleSearch]);
  
  const updateSearchTerm = useCallback((term: string) => {
    setSearchTerm(term);
  }, []);
  
  const updateFilter = useCallback((key: keyof SearchFilters, value: string) => {
    const newFilters = { ...filters, [key]: value };
    setFilters(newFilters);
    onSearch(newFilters);
  }, [filters, onSearch]);
  
  return {
    filters,
    searchTerm,
    updateSearchTerm,
    updateFilter,
    handleSearch
  };
};