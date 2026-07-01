import React from 'react';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Search } from 'lucide-react';
import { formatForDisplay } from '@/utils/dataHelpers';

interface SchoolFiltersProps {
  searchTerm: string;
  setSearchTerm: (term: string) => void;
  statusFilter: string;
  setStatusFilter: (status: string) => void;
  workflowFilter: string;
  setWorkflowFilter: (workflow: string) => void;
  paymentFilter: string;
  setPaymentFilter: (payment: string) => void;
  stateFilter: string;
  setStateFilter: (state: string) => void;
  districtFilter: string;
  setDistrictFilter: (district: string) => void;
  boardFilter: string;
  setBoardFilter: (board: string) => void;
  uniqueStates: string[];
  uniqueDistricts: string[];
  uniqueBoards: string[];
  filteredDistricts: string[];
}

export const SchoolFilters: React.FC<SchoolFiltersProps> = ({
  searchTerm,
  setSearchTerm,
  statusFilter,
  setStatusFilter,
  workflowFilter,
  setWorkflowFilter,
  paymentFilter,
  setPaymentFilter,
  stateFilter,
  setStateFilter,
  districtFilter,
  setDistrictFilter,
  boardFilter,
  setBoardFilter,
  uniqueStates,
  uniqueDistricts,
  uniqueBoards,
  filteredDistricts
}) => {
  return (
    <div className="flex flex-col gap-4 mb-6">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input 
          placeholder="Search by SS No or School Name (prioritized), District, Contact Person, Mobile, Email..." 
          value={searchTerm} 
          onChange={(e) => setSearchTerm(e.target.value)} 
          className="pl-10" 
        />
      </div>
      
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-4">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger>
            <SelectValue placeholder="Registration Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Registration</SelectItem>
            <SelectItem value="Pending">Pending</SelectItem>
            <SelectItem value="Confirmed">Confirmed</SelectItem>
          </SelectContent>
        </Select>

        <Select value={workflowFilter} onValueChange={setWorkflowFilter}>
          <SelectTrigger>
            <SelectValue placeholder="Workflow Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Workflows</SelectItem>
            <SelectItem value="courier_sent">Courier Sent</SelectItem>
            <SelectItem value="courier_returned">Courier Returned</SelectItem>
            <SelectItem value="contacted_yes">Contacted - Yes</SelectItem>
            <SelectItem value="contacted_no">Contacted - No</SelectItem>
            <SelectItem value="registration_interested">Registration - Interested</SelectItem>
            <SelectItem value="registration_not_interested">Registration - Not Interested</SelectItem>
            <SelectItem value="consent_requested">Consent Requested</SelectItem>
            <SelectItem value="brochure_digital_sent">Digital Brochure Sent</SelectItem>
            <SelectItem value="brochure_both_physical_digital">Both Physical & Digital Brochure</SelectItem>
            <SelectItem value="consent_sent_physical">Consent Sent (Physical)</SelectItem>
            <SelectItem value="consent_sent_digital">Consent Sent (Digital)</SelectItem>
            <SelectItem value="consent_sent_total">Consent Sent (All)</SelectItem>
            <SelectItem value="registration_pending">Registration - Pending</SelectItem>
            <SelectItem value="registration_confirmed">Registration - Confirmed</SelectItem>
            <SelectItem value="registration_in_progress">Registration - In Progress</SelectItem>
            <SelectItem value="name_list_received">Name List Received</SelectItem>
            <SelectItem value="name_list_uploaded">Name List Uploaded</SelectItem>
            <SelectItem value="payment_received">Payment Received</SelectItem>
            <SelectItem value="question_paper_sent">Question Paper Sent</SelectItem>
            <SelectItem value="answer_sheet_received">Answer Sheet Received</SelectItem>
            <SelectItem value="result_sent">Result Sent</SelectItem>
          </SelectContent>
        </Select>

        <Select value={paymentFilter} onValueChange={setPaymentFilter}>
          <SelectTrigger>
            <SelectValue placeholder="Payment Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Payments</SelectItem>
            <SelectItem value="Pending">Pending</SelectItem>
            <SelectItem value="Partial">Partial</SelectItem>
            <SelectItem value="Received">Received</SelectItem>
          </SelectContent>
        </Select>

        <Select value={stateFilter} onValueChange={setStateFilter}>
          <SelectTrigger>
            <SelectValue placeholder="Filter by State" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All States</SelectItem>
            {uniqueStates.map(state => (
              <SelectItem key={state} value={state}>{formatForDisplay(state)}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select 
          value={districtFilter} 
          onValueChange={setDistrictFilter}
          disabled={!stateFilter || stateFilter === 'all'}
        >
          <SelectTrigger>
            <SelectValue placeholder={
              !stateFilter || stateFilter === 'all' 
                ? "Select a state first" 
                : "Filter by District"
            } />
          </SelectTrigger>
          <SelectContent className="max-h-[300px] overflow-y-auto">
            {!stateFilter || stateFilter === 'all' ? (
              <SelectItem value="disabled" disabled>Select a state first</SelectItem>
            ) : (
              <>
                <SelectItem value="all">All Districts</SelectItem>
                {filteredDistricts.map(district => (
                  <SelectItem key={district} value={district}>{formatForDisplay(district)}</SelectItem>
                ))}
              </>
            )}
          </SelectContent>
        </Select>

        <Select value={boardFilter} onValueChange={setBoardFilter}>
          <SelectTrigger>
            <SelectValue placeholder="Filter by Board" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Boards</SelectItem>
            {uniqueBoards.map(board => (
              <SelectItem key={board} value={board}>{formatForDisplay(board)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
};