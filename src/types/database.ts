export type Profile = {
  id: string;
  user_id: string;
  username: string;
  full_name?: string;
  email?: string;
  role: 'superadmin' | 'manager' | 'accountant';
  data_access_level?: 'limited' | 'regional' | 'full';
  assigned_districts?: string[];
  permissions?: Record<string, boolean>;
  created_at: string;
  updated_at: string;
};

export type School = {
  id: string;
  ss_no: number;
  school_name: string;
  school_address: string;
  district: string;
  state: string;
  board: string;
  mobile1?: string;
  mobile2?: string;
  email?: string;
  contact_person_name?: string;
  courier_status: 'Sent' | 'Returned';
  contacted: 'Yes' | 'No';
  registration_interest?: 'Interested' | 'Not Interested';
  consent_form_requested: 'Yes' | 'No';
  consent_form_sent?: 'Sent' | 'Sent Digitally' | 'Not Sent';
  registration_status: 'Pending' | 'Confirmed' | 'In Progress';
  name_list_status: 'Pending' | 'Received' | 'Uploaded';
  payment_status: 'Pending' | 'Received' | 'Partial';
  question_paper_sent: 'Sent' | 'Not Sent';
  answer_sheet_status: 'Waiting' | 'Received';
  result_status: 'Sent' | 'Not Sent';
  payment_mode?: string;
  payment_date?: string;
  payment_amount?: number;
  total_participants?: number;
  registration_interest_comment?: string;
  consent_form_comment?: string;
  brochure_delivery_status: 'Physical Only' | 'Digital Sent' | 'Both Physical & Digital';
  pincode: string;
  current_project_id?: string;
  // Enhanced payment tracking fields
  per_entry_rate?: number;
  concession_per_entry?: number;
  effective_rate_per_entry?: number;
  expected_amount?: number;
  payment_received?: number;
  outstanding_balance?: number;
  // Registration fields (populated from portal registration on approval)
  address1?: string;
  address2?: string;
  iplus_coordinator?: string;
  corr_name?: string;
  corr_mobile?: string;
  principal_name?: string;
  principal_mobile?: string;
  coord_mobile?: string;
  teacher_epo?: string;
  teacher_epo_mob?: string;
  teacher_mpo?: string;
  teacher_mpo_mob?: string;
  teacher_spo?: string;
  teacher_spo_mob?: string;
  teacher_gksspo?: string;
  teacher_gksspo_mob?: string;
  teacher_lrpo?: string;
  teacher_lrpo_mob?: string;
  teacher_kidspo?: string;
  teacher_kidspo_mob?: string;
  portal_registered?: boolean;
  created_at: string;
  updated_at: string;
};

export type ConsentForm = {
  id: string;
  school_id: string;
  class: 'LKG' | 'UKG' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8';
  forms_requested: number;
  created_at: string;
  updated_at: string;
};

export type Communication = {
  id: string;
  school_id: string;
  user_id: string;
  communication_type: 'Phone' | 'Email' | 'WhatsApp' | 'AI Call';
  message: string;
  contacted_person_name?: string;
  contacted_mobile_no?: string;
  designation?: string;
  created_at: string;
  direction?: 'inbound' | 'outbound';
  language_used?: string;
  duration_seconds?: number;
  recording_url?: string;
  outcome?: 'interested' | 'callback_requested' | 'registered' | 'not_interested' | 'no_answer' | 'transferred_to_human';
  ai_summary?: string;
  bonvoice_call_id?: string;
};

export type FollowUp = {
  id: string;
  school_id: string;
  follow_up_date: string;
  follow_up_time: string;
  status: 'pending' | 'completed' | 'rescheduled';
  created_by: string;
  created_at: string;
  updated_at: string;
};

export type ActivityLog = {
  id: string;
  school_id: string;
  user_id: string;
  activity_type: 'status_update' | 'communication' | 'consent_form' | 'follow_up' | 'payment';
  field_name?: string;
  old_value?: string;
  new_value?: string;
  description?: string;
  created_at: string;
};

export type WorkflowHistory = {
  id: string;
  school_id: string;
  workflow_stage: string;
  old_status?: string;
  new_status: string;
  changed_by: string;
  changed_at: string;
};

export type WorkflowStage = 
  | 'courier_status'
  | 'contacted'
  | 'registration_interest'
  | 'consent_form_requested'
  | 'consent_form_sent'
  | 'registration_status'
  | 'name_list_status'
  | 'payment_status'
  | 'question_paper_sent'
  | 'answer_sheet_status'
  | 'result_status';

export type DashboardMetrics = {
  total_schools: number;
  courier_sent: number;
  courier_returned: number;
  contacted_yes: number;
  contacted_no: number;
  registration_interested: number;
  registration_not_interested: number;
  consent_requested: number;
  consent_form_sent_total: number;
  consent_form_sent_physical: number;
  consent_form_sent_digital: number;
  registration_confirmed: number;
  registration_in_progress: number;
  name_list_received: number;
  name_list_uploaded: number;
  payment_received: number;
  question_paper_sent: number;
  answer_sheet_received: number;
  result_sent: number;
  total_consent_forms: Record<string, number>;
};

export type DashboardMetricsByDate = {
  total_schools: number;
  courier_sent: number;
  courier_returned: number;
  contacted_yes: number;
  contacted_no: number;
  registration_interested: number;
  registration_not_interested: number;
  consent_requested: number;
  consent_form_sent_total: number;
  consent_form_sent_physical: number;
  consent_form_sent_digital: number;
  registration_confirmed: number;
  name_list_received: number;
  name_list_uploaded: number;
  payment_received: number;
  question_paper_sent: number;
  answer_sheet_received: number;
  result_sent: number;
  communications_count: number;
  follow_ups_created: number;
  follow_ups_completed: number;
};

export interface PaymentRecord {
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