export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      activity_logs: {
        Row: {
          activity_type: string
          created_at: string | null
          description: string | null
          field_name: string | null
          id: string
          new_value: string | null
          old_value: string | null
          project_id: string | null
          school_id: string
          user_id: string
        }
        Insert: {
          activity_type: string
          created_at?: string | null
          description?: string | null
          field_name?: string | null
          id?: string
          new_value?: string | null
          old_value?: string | null
          project_id?: string | null
          school_id: string
          user_id: string
        }
        Update: {
          activity_type?: string
          created_at?: string | null
          description?: string | null
          field_name?: string | null
          id?: string
          new_value?: string | null
          old_value?: string | null
          project_id?: string | null
          school_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "activity_logs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "olympiad_projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_logs_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      api_keys: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          expires_at: string | null
          id: string
          is_active: boolean
          key_hash: string
          key_prefix: string
          last_used_at: string | null
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          expires_at?: string | null
          id?: string
          is_active?: boolean
          key_hash: string
          key_prefix: string
          last_used_at?: string | null
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          expires_at?: string | null
          id?: string
          is_active?: boolean
          key_hash?: string
          key_prefix?: string
          last_used_at?: string | null
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      api_request_logs: {
        Row: {
          api_key_hash: string
          api_key_id: string | null
          created_at: string
          endpoint: string
          id: string
          ip_address: string | null
          registration_numbers_count: number | null
          response_status: number | null
          response_time_ms: number | null
          user_agent: string | null
        }
        Insert: {
          api_key_hash: string
          api_key_id?: string | null
          created_at?: string
          endpoint: string
          id?: string
          ip_address?: string | null
          registration_numbers_count?: number | null
          response_status?: number | null
          response_time_ms?: number | null
          user_agent?: string | null
        }
        Update: {
          api_key_hash?: string
          api_key_id?: string | null
          created_at?: string
          endpoint?: string
          id?: string
          ip_address?: string | null
          registration_numbers_count?: number | null
          response_status?: number | null
          response_time_ms?: number | null
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "api_request_logs_api_key_id_fkey"
            columns: ["api_key_id"]
            isOneToOne: false
            referencedRelation: "api_keys"
            referencedColumns: ["id"]
          },
        ]
      }
      app_settings: {
        Row: {
          created_at: string
          id: string
          key: string
          updated_at: string
          value: Json
        }
        Insert: {
          created_at?: string
          id?: string
          key: string
          updated_at?: string
          value?: Json
        }
        Update: {
          created_at?: string
          id?: string
          key?: string
          updated_at?: string
          value?: Json
        }
        Relationships: []
      }
      archive_prospect_schools_20261015: {
        Row: {
          additional_contacts: Json | null
          address: string | null
          archived_at: string | null
          block: string | null
          board: string | null
          class_from: number | null
          class_to: number | null
          cluster: string | null
          created_at: string | null
          crm_linked_at: string | null
          district: string | null
          email: string | null
          email_bounced: boolean | null
          email_unsubscribed: boolean | null
          id: string | null
          is_active: boolean | null
          label_printed_at: string | null
          lgd_block: string | null
          linked_to_crm: boolean | null
          mobile: string | null
          not_on_whatsapp: boolean | null
          notes: string | null
          panchayat: string | null
          pincode: string | null
          principal_name: string | null
          school_category: string | null
          school_location: string | null
          school_management: string | null
          school_name: string | null
          school_type: string | null
          source: string | null
          ss_no: number | null
          stage: string | null
          state: string | null
          status: string | null
          udise_code: string | null
          updated_at: string | null
          urban_body: string | null
          village: string | null
          ward: string | null
          website: string | null
          whatsapp: string | null
          whatsapp_opted_out: boolean | null
          whatsapp_verified: boolean | null
        }
        Insert: {
          additional_contacts?: Json | null
          address?: string | null
          archived_at?: string | null
          block?: string | null
          board?: string | null
          class_from?: number | null
          class_to?: number | null
          cluster?: string | null
          created_at?: string | null
          crm_linked_at?: string | null
          district?: string | null
          email?: string | null
          email_bounced?: boolean | null
          email_unsubscribed?: boolean | null
          id?: string | null
          is_active?: boolean | null
          label_printed_at?: string | null
          lgd_block?: string | null
          linked_to_crm?: boolean | null
          mobile?: string | null
          not_on_whatsapp?: boolean | null
          notes?: string | null
          panchayat?: string | null
          pincode?: string | null
          principal_name?: string | null
          school_category?: string | null
          school_location?: string | null
          school_management?: string | null
          school_name?: string | null
          school_type?: string | null
          source?: string | null
          ss_no?: number | null
          stage?: string | null
          state?: string | null
          status?: string | null
          udise_code?: string | null
          updated_at?: string | null
          urban_body?: string | null
          village?: string | null
          ward?: string | null
          website?: string | null
          whatsapp?: string | null
          whatsapp_opted_out?: boolean | null
          whatsapp_verified?: boolean | null
        }
        Update: {
          additional_contacts?: Json | null
          address?: string | null
          archived_at?: string | null
          block?: string | null
          board?: string | null
          class_from?: number | null
          class_to?: number | null
          cluster?: string | null
          created_at?: string | null
          crm_linked_at?: string | null
          district?: string | null
          email?: string | null
          email_bounced?: boolean | null
          email_unsubscribed?: boolean | null
          id?: string | null
          is_active?: boolean | null
          label_printed_at?: string | null
          lgd_block?: string | null
          linked_to_crm?: boolean | null
          mobile?: string | null
          not_on_whatsapp?: boolean | null
          notes?: string | null
          panchayat?: string | null
          pincode?: string | null
          principal_name?: string | null
          school_category?: string | null
          school_location?: string | null
          school_management?: string | null
          school_name?: string | null
          school_type?: string | null
          source?: string | null
          ss_no?: number | null
          stage?: string | null
          state?: string | null
          status?: string | null
          udise_code?: string | null
          updated_at?: string | null
          urban_body?: string | null
          village?: string | null
          ward?: string | null
          website?: string | null
          whatsapp?: string | null
          whatsapp_opted_out?: boolean | null
          whatsapp_verified?: boolean | null
        }
        Relationships: []
      }
      archive_school_portal_accounts_20261015: {
        Row: {
          archived_at: string | null
          id: string | null
          is_active: boolean | null
          linked_at: string | null
          linked_by_ss_no: number | null
          school_id: string | null
          user_id: string | null
        }
        Insert: {
          archived_at?: string | null
          id?: string | null
          is_active?: boolean | null
          linked_at?: string | null
          linked_by_ss_no?: number | null
          school_id?: string | null
          user_id?: string | null
        }
        Update: {
          archived_at?: string | null
          id?: string | null
          is_active?: boolean | null
          linked_at?: string | null
          linked_by_ss_no?: number | null
          school_id?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      archive_school_portal_registrations_20261015: {
        Row: {
          address1: string | null
          address2: string | null
          approved_at: string | null
          approved_by: string | null
          archived_at: string | null
          board: string | null
          city: string | null
          contact_name: string | null
          coord_mobile: string | null
          corr_mobile: string | null
          corr_name: string | null
          created_at: string | null
          district: string | null
          email: string | null
          id: string | null
          matched_school_id: string | null
          phone: string | null
          pincode: string | null
          principal_mobile: string | null
          principal_name: string | null
          project_id: string | null
          rejection_reason: string | null
          school_name: string | null
          ss_no: number | null
          state: string | null
          status: string | null
          teacher_epo: string | null
          teacher_epo_mob: string | null
          teacher_gksspo: string | null
          teacher_gksspo_mob: string | null
          teacher_kidspo: string | null
          teacher_kidspo_mob: string | null
          teacher_lrpo: string | null
          teacher_lrpo_mob: string | null
          teacher_mpo: string | null
          teacher_mpo_mob: string | null
          teacher_spo: string | null
          teacher_spo_mob: string | null
          updated_at: string | null
          user_id: string | null
          welcome_email_sent_at: string | null
          welcome_whatsapp_sent_at: string | null
        }
        Insert: {
          address1?: string | null
          address2?: string | null
          approved_at?: string | null
          approved_by?: string | null
          archived_at?: string | null
          board?: string | null
          city?: string | null
          contact_name?: string | null
          coord_mobile?: string | null
          corr_mobile?: string | null
          corr_name?: string | null
          created_at?: string | null
          district?: string | null
          email?: string | null
          id?: string | null
          matched_school_id?: string | null
          phone?: string | null
          pincode?: string | null
          principal_mobile?: string | null
          principal_name?: string | null
          project_id?: string | null
          rejection_reason?: string | null
          school_name?: string | null
          ss_no?: number | null
          state?: string | null
          status?: string | null
          teacher_epo?: string | null
          teacher_epo_mob?: string | null
          teacher_gksspo?: string | null
          teacher_gksspo_mob?: string | null
          teacher_kidspo?: string | null
          teacher_kidspo_mob?: string | null
          teacher_lrpo?: string | null
          teacher_lrpo_mob?: string | null
          teacher_mpo?: string | null
          teacher_mpo_mob?: string | null
          teacher_spo?: string | null
          teacher_spo_mob?: string | null
          updated_at?: string | null
          user_id?: string | null
          welcome_email_sent_at?: string | null
          welcome_whatsapp_sent_at?: string | null
        }
        Update: {
          address1?: string | null
          address2?: string | null
          approved_at?: string | null
          approved_by?: string | null
          archived_at?: string | null
          board?: string | null
          city?: string | null
          contact_name?: string | null
          coord_mobile?: string | null
          corr_mobile?: string | null
          corr_name?: string | null
          created_at?: string | null
          district?: string | null
          email?: string | null
          id?: string | null
          matched_school_id?: string | null
          phone?: string | null
          pincode?: string | null
          principal_mobile?: string | null
          principal_name?: string | null
          project_id?: string | null
          rejection_reason?: string | null
          school_name?: string | null
          ss_no?: number | null
          state?: string | null
          status?: string | null
          teacher_epo?: string | null
          teacher_epo_mob?: string | null
          teacher_gksspo?: string | null
          teacher_gksspo_mob?: string | null
          teacher_kidspo?: string | null
          teacher_kidspo_mob?: string | null
          teacher_lrpo?: string | null
          teacher_lrpo_mob?: string | null
          teacher_mpo?: string | null
          teacher_mpo_mob?: string | null
          teacher_spo?: string | null
          teacher_spo_mob?: string | null
          updated_at?: string | null
          user_id?: string | null
          welcome_email_sent_at?: string | null
          welcome_whatsapp_sent_at?: string | null
        }
        Relationships: []
      }
      archive_schools_20261015: {
        Row: {
          additional_contacts: Json | null
          address1: string | null
          address2: string | null
          answer_sheet_status:
            | Database["public"]["Enums"]["answer_sheet_status"]
            | null
          archived_at: string | null
          board: string | null
          brochure_delivery_status:
            | Database["public"]["Enums"]["brochure_delivery_status"]
            | null
          concession_per_entry: number | null
          confirmed_participants: number | null
          consent_form_comment: string | null
          consent_form_requested:
            | Database["public"]["Enums"]["consent_status"]
            | null
          consent_form_sent: string | null
          contact_person_name: string | null
          contacted: Database["public"]["Enums"]["contacted_status"] | null
          coord_mobile: string | null
          corr_mobile: string | null
          corr_name: string | null
          courier_dispatched_at: string | null
          courier_name: string | null
          courier_status: Database["public"]["Enums"]["courier_status"] | null
          courier_tracking_no: string | null
          created_at: string | null
          current_project_id: string | null
          district: string | null
          effective_rate_per_entry: number | null
          email: string | null
          expected_amount: number | null
          id: string | null
          iplus_coordinator: string | null
          mobile1: string | null
          mobile2: string | null
          name: string | null
          name_list_status:
            | Database["public"]["Enums"]["name_list_status"]
            | null
          outstanding_balance: number | null
          payment_amount: number | null
          payment_date: string | null
          payment_mode: string | null
          payment_received: number | null
          payment_status: Database["public"]["Enums"]["payment_status"] | null
          per_entry_rate: number | null
          pincode: string | null
          portal_registered: boolean | null
          principal_mobile: string | null
          principal_name: string | null
          prospect_school_id: string | null
          question_paper_sent:
            | Database["public"]["Enums"]["question_paper_status"]
            | null
          registration_interest:
            | Database["public"]["Enums"]["interest_status"]
            | null
          registration_interest_comment: string | null
          registration_status:
            | Database["public"]["Enums"]["registration_status"]
            | null
          result_status: Database["public"]["Enums"]["result_status"] | null
          school_address: string | null
          school_name: string | null
          ss_no: number | null
          state: string | null
          teacher_epo: string | null
          teacher_epo_mob: string | null
          teacher_gksspo: string | null
          teacher_gksspo_mob: string | null
          teacher_kidspo: string | null
          teacher_kidspo_mob: string | null
          teacher_lrpo: string | null
          teacher_lrpo_mob: string | null
          teacher_mpo: string | null
          teacher_mpo_mob: string | null
          teacher_spo: string | null
          teacher_spo_mob: string | null
          total_participants: number | null
          updated_at: string | null
        }
        Insert: {
          additional_contacts?: Json | null
          address1?: string | null
          address2?: string | null
          answer_sheet_status?:
            | Database["public"]["Enums"]["answer_sheet_status"]
            | null
          archived_at?: string | null
          board?: string | null
          brochure_delivery_status?:
            | Database["public"]["Enums"]["brochure_delivery_status"]
            | null
          concession_per_entry?: number | null
          confirmed_participants?: number | null
          consent_form_comment?: string | null
          consent_form_requested?:
            | Database["public"]["Enums"]["consent_status"]
            | null
          consent_form_sent?: string | null
          contact_person_name?: string | null
          contacted?: Database["public"]["Enums"]["contacted_status"] | null
          coord_mobile?: string | null
          corr_mobile?: string | null
          corr_name?: string | null
          courier_dispatched_at?: string | null
          courier_name?: string | null
          courier_status?: Database["public"]["Enums"]["courier_status"] | null
          courier_tracking_no?: string | null
          created_at?: string | null
          current_project_id?: string | null
          district?: string | null
          effective_rate_per_entry?: number | null
          email?: string | null
          expected_amount?: number | null
          id?: string | null
          iplus_coordinator?: string | null
          mobile1?: string | null
          mobile2?: string | null
          name?: string | null
          name_list_status?:
            | Database["public"]["Enums"]["name_list_status"]
            | null
          outstanding_balance?: number | null
          payment_amount?: number | null
          payment_date?: string | null
          payment_mode?: string | null
          payment_received?: number | null
          payment_status?: Database["public"]["Enums"]["payment_status"] | null
          per_entry_rate?: number | null
          pincode?: string | null
          portal_registered?: boolean | null
          principal_mobile?: string | null
          principal_name?: string | null
          prospect_school_id?: string | null
          question_paper_sent?:
            | Database["public"]["Enums"]["question_paper_status"]
            | null
          registration_interest?:
            | Database["public"]["Enums"]["interest_status"]
            | null
          registration_interest_comment?: string | null
          registration_status?:
            | Database["public"]["Enums"]["registration_status"]
            | null
          result_status?: Database["public"]["Enums"]["result_status"] | null
          school_address?: string | null
          school_name?: string | null
          ss_no?: number | null
          state?: string | null
          teacher_epo?: string | null
          teacher_epo_mob?: string | null
          teacher_gksspo?: string | null
          teacher_gksspo_mob?: string | null
          teacher_kidspo?: string | null
          teacher_kidspo_mob?: string | null
          teacher_lrpo?: string | null
          teacher_lrpo_mob?: string | null
          teacher_mpo?: string | null
          teacher_mpo_mob?: string | null
          teacher_spo?: string | null
          teacher_spo_mob?: string | null
          total_participants?: number | null
          updated_at?: string | null
        }
        Update: {
          additional_contacts?: Json | null
          address1?: string | null
          address2?: string | null
          answer_sheet_status?:
            | Database["public"]["Enums"]["answer_sheet_status"]
            | null
          archived_at?: string | null
          board?: string | null
          brochure_delivery_status?:
            | Database["public"]["Enums"]["brochure_delivery_status"]
            | null
          concession_per_entry?: number | null
          confirmed_participants?: number | null
          consent_form_comment?: string | null
          consent_form_requested?:
            | Database["public"]["Enums"]["consent_status"]
            | null
          consent_form_sent?: string | null
          contact_person_name?: string | null
          contacted?: Database["public"]["Enums"]["contacted_status"] | null
          coord_mobile?: string | null
          corr_mobile?: string | null
          corr_name?: string | null
          courier_dispatched_at?: string | null
          courier_name?: string | null
          courier_status?: Database["public"]["Enums"]["courier_status"] | null
          courier_tracking_no?: string | null
          created_at?: string | null
          current_project_id?: string | null
          district?: string | null
          effective_rate_per_entry?: number | null
          email?: string | null
          expected_amount?: number | null
          id?: string | null
          iplus_coordinator?: string | null
          mobile1?: string | null
          mobile2?: string | null
          name?: string | null
          name_list_status?:
            | Database["public"]["Enums"]["name_list_status"]
            | null
          outstanding_balance?: number | null
          payment_amount?: number | null
          payment_date?: string | null
          payment_mode?: string | null
          payment_received?: number | null
          payment_status?: Database["public"]["Enums"]["payment_status"] | null
          per_entry_rate?: number | null
          pincode?: string | null
          portal_registered?: boolean | null
          principal_mobile?: string | null
          principal_name?: string | null
          prospect_school_id?: string | null
          question_paper_sent?:
            | Database["public"]["Enums"]["question_paper_status"]
            | null
          registration_interest?:
            | Database["public"]["Enums"]["interest_status"]
            | null
          registration_interest_comment?: string | null
          registration_status?:
            | Database["public"]["Enums"]["registration_status"]
            | null
          result_status?: Database["public"]["Enums"]["result_status"] | null
          school_address?: string | null
          school_name?: string | null
          ss_no?: number | null
          state?: string | null
          teacher_epo?: string | null
          teacher_epo_mob?: string | null
          teacher_gksspo?: string | null
          teacher_gksspo_mob?: string | null
          teacher_kidspo?: string | null
          teacher_kidspo_mob?: string | null
          teacher_lrpo?: string | null
          teacher_lrpo_mob?: string | null
          teacher_mpo?: string | null
          teacher_mpo_mob?: string | null
          teacher_spo?: string | null
          teacher_spo_mob?: string | null
          total_participants?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      archived_student_registrations: {
        Row: {
          archive_reason: string | null
          archive_type: string
          archived_at: string | null
          archived_by: string | null
          class_code: number | null
          id: string
          original_created_at: string | null
          original_created_by: string | null
          original_id: string
          project_id: string
          registration_number: string | null
          registration_number_generated: string | null
          replacement_registration_id: string | null
          roll_number: string | null
          school_id: string
          student_class: string
          student_name: string
        }
        Insert: {
          archive_reason?: string | null
          archive_type: string
          archived_at?: string | null
          archived_by?: string | null
          class_code?: number | null
          id?: string
          original_created_at?: string | null
          original_created_by?: string | null
          original_id: string
          project_id: string
          registration_number?: string | null
          registration_number_generated?: string | null
          replacement_registration_id?: string | null
          roll_number?: string | null
          school_id: string
          student_class: string
          student_name: string
        }
        Update: {
          archive_reason?: string | null
          archive_type?: string
          archived_at?: string | null
          archived_by?: string | null
          class_code?: number | null
          id?: string
          original_created_at?: string | null
          original_created_by?: string | null
          original_id?: string
          project_id?: string
          registration_number?: string | null
          registration_number_generated?: string | null
          replacement_registration_id?: string | null
          roll_number?: string | null
          school_id?: string
          student_class?: string
          student_name?: string
        }
        Relationships: []
      }
      archived_student_subjects: {
        Row: {
          archived_registration_id: string
          created_at: string | null
          id: string
          original_subject_id: string | null
          subject_code: string | null
          subject_name: string | null
        }
        Insert: {
          archived_registration_id: string
          created_at?: string | null
          id?: string
          original_subject_id?: string | null
          subject_code?: string | null
          subject_name?: string | null
        }
        Update: {
          archived_registration_id?: string
          created_at?: string | null
          id?: string
          original_subject_id?: string | null
          subject_code?: string | null
          subject_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "archived_student_subjects_archived_registration_id_fkey"
            columns: ["archived_registration_id"]
            isOneToOne: false
            referencedRelation: "archived_student_registrations"
            referencedColumns: ["id"]
          },
        ]
      }
      boards: {
        Row: {
          board_code: string | null
          board_name: string
          created_at: string
          created_by: string
          id: string
          is_active: boolean
          updated_at: string
        }
        Insert: {
          board_code?: string | null
          board_name: string
          created_at?: string
          created_by: string
          id?: string
          is_active?: boolean
          updated_at?: string
        }
        Update: {
          board_code?: string | null
          board_name?: string
          created_at?: string
          created_by?: string
          id?: string
          is_active?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      bonvoice_call_logs: {
        Row: {
          agent_status: string | null
          ai_summary: string | null
          bonvoice_status: string | null
          call_duration: number | null
          call_id: string | null
          call_mode: string | null
          commented_at: string | null
          commented_by: string | null
          created_at: string | null
          created_by: string | null
          direction: string | null
          disposition: string | null
          dtmf: string | null
          end_time: string | null
          event_id: string | null
          id: string
          language_used: string | null
          outcome: string | null
          prospect_school_id: string | null
          resource_url: string | null
          school_id: string | null
          school_phone: string | null
          speech_content: string | null
          staff_comment: string | null
          staff_phone: string | null
          start_time: string | null
          status: string | null
          transcript: string | null
          transfer_reason: string | null
        }
        Insert: {
          agent_status?: string | null
          ai_summary?: string | null
          bonvoice_status?: string | null
          call_duration?: number | null
          call_id?: string | null
          call_mode?: string | null
          commented_at?: string | null
          commented_by?: string | null
          created_at?: string | null
          created_by?: string | null
          direction?: string | null
          disposition?: string | null
          dtmf?: string | null
          end_time?: string | null
          event_id?: string | null
          id?: string
          language_used?: string | null
          outcome?: string | null
          prospect_school_id?: string | null
          resource_url?: string | null
          school_id?: string | null
          school_phone?: string | null
          speech_content?: string | null
          staff_comment?: string | null
          staff_phone?: string | null
          start_time?: string | null
          status?: string | null
          transcript?: string | null
          transfer_reason?: string | null
        }
        Update: {
          agent_status?: string | null
          ai_summary?: string | null
          bonvoice_status?: string | null
          call_duration?: number | null
          call_id?: string | null
          call_mode?: string | null
          commented_at?: string | null
          commented_by?: string | null
          created_at?: string | null
          created_by?: string | null
          direction?: string | null
          disposition?: string | null
          dtmf?: string | null
          end_time?: string | null
          event_id?: string | null
          id?: string
          language_used?: string | null
          outcome?: string | null
          prospect_school_id?: string | null
          resource_url?: string | null
          school_id?: string | null
          school_phone?: string | null
          speech_content?: string | null
          staff_comment?: string | null
          staff_phone?: string | null
          start_time?: string | null
          status?: string | null
          transcript?: string | null
          transfer_reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bonvoice_call_logs_prospect_school_id_fkey"
            columns: ["prospect_school_id"]
            isOneToOne: false
            referencedRelation: "prospect_schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bonvoice_call_logs_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      brand_assets: {
        Row: {
          asset_name: string
          asset_type: string
          asset_value: string | null
          created_at: string | null
          description: string | null
          file_format: string | null
          height: number | null
          id: string
          is_active: boolean | null
          storage_url: string | null
          updated_at: string | null
          version: string | null
          width: number | null
        }
        Insert: {
          asset_name: string
          asset_type: string
          asset_value?: string | null
          created_at?: string | null
          description?: string | null
          file_format?: string | null
          height?: number | null
          id?: string
          is_active?: boolean | null
          storage_url?: string | null
          updated_at?: string | null
          version?: string | null
          width?: number | null
        }
        Update: {
          asset_name?: string
          asset_type?: string
          asset_value?: string | null
          created_at?: string | null
          description?: string | null
          file_format?: string | null
          height?: number | null
          id?: string
          is_active?: boolean | null
          storage_url?: string | null
          updated_at?: string | null
          version?: string | null
          width?: number | null
        }
        Relationships: []
      }
      call_campaign_assignments: {
        Row: {
          assigned_to: string | null
          attempts: number
          callback_at: string | null
          created_at: string
          district: string | null
          id: string
          last_called_at: string | null
          notes: string | null
          project_id: string | null
          prospect_school_id: string
          registrations_committed: number
          status: string
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          attempts?: number
          callback_at?: string | null
          created_at?: string
          district?: string | null
          id?: string
          last_called_at?: string | null
          notes?: string | null
          project_id?: string | null
          prospect_school_id: string
          registrations_committed?: number
          status?: string
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          attempts?: number
          callback_at?: string | null
          created_at?: string
          district?: string | null
          id?: string
          last_called_at?: string | null
          notes?: string | null
          project_id?: string | null
          prospect_school_id?: string
          registrations_committed?: number
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "call_campaign_assignments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "olympiad_projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "call_campaign_assignments_prospect_school_id_fkey"
            columns: ["prospect_school_id"]
            isOneToOne: false
            referencedRelation: "prospect_schools"
            referencedColumns: ["id"]
          },
        ]
      }
      call_campaign_log: {
        Row: {
          assignment_id: string | null
          callback_at: string | null
          called_at: string
          called_by: string | null
          id: string
          notes: string | null
          outcome: string
          project_id: string | null
          prospect_school_id: string | null
          reached_dm: string | null
          registrations_committed: number
        }
        Insert: {
          assignment_id?: string | null
          callback_at?: string | null
          called_at?: string
          called_by?: string | null
          id?: string
          notes?: string | null
          outcome: string
          project_id?: string | null
          prospect_school_id?: string | null
          reached_dm?: string | null
          registrations_committed?: number
        }
        Update: {
          assignment_id?: string | null
          callback_at?: string | null
          called_at?: string
          called_by?: string | null
          id?: string
          notes?: string | null
          outcome?: string
          project_id?: string | null
          prospect_school_id?: string | null
          reached_dm?: string | null
          registrations_committed?: number
        }
        Relationships: [
          {
            foreignKeyName: "call_campaign_log_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "call_campaign_assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "call_campaign_log_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "olympiad_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      call_followups: {
        Row: {
          assigned_to: string | null
          created_at: string
          id: string
          phone_last10: string
          prospect_school_id: string | null
          resolution: string | null
          resolution_note: string | null
          resolved_at: string | null
          resolved_by: string | null
          school_id: string | null
          snoozed_until: string | null
          state: string
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          created_at?: string
          id?: string
          phone_last10: string
          prospect_school_id?: string | null
          resolution?: string | null
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          school_id?: string | null
          snoozed_until?: string | null
          state?: string
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          created_at?: string
          id?: string
          phone_last10?: string
          prospect_school_id?: string | null
          resolution?: string | null
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          school_id?: string | null
          snoozed_until?: string | null
          state?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "call_followups_prospect_school_id_fkey"
            columns: ["prospect_school_id"]
            isOneToOne: false
            referencedRelation: "prospect_schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "call_followups_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_audiences: {
        Row: {
          created_at: string | null
          created_by: string | null
          description: string | null
          filters: Json
          id: string
          name: string
          school_count: number | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          filters?: Json
          id?: string
          name: string
          school_count?: number | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          filters?: Json
          id?: string
          name?: string
          school_count?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "campaign_audiences_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_schools: {
        Row: {
          campaign_id: string
          click_count: number | null
          clicked_at: string | null
          created_at: string | null
          delivered_at: string | null
          delivery_status: string | null
          error_message: string | null
          id: string
          message_id: string | null
          opened_at: string | null
          prospect_school_id: string
          sent_at: string | null
          status: string
          unsubscribed_at: string | null
          wamid: string | null
        }
        Insert: {
          campaign_id: string
          click_count?: number | null
          clicked_at?: string | null
          created_at?: string | null
          delivered_at?: string | null
          delivery_status?: string | null
          error_message?: string | null
          id?: string
          message_id?: string | null
          opened_at?: string | null
          prospect_school_id: string
          sent_at?: string | null
          status?: string
          unsubscribed_at?: string | null
          wamid?: string | null
        }
        Update: {
          campaign_id?: string
          click_count?: number | null
          clicked_at?: string | null
          created_at?: string | null
          delivered_at?: string | null
          delivery_status?: string | null
          error_message?: string | null
          id?: string
          message_id?: string | null
          opened_at?: string | null
          prospect_school_id?: string
          sent_at?: string | null
          status?: string
          unsubscribed_at?: string | null
          wamid?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "campaign_schools_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_schools_prospect_school_id_fkey"
            columns: ["prospect_school_id"]
            isOneToOne: false
            referencedRelation: "prospect_schools"
            referencedColumns: ["id"]
          },
        ]
      }
      campaigns: {
        Row: {
          audience_count: number | null
          audience_filters: Json | null
          bounced_count: number | null
          channel: string
          clicked_count: number
          completed_at: string | null
          created_at: string | null
          created_by: string | null
          delivered_count: number | null
          description: string | null
          email_body: string | null
          email_from: string | null
          email_subject: string | null
          email_template_id: string | null
          failed_count: number | null
          id: string
          name: string
          opened_count: number | null
          paused_reason: string | null
          project_id: string | null
          scheduled_at: string | null
          seed_enabled: boolean
          send_mode: string
          send_plan: Json | null
          send_start_date: string | null
          sent_count: number | null
          started_at: string | null
          status: string
          target_count: number | null
          test_sent_at: string | null
          test_sent_to: string | null
          updated_at: string | null
          whatsapp_template_id: string | null
          whatsapp_template_name: string | null
        }
        Insert: {
          audience_count?: number | null
          audience_filters?: Json | null
          bounced_count?: number | null
          channel: string
          clicked_count?: number
          completed_at?: string | null
          created_at?: string | null
          created_by?: string | null
          delivered_count?: number | null
          description?: string | null
          email_body?: string | null
          email_from?: string | null
          email_subject?: string | null
          email_template_id?: string | null
          failed_count?: number | null
          id?: string
          name: string
          opened_count?: number | null
          paused_reason?: string | null
          project_id?: string | null
          scheduled_at?: string | null
          seed_enabled?: boolean
          send_mode?: string
          send_plan?: Json | null
          send_start_date?: string | null
          sent_count?: number | null
          started_at?: string | null
          status?: string
          target_count?: number | null
          test_sent_at?: string | null
          test_sent_to?: string | null
          updated_at?: string | null
          whatsapp_template_id?: string | null
          whatsapp_template_name?: string | null
        }
        Update: {
          audience_count?: number | null
          audience_filters?: Json | null
          bounced_count?: number | null
          channel?: string
          clicked_count?: number
          completed_at?: string | null
          created_at?: string | null
          created_by?: string | null
          delivered_count?: number | null
          description?: string | null
          email_body?: string | null
          email_from?: string | null
          email_subject?: string | null
          email_template_id?: string | null
          failed_count?: number | null
          id?: string
          name?: string
          opened_count?: number | null
          paused_reason?: string | null
          project_id?: string | null
          scheduled_at?: string | null
          seed_enabled?: boolean
          send_mode?: string
          send_plan?: Json | null
          send_start_date?: string | null
          sent_count?: number | null
          started_at?: string | null
          status?: string
          target_count?: number | null
          test_sent_at?: string | null
          test_sent_to?: string | null
          updated_at?: string | null
          whatsapp_template_id?: string | null
          whatsapp_template_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "campaigns_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaigns_email_template_id_fkey"
            columns: ["email_template_id"]
            isOneToOne: false
            referencedRelation: "email_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaigns_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "olympiad_projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaigns_whatsapp_template_id_fkey"
            columns: ["whatsapp_template_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      certificate_templates: {
        Row: {
          certificate_content: string | null
          created_at: string
          id: string
          name: string
          orientation: string
          paper_height_mm: number | null
          paper_size: string
          paper_width_mm: number | null
          text_elements: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          certificate_content?: string | null
          created_at?: string
          id?: string
          name: string
          orientation?: string
          paper_height_mm?: number | null
          paper_size?: string
          paper_width_mm?: number | null
          text_elements?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          certificate_content?: string | null
          created_at?: string
          id?: string
          name?: string
          orientation?: string
          paper_height_mm?: number | null
          paper_size?: string
          paper_width_mm?: number | null
          text_elements?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      classes: {
        Row: {
          code: string
          display_name: string
          question_count: number
        }
        Insert: {
          code: string
          display_name: string
          question_count: number
        }
        Update: {
          code?: string
          display_name?: string
          question_count?: number
        }
        Relationships: []
      }
      communication_templates: {
        Row: {
          attachment_filename: string | null
          attachment_url: string | null
          created_at: string
          created_by: string
          email_body: string
          id: string
          is_active: boolean
          parent_template_id: string | null
          project_id: string | null
          subject: string
          template_category: string
          template_name: string
          template_type: string
          updated_at: string
          whatsapp_message: string | null
        }
        Insert: {
          attachment_filename?: string | null
          attachment_url?: string | null
          created_at?: string
          created_by: string
          email_body: string
          id?: string
          is_active?: boolean
          parent_template_id?: string | null
          project_id?: string | null
          subject: string
          template_category?: string
          template_name: string
          template_type: string
          updated_at?: string
          whatsapp_message?: string | null
        }
        Update: {
          attachment_filename?: string | null
          attachment_url?: string | null
          created_at?: string
          created_by?: string
          email_body?: string
          id?: string
          is_active?: boolean
          parent_template_id?: string | null
          project_id?: string | null
          subject?: string
          template_category?: string
          template_name?: string
          template_type?: string
          updated_at?: string
          whatsapp_message?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "communication_templates_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "olympiad_projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_comm_tmpl_parent"
            columns: ["parent_template_id"]
            isOneToOne: false
            referencedRelation: "communication_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      communications: {
        Row: {
          ai_summary: string | null
          bonvoice_call_id: string | null
          communication_type: Database["public"]["Enums"]["communication_type"]
          contacted_mobile_no: string | null
          contacted_person_name: string | null
          created_at: string
          delivery_status: string | null
          designation: string | null
          direction: string | null
          duration_seconds: number | null
          email_status: string | null
          id: string
          language_used: string | null
          message: string
          outcome: string | null
          project_id: string
          recording_url: string | null
          school_id: string
          staff_note: string | null
          template_type: string | null
          user_id: string
          wamid: string | null
        }
        Insert: {
          ai_summary?: string | null
          bonvoice_call_id?: string | null
          communication_type: Database["public"]["Enums"]["communication_type"]
          contacted_mobile_no?: string | null
          contacted_person_name?: string | null
          created_at?: string
          delivery_status?: string | null
          designation?: string | null
          direction?: string | null
          duration_seconds?: number | null
          email_status?: string | null
          id?: string
          language_used?: string | null
          message: string
          outcome?: string | null
          project_id: string
          recording_url?: string | null
          school_id: string
          staff_note?: string | null
          template_type?: string | null
          user_id: string
          wamid?: string | null
        }
        Update: {
          ai_summary?: string | null
          bonvoice_call_id?: string | null
          communication_type?: Database["public"]["Enums"]["communication_type"]
          contacted_mobile_no?: string | null
          contacted_person_name?: string | null
          created_at?: string
          delivery_status?: string | null
          designation?: string | null
          direction?: string | null
          duration_seconds?: number | null
          email_status?: string | null
          id?: string
          language_used?: string | null
          message?: string
          outcome?: string | null
          project_id?: string
          recording_url?: string | null
          school_id?: string
          staff_note?: string | null
          template_type?: string | null
          user_id?: string
          wamid?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "communications_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "olympiad_projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "communications_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "communications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      consent_forms: {
        Row: {
          created_at: string
          forms_requested: number
          id: string
          project_id: string
          school_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          forms_requested?: number
          id?: string
          project_id: string
          school_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          forms_requested?: number
          id?: string
          project_id?: string
          school_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "consent_forms_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      credit_note_applications: {
        Row: {
          amount: number
          application_type: string
          applied_to_invoice_id: string | null
          credit_note_id: string
          id: string
          note: string | null
          recorded_at: string
          recorded_by: string
          refund_mode: string | null
          refund_reference: string | null
        }
        Insert: {
          amount: number
          application_type: string
          applied_to_invoice_id?: string | null
          credit_note_id: string
          id?: string
          note?: string | null
          recorded_at?: string
          recorded_by: string
          refund_mode?: string | null
          refund_reference?: string | null
        }
        Update: {
          amount?: number
          application_type?: string
          applied_to_invoice_id?: string | null
          credit_note_id?: string
          id?: string
          note?: string | null
          recorded_at?: string
          recorded_by?: string
          refund_mode?: string | null
          refund_reference?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "credit_note_applications_applied_to_invoice_id_fkey"
            columns: ["applied_to_invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_note_applications_credit_note_id_fkey"
            columns: ["credit_note_id"]
            isOneToOne: false
            referencedRelation: "credit_notes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_note_applications_credit_note_id_fkey"
            columns: ["credit_note_id"]
            isOneToOne: false
            referencedRelation: "credit_notes_with_balance"
            referencedColumns: ["id"]
          },
        ]
      }
      credit_note_fy_counters: {
        Row: {
          fy: number
          last_no: number
        }
        Insert: {
          fy: number
          last_no?: number
        }
        Update: {
          fy?: number
          last_no?: number
        }
        Relationships: []
      }
      credit_notes: {
        Row: {
          amount: number
          created_at: string
          created_by: string
          credit_note_number: number | null
          fy: number | null
          id: string
          note: string | null
          payment_date: string | null
          payment_mode: string | null
          payment_reference: string | null
          payment_screenshot_url: string | null
          school_id: string
          source: string
          source_order_id: string | null
          source_return_id: string | null
        }
        Insert: {
          amount: number
          created_at?: string
          created_by: string
          credit_note_number?: number | null
          fy?: number | null
          id?: string
          note?: string | null
          payment_date?: string | null
          payment_mode?: string | null
          payment_reference?: string | null
          payment_screenshot_url?: string | null
          school_id: string
          source?: string
          source_order_id?: string | null
          source_return_id?: string | null
        }
        Update: {
          amount?: number
          created_at?: string
          created_by?: string
          credit_note_number?: number | null
          fy?: number | null
          id?: string
          note?: string | null
          payment_date?: string | null
          payment_mode?: string | null
          payment_reference?: string | null
          payment_screenshot_url?: string | null
          school_id?: string
          source?: string
          source_order_id?: string | null
          source_return_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "credit_notes_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_notes_source_order_id_fkey"
            columns: ["source_order_id"]
            isOneToOne: false
            referencedRelation: "product_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_notes_source_return_id_fkey"
            columns: ["source_return_id"]
            isOneToOne: false
            referencedRelation: "product_returns"
            referencedColumns: ["id"]
          },
        ]
      }
      csrf_tokens: {
        Row: {
          created_at: string
          expires_at: string
          id: string
          token: string
          user_id: string
        }
        Insert: {
          created_at?: string
          expires_at: string
          id?: string
          token: string
          user_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          id?: string
          token?: string
          user_id?: string
        }
        Relationships: []
      }
      data_export_approvals: {
        Row: {
          approved_at: string | null
          approving_user_id: string
          data_sensitivity_level: string | null
          expires_at: string | null
          export_reason: string
          id: string
          record_count: number | null
          requesting_user_id: string
          table_name: string
          used: boolean | null
          used_at: string | null
        }
        Insert: {
          approved_at?: string | null
          approving_user_id: string
          data_sensitivity_level?: string | null
          expires_at?: string | null
          export_reason: string
          id?: string
          record_count?: number | null
          requesting_user_id: string
          table_name: string
          used?: boolean | null
          used_at?: string | null
        }
        Update: {
          approved_at?: string | null
          approving_user_id?: string
          data_sensitivity_level?: string | null
          expires_at?: string | null
          export_reason?: string
          id?: string
          record_count?: number | null
          requesting_user_id?: string
          table_name?: string
          used?: boolean | null
          used_at?: string | null
        }
        Relationships: []
      }
      database_backups: {
        Row: {
          backup_type: string
          created_at: string
          created_by: string
          file_size: number | null
          filename: string
          id: string
          status: string
          storage_path: string
        }
        Insert: {
          backup_type?: string
          created_at?: string
          created_by: string
          file_size?: number | null
          filename: string
          id?: string
          status?: string
          storage_path: string
        }
        Update: {
          backup_type?: string
          created_at?: string
          created_by?: string
          file_size?: number | null
          filename?: string
          id?: string
          status?: string
          storage_path?: string
        }
        Relationships: []
      }
      deleted_payments: {
        Row: {
          amount: number
          deleted_at: string
          deleted_by: string | null
          deletion_reason: string | null
          id: string
          notes: string | null
          original_id: string
          payment_date: string | null
          payment_mode: string | null
          reference: string | null
          school_id: string
          screenshot_url: string | null
          source_table: string
        }
        Insert: {
          amount: number
          deleted_at?: string
          deleted_by?: string | null
          deletion_reason?: string | null
          id?: string
          notes?: string | null
          original_id: string
          payment_date?: string | null
          payment_mode?: string | null
          reference?: string | null
          school_id: string
          screenshot_url?: string | null
          source_table: string
        }
        Update: {
          amount?: number
          deleted_at?: string
          deleted_by?: string | null
          deletion_reason?: string | null
          id?: string
          notes?: string | null
          original_id?: string
          payment_date?: string | null
          payment_mode?: string | null
          reference?: string | null
          school_id?: string
          screenshot_url?: string | null
          source_table?: string
        }
        Relationships: [
          {
            foreignKeyName: "deleted_payments_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      district_codes: {
        Row: {
          created_at: string
          district_code: string
          district_name: string
          id: string
          is_active: boolean
          state_code: string
        }
        Insert: {
          created_at?: string
          district_code: string
          district_name: string
          id?: string
          is_active?: boolean
          state_code: string
        }
        Update: {
          created_at?: string
          district_code?: string
          district_name?: string
          id?: string
          is_active?: boolean
          state_code?: string
        }
        Relationships: [
          {
            foreignKeyName: "district_codes_state_code_fkey"
            columns: ["state_code"]
            isOneToOne: false
            referencedRelation: "state_codes"
            referencedColumns: ["state_code"]
          },
        ]
      }
      email_jobs: {
        Row: {
          completed_steps: number
          created_at: string
          created_by: string | null
          current_step: string | null
          email_body_html: string | null
          error_message: string | null
          generation_state: Json | null
          id: string
          processed_at: string | null
          recipient_email: string
          school_id: string
          school_name: string
          selected_attachments: Json
          ss_no: string
          status: string
          total_steps: number
          updated_at: string
        }
        Insert: {
          completed_steps?: number
          created_at?: string
          created_by?: string | null
          current_step?: string | null
          email_body_html?: string | null
          error_message?: string | null
          generation_state?: Json | null
          id?: string
          processed_at?: string | null
          recipient_email: string
          school_id: string
          school_name: string
          selected_attachments?: Json
          ss_no: string
          status?: string
          total_steps?: number
          updated_at?: string
        }
        Update: {
          completed_steps?: number
          created_at?: string
          created_by?: string | null
          current_step?: string | null
          email_body_html?: string | null
          error_message?: string | null
          generation_state?: Json | null
          id?: string
          processed_at?: string | null
          recipient_email?: string
          school_id?: string
          school_name?: string
          selected_attachments?: Json
          ss_no?: string
          status?: string
          total_steps?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_jobs_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      email_suppressions: {
        Row: {
          campaign_id: string | null
          created_at: string | null
          email: string
          id: string
          reason: string
        }
        Insert: {
          campaign_id?: string | null
          created_at?: string | null
          email: string
          id?: string
          reason: string
        }
        Update: {
          campaign_id?: string | null
          created_at?: string | null
          email?: string
          id?: string
          reason?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_suppressions_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      email_templates: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          body_html: string
          body_text: string | null
          category: string
          created_at: string | null
          created_by: string | null
          description: string | null
          id: string
          name: string
          rejection_reason: string | null
          status: string
          subject: string
          updated_at: string | null
          variables: string[] | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          body_html: string
          body_text?: string | null
          category?: string
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string
          name: string
          rejection_reason?: string | null
          status?: string
          subject: string
          updated_at?: string | null
          variables?: string[] | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          body_html?: string
          body_text?: string | null
          category?: string
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string
          name?: string
          rejection_reason?: string | null
          status?: string
          subject?: string
          updated_at?: string | null
          variables?: string[] | null
        }
        Relationships: [
          {
            foreignKeyName: "email_templates_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_templates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      exam_schedules: {
        Row: {
          created_at: string
          created_by: string
          exam_date: string
          id: string
          notes: string | null
          project_id: string | null
          school_id: string
          subjects: string[]
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          exam_date: string
          id?: string
          notes?: string | null
          project_id?: string | null
          school_id: string
          subjects: string[]
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          exam_date?: string
          id?: string
          notes?: string | null
          project_id?: string | null
          school_id?: string
          subjects?: string[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "exam_schedules_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "olympiad_projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exam_schedules_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      exam_slot_template_subjects: {
        Row: {
          created_at: string
          exam_date: string
          id: string
          session: string | null
          sort_order: number
          subject_code: string
          template_id: string
        }
        Insert: {
          created_at?: string
          exam_date: string
          id?: string
          session?: string | null
          sort_order?: number
          subject_code: string
          template_id: string
        }
        Update: {
          created_at?: string
          exam_date?: string
          id?: string
          session?: string | null
          sort_order?: number
          subject_code?: string
          template_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "exam_slot_template_subjects_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "exam_slot_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      exam_slot_templates: {
        Row: {
          booking_deadline: string | null
          created_at: string
          id: string
          is_active: boolean
          project_id: string
          slot_name: string
          updated_at: string
        }
        Insert: {
          booking_deadline?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          project_id: string
          slot_name: string
          updated_at?: string
        }
        Update: {
          booking_deadline?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          project_id?: string
          slot_name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "exam_slot_templates_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "olympiad_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      exam_slots: {
        Row: {
          confirmed: boolean
          created_at: string
          id: string
          mode: string
          notes: string | null
          project_id: string
          school_id: string
          slot_date: string | null
          slot_template_id: string | null
          slot_time: string | null
          updated_at: string
        }
        Insert: {
          confirmed?: boolean
          created_at?: string
          id?: string
          mode?: string
          notes?: string | null
          project_id: string
          school_id: string
          slot_date?: string | null
          slot_template_id?: string | null
          slot_time?: string | null
          updated_at?: string
        }
        Update: {
          confirmed?: boolean
          created_at?: string
          id?: string
          mode?: string
          notes?: string | null
          project_id?: string
          school_id?: string
          slot_date?: string | null
          slot_template_id?: string | null
          slot_time?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "exam_slots_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "olympiad_projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exam_slots_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exam_slots_slot_template_id_fkey"
            columns: ["slot_template_id"]
            isOneToOne: false
            referencedRelation: "exam_slot_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      export_otps: {
        Row: {
          created_at: string
          email: string
          expires_at: string
          id: string
          otp_code: string
          used: boolean
          user_id: string
        }
        Insert: {
          created_at?: string
          email: string
          expires_at: string
          id?: string
          otp_code: string
          used?: boolean
          user_id: string
        }
        Update: {
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          otp_code?: string
          used?: boolean
          user_id?: string
        }
        Relationships: []
      }
      follow_ups: {
        Row: {
          assigned_to: string | null
          created_at: string | null
          created_by: string
          follow_up_date: string
          follow_up_time: string
          follow_up_type: string | null
          id: string
          notes: string | null
          project_id: string
          school_id: string
          status: string | null
          updated_at: string | null
        }
        Insert: {
          assigned_to?: string | null
          created_at?: string | null
          created_by: string
          follow_up_date: string
          follow_up_time: string
          follow_up_type?: string | null
          id?: string
          notes?: string | null
          project_id: string
          school_id: string
          status?: string | null
          updated_at?: string | null
        }
        Update: {
          assigned_to?: string | null
          created_at?: string | null
          created_by?: string
          follow_up_date?: string
          follow_up_time?: string
          follow_up_type?: string | null
          id?: string
          notes?: string | null
          project_id?: string
          school_id?: string
          status?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "follow_ups_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "olympiad_projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "follow_ups_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_grn: {
        Row: {
          created_at: string
          grn_number: number
          id: string
          notes: string | null
          purchase_order_id: string
          received_by: string | null
          received_date: string
        }
        Insert: {
          created_at?: string
          grn_number?: never
          id?: string
          notes?: string | null
          purchase_order_id: string
          received_by?: string | null
          received_date?: string
        }
        Update: {
          created_at?: string
          grn_number?: never
          id?: string
          notes?: string | null
          purchase_order_id?: string
          received_by?: string | null
          received_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_grn_purchase_order_id_fkey"
            columns: ["purchase_order_id"]
            isOneToOne: false
            referencedRelation: "inventory_purchase_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_grn_items: {
        Row: {
          grn_id: string
          id: string
          po_item_id: string
          quantity_received: number
        }
        Insert: {
          grn_id: string
          id?: string
          po_item_id: string
          quantity_received: number
        }
        Update: {
          grn_id?: string
          id?: string
          po_item_id?: string
          quantity_received?: number
        }
        Relationships: [
          {
            foreignKeyName: "inventory_grn_items_grn_id_fkey"
            columns: ["grn_id"]
            isOneToOne: false
            referencedRelation: "inventory_grn"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_grn_items_po_item_id_fkey"
            columns: ["po_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_po_items"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_item_issues: {
        Row: {
          created_at: string
          id: string
          issue_date: string
          issued_by: string | null
          issued_to_name: string
          issued_to_type: string
          notes: string | null
          product_id: string
          quantity: number
        }
        Insert: {
          created_at?: string
          id?: string
          issue_date?: string
          issued_by?: string | null
          issued_to_name: string
          issued_to_type: string
          notes?: string | null
          product_id: string
          quantity: number
        }
        Update: {
          created_at?: string
          id?: string
          issue_date?: string
          issued_by?: string | null
          issued_to_name?: string
          issued_to_type?: string
          notes?: string | null
          product_id?: string
          quantity?: number
        }
        Relationships: [
          {
            foreignKeyName: "inventory_item_issues_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_po_items: {
        Row: {
          id: string
          product_id: string
          purchase_order_id: string
          quantity_ordered: number
          row_order: number
          unit_cost: number
        }
        Insert: {
          id?: string
          product_id: string
          purchase_order_id: string
          quantity_ordered: number
          row_order: number
          unit_cost: number
        }
        Update: {
          id?: string
          product_id?: string
          purchase_order_id?: string
          quantity_ordered?: number
          row_order?: number
          unit_cost?: number
        }
        Relationships: [
          {
            foreignKeyName: "inventory_po_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_po_items_purchase_order_id_fkey"
            columns: ["purchase_order_id"]
            isOneToOne: false
            referencedRelation: "inventory_purchase_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_purchase_orders: {
        Row: {
          created_at: string
          created_by: string | null
          expected_date: string | null
          id: string
          notes: string | null
          order_date: string
          po_number: number
          status: string
          supplier_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          expected_date?: string | null
          id?: string
          notes?: string | null
          order_date?: string
          po_number?: never
          status?: string
          supplier_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          expected_date?: string | null
          id?: string
          notes?: string | null
          order_date?: string
          po_number?: never
          status?: string
          supplier_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_purchase_orders_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "inventory_suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_stock_adds: {
        Row: {
          added_by: string | null
          added_date: string
          created_at: string
          id: string
          product_id: string
          quantity: number
          reason: string
        }
        Insert: {
          added_by?: string | null
          added_date?: string
          created_at?: string
          id?: string
          product_id: string
          quantity: number
          reason: string
        }
        Update: {
          added_by?: string | null
          added_date?: string
          created_at?: string
          id?: string
          product_id?: string
          quantity?: number
          reason?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_stock_adds_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_stock_adjustments: {
        Row: {
          adjusted_by: string | null
          adjusted_date: string
          created_at: string
          id: string
          product_id: string
          quantity_delta: number
          reason: string
        }
        Insert: {
          adjusted_by?: string | null
          adjusted_date?: string
          created_at?: string
          id?: string
          product_id: string
          quantity_delta: number
          reason: string
        }
        Update: {
          adjusted_by?: string | null
          adjusted_date?: string
          created_at?: string
          id?: string
          product_id?: string
          quantity_delta?: number
          reason?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_stock_adjustments_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_supplier_payments: {
        Row: {
          amount: number
          created_at: string
          created_by: string | null
          id: string
          notes: string | null
          payment_date: string
          payment_mode: string
          reference: string | null
          supplier_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          payment_date?: string
          payment_mode: string
          reference?: string | null
          supplier_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          payment_date?: string
          payment_mode?: string
          reference?: string | null
          supplier_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_supplier_payments_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "inventory_suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_suppliers: {
        Row: {
          address: string | null
          contact_person: string | null
          created_at: string
          email: string | null
          gstin: string | null
          id: string
          is_active: boolean
          name: string
          phone: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          contact_person?: string | null
          created_at?: string
          email?: string | null
          gstin?: string | null
          id?: string
          is_active?: boolean
          name: string
          phone?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          contact_person?: string | null
          created_at?: string
          email?: string | null
          gstin?: string | null
          id?: string
          is_active?: boolean
          name?: string
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      invoice_fy_counters: {
        Row: {
          fy: number
          last_no: number
        }
        Insert: {
          fy: number
          last_no?: number
        }
        Update: {
          fy?: number
          last_no?: number
        }
        Relationships: []
      }
      invoice_line_items: {
        Row: {
          gst_rate: number
          hsn_code: string | null
          id: string
          invoice_id: string
          item_name: string
          line_total: number
          product_id: string | null
          quantity: number
          row_order: number
          unit_price: number
        }
        Insert: {
          gst_rate: number
          hsn_code?: string | null
          id?: string
          invoice_id: string
          item_name: string
          line_total: number
          product_id?: string | null
          quantity: number
          row_order: number
          unit_price: number
        }
        Update: {
          gst_rate?: number
          hsn_code?: string | null
          id?: string
          invoice_id?: string
          item_name?: string
          line_total?: number
          product_id?: string | null
          quantity?: number
          row_order?: number
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "invoice_line_items_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_line_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          buyer_address: string | null
          buyer_gstin: string | null
          buyer_name: string
          buyer_state: string
          cgst_amount: number
          created_at: string
          created_by: string | null
          dispatched_at: string | null
          fy: number | null
          grand_total: number
          id: string
          igst_amount: number
          invoice_number: number | null
          paid_at: string | null
          payment_method: string
          prospect_school_id: string | null
          school_id: string | null
          sgst_amount: number
          status: string
          subtotal: number
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
        }
        Insert: {
          buyer_address?: string | null
          buyer_gstin?: string | null
          buyer_name: string
          buyer_state: string
          cgst_amount?: number
          created_at?: string
          created_by?: string | null
          dispatched_at?: string | null
          fy?: number | null
          grand_total?: number
          id?: string
          igst_amount?: number
          invoice_number?: number | null
          paid_at?: string | null
          payment_method: string
          prospect_school_id?: string | null
          school_id?: string | null
          sgst_amount?: number
          status?: string
          subtotal?: number
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Update: {
          buyer_address?: string | null
          buyer_gstin?: string | null
          buyer_name?: string
          buyer_state?: string
          cgst_amount?: number
          created_at?: string
          created_by?: string | null
          dispatched_at?: string | null
          fy?: number | null
          grand_total?: number
          id?: string
          igst_amount?: number
          invoice_number?: number | null
          paid_at?: string | null
          payment_method?: string
          prospect_school_id?: string | null
          school_id?: string | null
          sgst_amount?: number
          status?: string
          subtotal?: number
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoices_prospect_school_id_fkey"
            columns: ["prospect_school_id"]
            isOneToOne: false
            referencedRelation: "prospect_schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      module_permissions: {
        Row: {
          created_at: string
          granted_by: string | null
          has_access: boolean
          id: string
          module_name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          granted_by?: string | null
          has_access?: boolean
          id?: string
          module_name: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          granted_by?: string | null
          has_access?: boolean
          id?: string
          module_name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      olympiad_interest: {
        Row: {
          contact_name: string | null
          contact_phone: string | null
          converted_at: string | null
          created_at: string
          district: string | null
          for_year: number
          id: number
          note: string | null
          prospect_school_id: string | null
          school_email: string
          school_id: string | null
          school_mobile: string | null
          school_name: string
          source: string
          state: string | null
          updated_at: string
        }
        Insert: {
          contact_name?: string | null
          contact_phone?: string | null
          converted_at?: string | null
          created_at?: string
          district?: string | null
          for_year: number
          id?: never
          note?: string | null
          prospect_school_id?: string | null
          school_email: string
          school_id?: string | null
          school_mobile?: string | null
          school_name: string
          source?: string
          state?: string | null
          updated_at?: string
        }
        Update: {
          contact_name?: string | null
          contact_phone?: string | null
          converted_at?: string | null
          created_at?: string
          district?: string | null
          for_year?: number
          id?: never
          note?: string | null
          prospect_school_id?: string | null
          school_email?: string
          school_id?: string | null
          school_mobile?: string | null
          school_name?: string
          source?: string
          state?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "olympiad_interest_prospect_school_id_fkey"
            columns: ["prospect_school_id"]
            isOneToOne: false
            referencedRelation: "prospect_schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "olympiad_interest_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      olympiad_projects: {
        Row: {
          brochure_url: string | null
          consent_form_url: string | null
          created_at: string
          created_by: string
          id: string
          is_active: boolean
          project_name: string
          project_year: number
          registration_deadline: string | null
          updated_at: string
        }
        Insert: {
          brochure_url?: string | null
          consent_form_url?: string | null
          created_at?: string
          created_by: string
          id?: string
          is_active?: boolean
          project_name: string
          project_year: number
          registration_deadline?: string | null
          updated_at?: string
        }
        Update: {
          brochure_url?: string | null
          consent_form_url?: string | null
          created_at?: string
          created_by?: string
          id?: string
          is_active?: boolean
          project_name?: string
          project_year?: number
          registration_deadline?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      olympiad_source_link: {
        Row: {
          created_at: string
          crm_registration_id: string | null
          crm_school_id: string | null
          id: string
          last_synced_at: string
          link_type: string
          source_registration_number: string | null
          source_school_id: string | null
          source_ss_no: string | null
          source_student_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          crm_registration_id?: string | null
          crm_school_id?: string | null
          id?: string
          last_synced_at?: string
          link_type: string
          source_registration_number?: string | null
          source_school_id?: string | null
          source_ss_no?: string | null
          source_student_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          crm_registration_id?: string | null
          crm_school_id?: string | null
          id?: string
          last_synced_at?: string
          link_type?: string
          source_registration_number?: string | null
          source_school_id?: string | null
          source_ss_no?: string | null
          source_student_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "olympiad_source_link_crm_registration_id_fkey"
            columns: ["crm_registration_id"]
            isOneToOne: false
            referencedRelation: "student_registrations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "olympiad_source_link_crm_school_id_fkey"
            columns: ["crm_school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      olympiad_subjects: {
        Row: {
          alphabetical_code: string | null
          applicable_classes: string[]
          created_at: string
          id: string
          is_active: boolean
          project_id: string
          subject_code: string
          subject_name: string
          updated_at: string
        }
        Insert: {
          alphabetical_code?: string | null
          applicable_classes: string[]
          created_at?: string
          id?: string
          is_active?: boolean
          project_id: string
          subject_code: string
          subject_name: string
          updated_at?: string
        }
        Update: {
          alphabetical_code?: string | null
          applicable_classes?: string[]
          created_at?: string
          id?: string
          is_active?: boolean
          project_id?: string
          subject_code?: string
          subject_name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "olympiad_subjects_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "olympiad_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      other_contacts: {
        Row: {
          category: string
          created_at: string
          created_by: string | null
          id: string
          name: string
          notes: string | null
          phone_last10: string
          updated_at: string
        }
        Insert: {
          category: string
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          notes?: string | null
          phone_last10: string
          updated_at?: string
        }
        Update: {
          category?: string
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          notes?: string | null
          phone_last10?: string
          updated_at?: string
        }
        Relationships: []
      }
      otp_verifications: {
        Row: {
          created_at: string | null
          email: string
          expires_at: string
          id: string
          otp: string
          purpose: string
          verified: boolean | null
        }
        Insert: {
          created_at?: string | null
          email: string
          expires_at?: string
          id?: string
          otp: string
          purpose?: string
          verified?: boolean | null
        }
        Update: {
          created_at?: string | null
          email?: string
          expires_at?: string
          id?: string
          otp?: string
          purpose?: string
          verified?: boolean | null
        }
        Relationships: []
      }
      payment_proofs: {
        Row: {
          file_name: string | null
          file_url: string
          id: string
          notes: string | null
          project_id: string
          school_id: string
          status: string
          uploaded_at: string
          verified_at: string | null
          verified_by: string | null
        }
        Insert: {
          file_name?: string | null
          file_url: string
          id?: string
          notes?: string | null
          project_id: string
          school_id: string
          status?: string
          uploaded_at?: string
          verified_at?: string | null
          verified_by?: string | null
        }
        Update: {
          file_name?: string | null
          file_url?: string
          id?: string
          notes?: string | null
          project_id?: string
          school_id?: string
          status?: string
          uploaded_at?: string
          verified_at?: string | null
          verified_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_proofs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "olympiad_projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_proofs_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_transactions: {
        Row: {
          created_at: string
          created_by: string
          id: string
          notes: string | null
          payment_amount: number
          payment_date: string
          payment_mode: string
          project_id: string | null
          school_id: string
          transaction_reference: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          notes?: string | null
          payment_amount: number
          payment_date: string
          payment_mode?: string
          project_id?: string | null
          school_id: string
          transaction_reference?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          notes?: string | null
          payment_amount?: number
          payment_date?: string
          payment_mode?: string
          project_id?: string | null
          school_id?: string
          transaction_reference?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_transactions_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      portal_payment_submissions: {
        Row: {
          account_holder_name: string | null
          acknowledged_at: string | null
          acknowledged_by: string | null
          amount_paid: number
          created_at: string
          id: string
          notes: string | null
          payment_date: string
          payment_mode: string
          project_id: string
          school_id: string
          screenshot_url: string | null
          status: string
          utr_reference: string | null
          verified_amount: number | null
        }
        Insert: {
          account_holder_name?: string | null
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          amount_paid: number
          created_at?: string
          id?: string
          notes?: string | null
          payment_date: string
          payment_mode?: string
          project_id: string
          school_id: string
          screenshot_url?: string | null
          status?: string
          utr_reference?: string | null
          verified_amount?: number | null
        }
        Update: {
          account_holder_name?: string | null
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          amount_paid?: number
          created_at?: string
          id?: string
          notes?: string | null
          payment_date?: string
          payment_mode?: string
          project_id?: string
          school_id?: string
          screenshot_url?: string | null
          status?: string
          utr_reference?: string | null
          verified_amount?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "portal_payment_submissions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "olympiad_projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portal_payment_submissions_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      portal_registered_students: {
        Row: {
          class_code: string
          created_at: string
          id: string
          project_id: string
          school_id: string | null
          student_name: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          class_code: string
          created_at?: string
          id?: string
          project_id: string
          school_id?: string | null
          student_name: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          class_code?: string
          created_at?: string
          id?: string
          project_id?: string
          school_id?: string | null
          student_name?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "portal_registered_students_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "olympiad_projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portal_registered_students_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      portal_registration_counts: {
        Row: {
          count: number
          id: string
          olympiad_code: string
          project_id: string
          school_id: string
          updated_at: string
        }
        Insert: {
          count?: number
          id?: string
          olympiad_code: string
          project_id: string
          school_id: string
          updated_at?: string
        }
        Update: {
          count?: number
          id?: string
          olympiad_code?: string
          project_id?: string
          school_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      portal_student_enrollments: {
        Row: {
          created_at: string
          id: string
          is_confirmed: boolean
          olympiad_code: string
          project_id: string | null
          registration_number: string | null
          school_id: string | null
          student_id: string
          submitted_at: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          is_confirmed?: boolean
          olympiad_code: string
          project_id?: string | null
          registration_number?: string | null
          school_id?: string | null
          student_id: string
          submitted_at?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          is_confirmed?: boolean
          olympiad_code?: string
          project_id?: string | null
          registration_number?: string | null
          school_id?: string | null
          student_id?: string
          submitted_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "portal_student_enrollments_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "portal_registered_students"
            referencedColumns: ["id"]
          },
        ]
      }
      product_categories: {
        Row: {
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      product_order_fy_counters: {
        Row: {
          fy: number
          last_no: number
        }
        Insert: {
          fy: number
          last_no?: number
        }
        Update: {
          fy?: number
          last_no?: number
        }
        Relationships: []
      }
      product_order_items: {
        Row: {
          created_at: string
          id: string
          invoice_id: string | null
          line_status: string
          order_id: string
          product_id: string
          quantity: number
          rejected_at: string | null
          rejected_by: string | null
          rejected_reason: string | null
          unit_price: number
        }
        Insert: {
          created_at?: string
          id?: string
          invoice_id?: string | null
          line_status?: string
          order_id: string
          product_id: string
          quantity: number
          rejected_at?: string | null
          rejected_by?: string | null
          rejected_reason?: string | null
          unit_price: number
        }
        Update: {
          created_at?: string
          id?: string
          invoice_id?: string | null
          line_status?: string
          order_id?: string
          product_id?: string
          quantity?: number
          rejected_at?: string | null
          rejected_by?: string | null
          rejected_reason?: string | null
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "product_order_items_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "product_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_orders: {
        Row: {
          applied_credit_amount: number | null
          applied_credit_note_id: string | null
          confirmed_at: string | null
          created_at: string
          created_by: string | null
          credit_applied_to_invoice: boolean
          fy: number | null
          id: string
          notes: string | null
          order_number: number | null
          payment_account_holder_name: string | null
          payment_amount: number
          payment_date: string
          payment_mode: string
          payment_review_note: string | null
          payment_reviewed_at: string | null
          payment_reviewed_by: string | null
          payment_screenshot_url: string | null
          payment_status: string
          payment_utr_reference: string | null
          school_id: string
          source: string
          verified_amount: number | null
        }
        Insert: {
          applied_credit_amount?: number | null
          applied_credit_note_id?: string | null
          confirmed_at?: string | null
          created_at?: string
          created_by?: string | null
          credit_applied_to_invoice?: boolean
          fy?: number | null
          id?: string
          notes?: string | null
          order_number?: number | null
          payment_account_holder_name?: string | null
          payment_amount: number
          payment_date: string
          payment_mode: string
          payment_review_note?: string | null
          payment_reviewed_at?: string | null
          payment_reviewed_by?: string | null
          payment_screenshot_url?: string | null
          payment_status?: string
          payment_utr_reference?: string | null
          school_id: string
          source?: string
          verified_amount?: number | null
        }
        Update: {
          applied_credit_amount?: number | null
          applied_credit_note_id?: string | null
          confirmed_at?: string | null
          created_at?: string
          created_by?: string | null
          credit_applied_to_invoice?: boolean
          fy?: number | null
          id?: string
          notes?: string | null
          order_number?: number | null
          payment_account_holder_name?: string | null
          payment_amount?: number
          payment_date?: string
          payment_mode?: string
          payment_review_note?: string | null
          payment_reviewed_at?: string | null
          payment_reviewed_by?: string | null
          payment_screenshot_url?: string | null
          payment_status?: string
          payment_utr_reference?: string | null
          school_id?: string
          source?: string
          verified_amount?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "product_orders_applied_credit_note_id_fkey"
            columns: ["applied_credit_note_id"]
            isOneToOne: false
            referencedRelation: "credit_notes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_orders_applied_credit_note_id_fkey"
            columns: ["applied_credit_note_id"]
            isOneToOne: false
            referencedRelation: "credit_notes_with_balance"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_orders_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      product_returns: {
        Row: {
          actual_product_id: string | null
          condition_on_receipt: string | null
          id: string
          invoice_line_item_id: string
          quantity: number
          reason_category: string
          reason_note: string | null
          received_at: string | null
          received_by: string | null
          replacement_order_reference: string | null
          replacement_sent_at: string | null
          replacement_sent_by: string | null
          requested_at: string
          requested_by: string
          status: string
        }
        Insert: {
          actual_product_id?: string | null
          condition_on_receipt?: string | null
          id?: string
          invoice_line_item_id: string
          quantity: number
          reason_category: string
          reason_note?: string | null
          received_at?: string | null
          received_by?: string | null
          replacement_order_reference?: string | null
          replacement_sent_at?: string | null
          replacement_sent_by?: string | null
          requested_at?: string
          requested_by: string
          status?: string
        }
        Update: {
          actual_product_id?: string | null
          condition_on_receipt?: string | null
          id?: string
          invoice_line_item_id?: string
          quantity?: number
          reason_category?: string
          reason_note?: string | null
          received_at?: string | null
          received_by?: string | null
          replacement_order_reference?: string | null
          replacement_sent_at?: string | null
          replacement_sent_by?: string | null
          requested_at?: string
          requested_by?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_returns_actual_product_id_fkey"
            columns: ["actual_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_returns_invoice_line_item_id_fkey"
            columns: ["invoice_line_item_id"]
            isOneToOne: false
            referencedRelation: "invoice_line_items"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          barcode: string | null
          category_id: string | null
          class_number: number | null
          created_at: string
          expected_restock_date: string | null
          expiry_date: string | null
          gst_rate: number
          hsn_code: string | null
          id: string
          image_url: string | null
          is_active: boolean
          item_type: string
          location: string | null
          minimum_stock_level: number
          name: string
          series: string | null
          sku: string | null
          stock_quantity: number
          subject: string | null
          unit: string
          unit_price: number
          updated_at: string
        }
        Insert: {
          barcode?: string | null
          category_id?: string | null
          class_number?: number | null
          created_at?: string
          expected_restock_date?: string | null
          expiry_date?: string | null
          gst_rate: number
          hsn_code?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean
          item_type?: string
          location?: string | null
          minimum_stock_level?: number
          name: string
          series?: string | null
          sku?: string | null
          stock_quantity?: number
          subject?: string | null
          unit?: string
          unit_price: number
          updated_at?: string
        }
        Update: {
          barcode?: string | null
          category_id?: string | null
          class_number?: number | null
          created_at?: string
          expected_restock_date?: string | null
          expiry_date?: string | null
          gst_rate?: number
          hsn_code?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean
          item_type?: string
          location?: string | null
          minimum_stock_level?: number
          name?: string
          series?: string | null
          sku?: string | null
          stock_quantity?: number
          subject?: string | null
          unit?: string
          unit_price?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "products_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "product_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          assigned_districts: string[] | null
          created_at: string
          data_access_level: string | null
          email: string | null
          full_name: string | null
          id: string
          permissions: Json | null
          role: Database["public"]["Enums"]["user_role"]
          updated_at: string
          user_id: string
          username: string
        }
        Insert: {
          assigned_districts?: string[] | null
          created_at?: string
          data_access_level?: string | null
          email?: string | null
          full_name?: string | null
          id?: string
          permissions?: Json | null
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
          user_id: string
          username: string
        }
        Update: {
          assigned_districts?: string[] | null
          created_at?: string
          data_access_level?: string | null
          email?: string | null
          full_name?: string | null
          id?: string
          permissions?: Json | null
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
          user_id?: string
          username?: string
        }
        Relationships: []
      }
      prospect_schools: {
        Row: {
          additional_contacts: Json
          address: string | null
          block: string | null
          board: string | null
          class_from: number | null
          class_to: number | null
          cluster: string | null
          created_at: string | null
          crm_linked_at: string | null
          district: string | null
          email: string | null
          email_bounced: boolean | null
          email_unsubscribed: boolean | null
          id: string
          is_active: boolean | null
          label_printed_at: string | null
          lgd_block: string | null
          linked_to_crm: boolean | null
          mobile: string | null
          not_on_whatsapp: boolean | null
          notes: string | null
          panchayat: string | null
          pincode: string | null
          principal_name: string | null
          school_category: string | null
          school_location: string | null
          school_management: string | null
          school_name: string
          school_type: string | null
          source: string | null
          ss_no: number
          stage: string | null
          state: string | null
          status: string | null
          udise_code: string | null
          updated_at: string | null
          urban_body: string | null
          village: string | null
          ward: string | null
          website: string | null
          whatsapp: string | null
          whatsapp_opted_out: boolean | null
          whatsapp_verified: boolean | null
        }
        Insert: {
          additional_contacts?: Json
          address?: string | null
          block?: string | null
          board?: string | null
          class_from?: number | null
          class_to?: number | null
          cluster?: string | null
          created_at?: string | null
          crm_linked_at?: string | null
          district?: string | null
          email?: string | null
          email_bounced?: boolean | null
          email_unsubscribed?: boolean | null
          id?: string
          is_active?: boolean | null
          label_printed_at?: string | null
          lgd_block?: string | null
          linked_to_crm?: boolean | null
          mobile?: string | null
          not_on_whatsapp?: boolean | null
          notes?: string | null
          panchayat?: string | null
          pincode?: string | null
          principal_name?: string | null
          school_category?: string | null
          school_location?: string | null
          school_management?: string | null
          school_name: string
          school_type?: string | null
          source?: string | null
          ss_no?: number
          stage?: string | null
          state?: string | null
          status?: string | null
          udise_code?: string | null
          updated_at?: string | null
          urban_body?: string | null
          village?: string | null
          ward?: string | null
          website?: string | null
          whatsapp?: string | null
          whatsapp_opted_out?: boolean | null
          whatsapp_verified?: boolean | null
        }
        Update: {
          additional_contacts?: Json
          address?: string | null
          block?: string | null
          board?: string | null
          class_from?: number | null
          class_to?: number | null
          cluster?: string | null
          created_at?: string | null
          crm_linked_at?: string | null
          district?: string | null
          email?: string | null
          email_bounced?: boolean | null
          email_unsubscribed?: boolean | null
          id?: string
          is_active?: boolean | null
          label_printed_at?: string | null
          lgd_block?: string | null
          linked_to_crm?: boolean | null
          mobile?: string | null
          not_on_whatsapp?: boolean | null
          notes?: string | null
          panchayat?: string | null
          pincode?: string | null
          principal_name?: string | null
          school_category?: string | null
          school_location?: string | null
          school_management?: string | null
          school_name?: string
          school_type?: string | null
          source?: string | null
          ss_no?: number
          stage?: string | null
          state?: string | null
          status?: string | null
          udise_code?: string | null
          updated_at?: string | null
          urban_body?: string | null
          village?: string | null
          ward?: string | null
          website?: string | null
          whatsapp?: string | null
          whatsapp_opted_out?: boolean | null
          whatsapp_verified?: boolean | null
        }
        Relationships: []
      }
      prospect_stats_cache: {
        Row: {
          by_board: Json
          by_stage: Json
          by_state: Json
          id: number
          linked_to_crm: number
          refreshed_at: string | null
          total: number
          with_email: number
          with_mobile: number
          with_website: number
        }
        Insert: {
          by_board?: Json
          by_stage?: Json
          by_state?: Json
          id?: number
          linked_to_crm?: number
          refreshed_at?: string | null
          total?: number
          with_email?: number
          with_mobile?: number
          with_website?: number
        }
        Update: {
          by_board?: Json
          by_stage?: Json
          by_state?: Json
          id?: number
          linked_to_crm?: number
          refreshed_at?: string | null
          total?: number
          with_email?: number
          with_mobile?: number
          with_website?: number
        }
        Relationships: []
      }
      prospect_sync_log: {
        Row: {
          changed_by: string | null
          created_at: string
          id: number
          new_values: Json
          old_values: Json
          prospect_school_id: string
          school_id: string
        }
        Insert: {
          changed_by?: string | null
          created_at?: string
          id?: number
          new_values: Json
          old_values: Json
          prospect_school_id: string
          school_id: string
        }
        Update: {
          changed_by?: string | null
          created_at?: string
          id?: number
          new_values?: Json
          old_values?: Json
          prospect_school_id?: string
          school_id?: string
        }
        Relationships: []
      }
      question_papers: {
        Row: {
          analysis_error: string | null
          analysis_progress: number
          analysis_status: string
          class_code: string
          created_at: string
          created_by: string | null
          deleted_at: string | null
          id: string
          olympiad_code: string
          pdf_file_name: string | null
          pdf_r2_key: string | null
          project_id: string
          slot_template_id: string
          status: string
          total_questions: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          analysis_error?: string | null
          analysis_progress?: number
          analysis_status?: string
          class_code: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          olympiad_code: string
          pdf_file_name?: string | null
          pdf_r2_key?: string | null
          project_id: string
          slot_template_id: string
          status?: string
          total_questions: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          analysis_error?: string | null
          analysis_progress?: number
          analysis_status?: string
          class_code?: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          olympiad_code?: string
          pdf_file_name?: string | null
          pdf_r2_key?: string | null
          project_id?: string
          slot_template_id?: string
          status?: string
          total_questions?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "question_papers_class_code_fkey"
            columns: ["class_code"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "question_papers_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "olympiad_projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "question_papers_slot_template_id_fkey"
            columns: ["slot_template_id"]
            isOneToOne: false
            referencedRelation: "exam_slot_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      questions: {
        Row: {
          ai_answer: string | null
          also_correct: string | null
          ai_confidence: number | null
          ai_reason: string | null
          check_status: string
          cognitive_level: string | null
          correct_answer: string | null
          figure_box: Json | null
          figure_page: number | null
          has_figure: boolean
          human_edited: boolean
          id: string
          is_grace: boolean
          key_answer: string | null
          nep_skill_mapping: string | null
          option_a: string | null
          option_b: string | null
          option_c: string | null
          option_d: string | null
          paper_id: string
          question_number: number
          question_text: string | null
          recheck_answer: string | null
          recheck_confidence: number | null
          recheck_reason: string | null
          rechecked_at: string | null
          skill_category: string | null
          skill_description: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          ai_answer?: string | null
          also_correct?: string | null
          ai_confidence?: number | null
          ai_reason?: string | null
          check_status?: string
          cognitive_level?: string | null
          correct_answer?: string | null
          figure_box?: Json | null
          figure_page?: number | null
          has_figure?: boolean
          human_edited?: boolean
          id?: string
          is_grace?: boolean
          key_answer?: string | null
          nep_skill_mapping?: string | null
          option_a?: string | null
          option_b?: string | null
          option_c?: string | null
          option_d?: string | null
          paper_id: string
          question_number: number
          question_text?: string | null
          recheck_answer?: string | null
          recheck_confidence?: number | null
          recheck_reason?: string | null
          rechecked_at?: string | null
          skill_category?: string | null
          skill_description?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          ai_answer?: string | null
          also_correct?: string | null
          ai_confidence?: number | null
          ai_reason?: string | null
          check_status?: string
          cognitive_level?: string | null
          correct_answer?: string | null
          figure_box?: Json | null
          figure_page?: number | null
          has_figure?: boolean
          human_edited?: boolean
          id?: string
          is_grace?: boolean
          key_answer?: string | null
          nep_skill_mapping?: string | null
          option_a?: string | null
          option_b?: string | null
          option_c?: string | null
          option_d?: string | null
          paper_id?: string
          question_number?: number
          question_text?: string | null
          recheck_answer?: string | null
          recheck_confidence?: number | null
          recheck_reason?: string | null
          rechecked_at?: string | null
          skill_category?: string | null
          skill_description?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "questions_paper_id_fkey"
            columns: ["paper_id"]
            isOneToOne: false
            referencedRelation: "question_papers"
            referencedColumns: ["id"]
          },
        ]
      }
      receipt_fy_counters: {
        Row: {
          fy: number
          last_no: number
        }
        Insert: {
          fy: number
          last_no?: number
        }
        Update: {
          fy?: number
          last_no?: number
        }
        Relationships: []
      }
      receipt_numbers: {
        Row: {
          fy: number | null
          generated_at: string
          id: string
          payment_transaction_id: string
          receipt_number: number
        }
        Insert: {
          fy?: number | null
          generated_at?: string
          id?: string
          payment_transaction_id: string
          receipt_number: number
        }
        Update: {
          fy?: number | null
          generated_at?: string
          id?: string
          payment_transaction_id?: string
          receipt_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "receipt_numbers_payment_transaction_id_fkey"
            columns: ["payment_transaction_id"]
            isOneToOne: true
            referencedRelation: "payment_transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      registration_format_config: {
        Row: {
          component_order: Json
          created_at: string
          created_by: string
          format_name: string
          id: string
          is_active: boolean
          project_id: string | null
          separator: string
          updated_at: string
        }
        Insert: {
          component_order?: Json
          created_at?: string
          created_by: string
          format_name?: string
          id?: string
          is_active?: boolean
          project_id?: string | null
          separator?: string
          updated_at?: string
        }
        Update: {
          component_order?: Json
          created_at?: string
          created_by?: string
          format_name?: string
          id?: string
          is_active?: boolean
          project_id?: string | null
          separator?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "registration_format_config_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "olympiad_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      registration_number_failures: {
        Row: {
          enrollment_id: string
          err_message: string | null
          failed_at: string
          id: number
          project_id: string | null
          recoverable: boolean
          resolved_at: string | null
          school_id: string | null
          sqlstate: string | null
          student_id: string | null
        }
        Insert: {
          enrollment_id: string
          err_message?: string | null
          failed_at?: string
          id?: never
          project_id?: string | null
          recoverable: boolean
          resolved_at?: string | null
          school_id?: string | null
          sqlstate?: string | null
          student_id?: string | null
        }
        Update: {
          enrollment_id?: string
          err_message?: string | null
          failed_at?: string
          id?: never
          project_id?: string | null
          recoverable?: boolean
          resolved_at?: string | null
          school_id?: string | null
          sqlstate?: string | null
          student_id?: string | null
        }
        Relationships: []
      }
      registration_number_health: {
        Row: {
          checked_at: string
          id: number
          oldest_stuck_at: string | null
          project_id: string | null
          sample_ids: string[] | null
          stuck_over_15min: number
          stuck_total: number
        }
        Insert: {
          checked_at?: string
          id?: never
          oldest_stuck_at?: string | null
          project_id?: string | null
          sample_ids?: string[] | null
          stuck_over_15min: number
          stuck_total: number
        }
        Update: {
          checked_at?: string
          id?: never
          oldest_stuck_at?: string | null
          project_id?: string | null
          sample_ids?: string[] | null
          stuck_over_15min?: number
          stuck_total?: number
        }
        Relationships: []
      }
      result_ai_batches: {
        Row: {
          anthropic_batch_id: string | null
          collected_at: string | null
          created_at: string
          created_by: string | null
          error: string | null
          errored: number
          errored_enrollment_ids: string[]
          id: string
          kind: string
          project_id: string
          school_id: string | null
          status: string
          succeeded: number
          total: number
        }
        Insert: {
          anthropic_batch_id?: string | null
          collected_at?: string | null
          created_at?: string
          created_by?: string | null
          error?: string | null
          errored?: number
          errored_enrollment_ids?: string[]
          id?: string
          kind?: string
          project_id: string
          school_id?: string | null
          status?: string
          succeeded?: number
          total?: number
        }
        Update: {
          anthropic_batch_id?: string | null
          collected_at?: string | null
          created_at?: string
          created_by?: string | null
          error?: string | null
          errored?: number
          errored_enrollment_ids?: string[]
          id?: string
          kind?: string
          project_id?: string
          school_id?: string | null
          status?: string
          succeeded?: number
          total?: number
        }
        Relationships: [
          {
            foreignKeyName: "result_ai_batches_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "olympiad_projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "result_ai_batches_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      result_audit_log: {
        Row: {
          action: string
          after: Json | null
          before: Json | null
          changed_at: string
          changed_by: string | null
          id: number
          row_id: string | null
          table_name: string
        }
        Insert: {
          action: string
          after?: Json | null
          before?: Json | null
          changed_at?: string
          changed_by?: string | null
          id?: number
          row_id?: string | null
          table_name: string
        }
        Update: {
          action?: string
          after?: Json | null
          before?: Json | null
          changed_at?: string
          changed_by?: string | null
          id?: number
          row_id?: string | null
          table_name?: string
        }
        Relationships: []
      }
      result_award_rules: {
        Row: {
          award_name: string
          class_code: string | null
          created_at: string
          created_by: string | null
          id: string
          level: string
          olympiad_code: string | null
          project_id: string
          rule_type: string
          sort_order: number
          updated_at: string
          updated_by: string | null
          value: number
        }
        Insert: {
          award_name: string
          class_code?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          level: string
          olympiad_code?: string | null
          project_id: string
          rule_type: string
          sort_order?: number
          updated_at?: string
          updated_by?: string | null
          value: number
        }
        Update: {
          award_name?: string
          class_code?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          level?: string
          olympiad_code?: string | null
          project_id?: string
          rule_type?: string
          sort_order?: number
          updated_at?: string
          updated_by?: string | null
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "result_award_rules_class_code_fkey"
            columns: ["class_code"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "result_award_rules_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "olympiad_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      result_awards: {
        Row: {
          award_name: string
          created_at: string
          created_by: string | null
          enrollment_id: string
          id: string
          notes: string | null
          project_id: string
          removed: boolean
          removed_at: string | null
          removed_by: string | null
          removed_note: string | null
          rule_id: string | null
          source: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          award_name: string
          created_at?: string
          created_by?: string | null
          enrollment_id: string
          id?: string
          notes?: string | null
          project_id: string
          removed?: boolean
          removed_at?: string | null
          removed_by?: string | null
          removed_note?: string | null
          rule_id?: string | null
          source: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          award_name?: string
          created_at?: string
          created_by?: string | null
          enrollment_id?: string
          id?: string
          notes?: string | null
          project_id?: string
          removed?: boolean
          removed_at?: string | null
          removed_by?: string | null
          removed_note?: string | null
          rule_id?: string | null
          source?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "result_awards_enrollment_id_fkey"
            columns: ["enrollment_id"]
            isOneToOne: false
            referencedRelation: "portal_student_enrollments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "result_awards_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "olympiad_projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "result_awards_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "result_award_rules"
            referencedColumns: ["id"]
          },
        ]
      }
      result_corrections: {
        Row: {
          after_value: string | null
          before_value: string | null
          changed_at: string
          changed_by: string | null
          evaluation_id: string
          id: number
          question_number: number
          reason: string
        }
        Insert: {
          after_value?: string | null
          before_value?: string | null
          changed_at?: string
          changed_by?: string | null
          evaluation_id: string
          id?: number
          question_number: number
          reason: string
        }
        Update: {
          after_value?: string | null
          before_value?: string | null
          changed_at?: string
          changed_by?: string | null
          evaluation_id?: string
          id?: number
          question_number?: number
          reason?: string
        }
        Relationships: [
          {
            foreignKeyName: "result_corrections_evaluation_id_fkey"
            columns: ["evaluation_id"]
            isOneToOne: false
            referencedRelation: "result_evaluations"
            referencedColumns: ["id"]
          },
        ]
      }
      result_evaluations: {
        Row: {
          answers: string[] | null
          batch_id: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          enrollment_id: string
          id: string
          marks: number[] | null
          paper_id: string
          status: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          answers?: string[] | null
          batch_id?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          enrollment_id: string
          id?: string
          marks?: number[] | null
          paper_id: string
          status: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          answers?: string[] | null
          batch_id?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          enrollment_id?: string
          id?: string
          marks?: number[] | null
          paper_id?: string
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "result_evaluations_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "result_upload_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "result_evaluations_enrollment_id_fkey"
            columns: ["enrollment_id"]
            isOneToOne: false
            referencedRelation: "portal_student_enrollments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "result_evaluations_paper_id_fkey"
            columns: ["paper_id"]
            isOneToOne: false
            referencedRelation: "question_papers"
            referencedColumns: ["id"]
          },
        ]
      }
      result_feedback: {
        Row: {
          basis_hash: string
          batch_id: string | null
          created_at: string
          enrollment_id: string
          feedback: Json
          model: string
          outdated: boolean
        }
        Insert: {
          basis_hash: string
          batch_id?: string | null
          created_at?: string
          enrollment_id: string
          feedback: Json
          model: string
          outdated?: boolean
        }
        Update: {
          basis_hash?: string
          batch_id?: string | null
          created_at?: string
          enrollment_id?: string
          feedback?: Json
          model?: string
          outdated?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "result_feedback_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "result_ai_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "result_feedback_enrollment_id_fkey"
            columns: ["enrollment_id"]
            isOneToOne: true
            referencedRelation: "portal_student_enrollments"
            referencedColumns: ["id"]
          },
        ]
      }
      result_integrity_flags: {
        Row: {
          class_code: string | null
          created_at: string
          details: Json
          fingerprint: string
          flag_type: string
          id: string
          notes: string | null
          olympiad_code: string | null
          project_id: string
          reviewed_at: string | null
          reviewed_by: string | null
          scan_id: string | null
          school_id: string
          severity: string
          status: string
        }
        Insert: {
          class_code?: string | null
          created_at?: string
          details?: Json
          fingerprint: string
          flag_type: string
          id?: string
          notes?: string | null
          olympiad_code?: string | null
          project_id: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          scan_id?: string | null
          school_id: string
          severity: string
          status?: string
        }
        Update: {
          class_code?: string | null
          created_at?: string
          details?: Json
          fingerprint?: string
          flag_type?: string
          id?: string
          notes?: string | null
          olympiad_code?: string | null
          project_id?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          scan_id?: string | null
          school_id?: string
          severity?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "result_integrity_flags_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "olympiad_projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "result_integrity_flags_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      result_resend_flags: {
        Row: {
          cleared_at: string | null
          cleared_by: string | null
          created_at: string
          id: string
          project_id: string
          reason: string
          school_id: string
        }
        Insert: {
          cleared_at?: string | null
          cleared_by?: string | null
          created_at?: string
          id?: string
          project_id: string
          reason: string
          school_id: string
        }
        Update: {
          cleared_at?: string | null
          cleared_by?: string | null
          created_at?: string
          id?: string
          project_id?: string
          reason?: string
          school_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "result_resend_flags_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "olympiad_projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "result_resend_flags_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      result_school_analysis: {
        Row: {
          analysis: Json
          created_at: string
          model: string
          outdated: boolean
          project_id: string
          school_id: string
        }
        Insert: {
          analysis: Json
          created_at?: string
          model: string
          outdated?: boolean
          project_id: string
          school_id: string
        }
        Update: {
          analysis?: Json
          created_at?: string
          model?: string
          outdated?: boolean
          project_id?: string
          school_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "result_school_analysis_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "olympiad_projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "result_school_analysis_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      result_scores: {
        Row: {
          class_code: string
          computed_at: string
          district_key: string | null
          enrollment_id: string
          evaluation_id: string
          grade: string
          max_marks: number
          olympiad_code: string
          paper_id: string
          percentage: number
          project_id: string
          rank_district: number | null
          rank_national: number | null
          rank_school: number | null
          rank_state: number | null
          school_id: string | null
          state_code: string | null
          total: number
        }
        Insert: {
          class_code: string
          computed_at?: string
          district_key?: string | null
          enrollment_id: string
          evaluation_id: string
          grade: string
          max_marks: number
          olympiad_code: string
          paper_id: string
          percentage: number
          project_id: string
          rank_district?: number | null
          rank_national?: number | null
          rank_school?: number | null
          rank_state?: number | null
          school_id?: string | null
          state_code?: string | null
          total: number
        }
        Update: {
          class_code?: string
          computed_at?: string
          district_key?: string | null
          enrollment_id?: string
          evaluation_id?: string
          grade?: string
          max_marks?: number
          olympiad_code?: string
          paper_id?: string
          percentage?: number
          project_id?: string
          rank_district?: number | null
          rank_national?: number | null
          rank_school?: number | null
          rank_state?: number | null
          school_id?: string | null
          state_code?: string | null
          total?: number
        }
        Relationships: [
          {
            foreignKeyName: "result_scores_enrollment_id_fkey"
            columns: ["enrollment_id"]
            isOneToOne: true
            referencedRelation: "portal_student_enrollments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "result_scores_evaluation_id_fkey"
            columns: ["evaluation_id"]
            isOneToOne: false
            referencedRelation: "result_evaluations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "result_scores_paper_id_fkey"
            columns: ["paper_id"]
            isOneToOne: false
            referencedRelation: "question_papers"
            referencedColumns: ["id"]
          },
        ]
      }
      result_send_batches: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          channel: string
          created_at: string
          created_by: string | null
          id: string
          project_id: string
          status: string
          test_target: string | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          channel: string
          created_at?: string
          created_by?: string | null
          id?: string
          project_id: string
          status?: string
          test_target?: string | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          channel?: string
          created_at?: string
          created_by?: string | null
          id?: string
          project_id?: string
          status?: string
          test_target?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "result_send_batches_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "olympiad_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      result_send_items: {
        Row: {
          attempts: number
          batch_id: string
          created_at: string
          error: string | null
          id: string
          payload: Json
          school_id: string | null
          sent_at: string | null
          status: string
          target: string | null
        }
        Insert: {
          attempts?: number
          batch_id: string
          created_at?: string
          error?: string | null
          id?: string
          payload?: Json
          school_id?: string | null
          sent_at?: string | null
          status?: string
          target?: string | null
        }
        Update: {
          attempts?: number
          batch_id?: string
          created_at?: string
          error?: string | null
          id?: string
          payload?: Json
          school_id?: string | null
          sent_at?: string | null
          status?: string
          target?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "result_send_items_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "result_send_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "result_send_items_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      result_skill_lists: {
        Row: {
          class_group: string
          olympiad_code: string
          skill: string
          sort_order: number
        }
        Insert: {
          class_group: string
          olympiad_code: string
          skill: string
          sort_order: number
        }
        Update: {
          class_group?: string
          olympiad_code?: string
          skill?: string
          sort_order?: number
        }
        Relationships: []
      }
      result_upload_batches: {
        Row: {
          created_at: string
          file_name: string | null
          id: string
          kind: string
          paper_id: string
          replaced_count: number
          row_count: number
          uploaded_by: string | null
        }
        Insert: {
          created_at?: string
          file_name?: string | null
          id?: string
          kind: string
          paper_id: string
          replaced_count?: number
          row_count?: number
          uploaded_by?: string | null
        }
        Update: {
          created_at?: string
          file_name?: string | null
          id?: string
          kind?: string
          paper_id?: string
          replaced_count?: number
          row_count?: number
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "result_upload_batches_paper_id_fkey"
            columns: ["paper_id"]
            isOneToOne: false
            referencedRelation: "question_papers"
            referencedColumns: ["id"]
          },
        ]
      }
      school_codes: {
        Row: {
          assigned_at: string
          district_code: string
          id: string
          is_active: boolean
          project_id: string
          school_code: string
          school_id: string
          state_code: string
        }
        Insert: {
          assigned_at?: string
          district_code: string
          id?: string
          is_active?: boolean
          project_id: string
          school_code: string
          school_id: string
          state_code: string
        }
        Update: {
          assigned_at?: string
          district_code?: string
          id?: string
          is_active?: boolean
          project_id?: string
          school_code?: string
          school_id?: string
          state_code?: string
        }
        Relationships: [
          {
            foreignKeyName: "school_codes_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "olympiad_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      school_portal_accounts: {
        Row: {
          id: string
          is_active: boolean
          linked_at: string
          linked_by_ss_no: number | null
          school_id: string | null
          user_id: string
        }
        Insert: {
          id?: string
          is_active?: boolean
          linked_at?: string
          linked_by_ss_no?: number | null
          school_id?: string | null
          user_id: string
        }
        Update: {
          id?: string
          is_active?: boolean
          linked_at?: string
          linked_by_ss_no?: number | null
          school_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "school_portal_accounts_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      school_portal_registrations: {
        Row: {
          address1: string | null
          address2: string | null
          approved_at: string | null
          approved_by: string | null
          board: string | null
          city: string
          contact_name: string | null
          coord_mobile: string | null
          corr_mobile: string | null
          corr_name: string | null
          created_at: string
          district: string
          email: string
          id: string
          matched_school_id: string | null
          phone: string | null
          pincode: string | null
          principal_mobile: string | null
          principal_name: string | null
          project_id: string | null
          rejection_reason: string | null
          school_name: string
          ss_no: number | null
          state: string | null
          status: string
          teacher_epo: string | null
          teacher_epo_mob: string | null
          teacher_gksspo: string | null
          teacher_gksspo_mob: string | null
          teacher_kidspo: string | null
          teacher_kidspo_mob: string | null
          teacher_lrpo: string | null
          teacher_lrpo_mob: string | null
          teacher_mpo: string | null
          teacher_mpo_mob: string | null
          teacher_spo: string | null
          teacher_spo_mob: string | null
          updated_at: string
          user_id: string | null
          welcome_email_sent_at: string | null
          welcome_whatsapp_sent_at: string | null
        }
        Insert: {
          address1?: string | null
          address2?: string | null
          approved_at?: string | null
          approved_by?: string | null
          board?: string | null
          city: string
          contact_name?: string | null
          coord_mobile?: string | null
          corr_mobile?: string | null
          corr_name?: string | null
          created_at?: string
          district: string
          email: string
          id?: string
          matched_school_id?: string | null
          phone?: string | null
          pincode?: string | null
          principal_mobile?: string | null
          principal_name?: string | null
          project_id?: string | null
          rejection_reason?: string | null
          school_name: string
          ss_no?: number | null
          state?: string | null
          status?: string
          teacher_epo?: string | null
          teacher_epo_mob?: string | null
          teacher_gksspo?: string | null
          teacher_gksspo_mob?: string | null
          teacher_kidspo?: string | null
          teacher_kidspo_mob?: string | null
          teacher_lrpo?: string | null
          teacher_lrpo_mob?: string | null
          teacher_mpo?: string | null
          teacher_mpo_mob?: string | null
          teacher_spo?: string | null
          teacher_spo_mob?: string | null
          updated_at?: string
          user_id?: string | null
          welcome_email_sent_at?: string | null
          welcome_whatsapp_sent_at?: string | null
        }
        Update: {
          address1?: string | null
          address2?: string | null
          approved_at?: string | null
          approved_by?: string | null
          board?: string | null
          city?: string
          contact_name?: string | null
          coord_mobile?: string | null
          corr_mobile?: string | null
          corr_name?: string | null
          created_at?: string
          district?: string
          email?: string
          id?: string
          matched_school_id?: string | null
          phone?: string | null
          pincode?: string | null
          principal_mobile?: string | null
          principal_name?: string | null
          project_id?: string | null
          rejection_reason?: string | null
          school_name?: string
          ss_no?: number | null
          state?: string | null
          status?: string
          teacher_epo?: string | null
          teacher_epo_mob?: string | null
          teacher_gksspo?: string | null
          teacher_gksspo_mob?: string | null
          teacher_kidspo?: string | null
          teacher_kidspo_mob?: string | null
          teacher_lrpo?: string | null
          teacher_lrpo_mob?: string | null
          teacher_mpo?: string | null
          teacher_mpo_mob?: string | null
          teacher_spo?: string | null
          teacher_spo_mob?: string | null
          updated_at?: string
          user_id?: string | null
          welcome_email_sent_at?: string | null
          welcome_whatsapp_sent_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "school_portal_registrations_matched_school_id_fkey"
            columns: ["matched_school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "school_portal_registrations_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "olympiad_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      school_project_workflow: {
        Row: {
          answer_sheet_status:
            | Database["public"]["Enums"]["answer_sheet_status"]
            | null
          brochure_delivery_status:
            | Database["public"]["Enums"]["brochure_delivery_status"]
            | null
          concession_amount: number
          concession_per_entry: number | null
          confirmed_participants: number
          consent_form_comment: string | null
          consent_form_requested:
            | Database["public"]["Enums"]["consent_status"]
            | null
          consent_form_sent: string | null
          contacted: Database["public"]["Enums"]["contacted_status"] | null
          courier_status: Database["public"]["Enums"]["courier_status"] | null
          created_at: string
          effective_rate_per_entry: number | null
          expected_amount: number | null
          id: string
          list_submitted_at: string | null
          name_list_status:
            | Database["public"]["Enums"]["name_list_status"]
            | null
          outstanding_balance: number | null
          payment_amount: number | null
          payment_date: string | null
          payment_mode: string | null
          payment_received: number | null
          payment_status: Database["public"]["Enums"]["payment_status"] | null
          per_entry_rate: number | null
          project_id: string
          question_paper_sent:
            | Database["public"]["Enums"]["question_paper_status"]
            | null
          rate_per_entry: number
          registration_interest:
            | Database["public"]["Enums"]["interest_status"]
            | null
          registration_interest_comment: string | null
          registration_status:
            | Database["public"]["Enums"]["registration_status"]
            | null
          result_status: Database["public"]["Enums"]["result_status"] | null
          school_id: string
          total_participants: number | null
          updated_at: string
        }
        Insert: {
          answer_sheet_status?:
            | Database["public"]["Enums"]["answer_sheet_status"]
            | null
          brochure_delivery_status?:
            | Database["public"]["Enums"]["brochure_delivery_status"]
            | null
          concession_amount?: number
          concession_per_entry?: number | null
          confirmed_participants?: number
          consent_form_comment?: string | null
          consent_form_requested?:
            | Database["public"]["Enums"]["consent_status"]
            | null
          consent_form_sent?: string | null
          contacted?: Database["public"]["Enums"]["contacted_status"] | null
          courier_status?: Database["public"]["Enums"]["courier_status"] | null
          created_at?: string
          effective_rate_per_entry?: number | null
          expected_amount?: number | null
          id?: string
          list_submitted_at?: string | null
          name_list_status?:
            | Database["public"]["Enums"]["name_list_status"]
            | null
          outstanding_balance?: number | null
          payment_amount?: number | null
          payment_date?: string | null
          payment_mode?: string | null
          payment_received?: number | null
          payment_status?: Database["public"]["Enums"]["payment_status"] | null
          per_entry_rate?: number | null
          project_id: string
          question_paper_sent?:
            | Database["public"]["Enums"]["question_paper_status"]
            | null
          rate_per_entry?: number
          registration_interest?:
            | Database["public"]["Enums"]["interest_status"]
            | null
          registration_interest_comment?: string | null
          registration_status?:
            | Database["public"]["Enums"]["registration_status"]
            | null
          result_status?: Database["public"]["Enums"]["result_status"] | null
          school_id: string
          total_participants?: number | null
          updated_at?: string
        }
        Update: {
          answer_sheet_status?:
            | Database["public"]["Enums"]["answer_sheet_status"]
            | null
          brochure_delivery_status?:
            | Database["public"]["Enums"]["brochure_delivery_status"]
            | null
          concession_amount?: number
          concession_per_entry?: number | null
          confirmed_participants?: number
          consent_form_comment?: string | null
          consent_form_requested?:
            | Database["public"]["Enums"]["consent_status"]
            | null
          consent_form_sent?: string | null
          contacted?: Database["public"]["Enums"]["contacted_status"] | null
          courier_status?: Database["public"]["Enums"]["courier_status"] | null
          created_at?: string
          effective_rate_per_entry?: number | null
          expected_amount?: number | null
          id?: string
          list_submitted_at?: string | null
          name_list_status?:
            | Database["public"]["Enums"]["name_list_status"]
            | null
          outstanding_balance?: number | null
          payment_amount?: number | null
          payment_date?: string | null
          payment_mode?: string | null
          payment_received?: number | null
          payment_status?: Database["public"]["Enums"]["payment_status"] | null
          per_entry_rate?: number | null
          project_id?: string
          question_paper_sent?:
            | Database["public"]["Enums"]["question_paper_status"]
            | null
          rate_per_entry?: number
          registration_interest?:
            | Database["public"]["Enums"]["interest_status"]
            | null
          registration_interest_comment?: string | null
          registration_status?:
            | Database["public"]["Enums"]["registration_status"]
            | null
          result_status?: Database["public"]["Enums"]["result_status"] | null
          school_id?: string
          total_participants?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "school_project_workflow_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "olympiad_projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "school_project_workflow_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      school_removal_archive: {
        Row: {
          auth_users: Json | null
          created_at: string
          exam_rows: Json | null
          filled_from_portal: Json
          id: number
          portal_accounts: Json | null
          portal_registrations: Json | null
          project_id: string
          reason: string
          removed_by: string | null
          school_id: string
          ss_no: number | null
          workflow: Json | null
        }
        Insert: {
          auth_users?: Json | null
          created_at?: string
          exam_rows?: Json | null
          filled_from_portal?: Json
          id?: number
          portal_accounts?: Json | null
          portal_registrations?: Json | null
          project_id: string
          reason: string
          removed_by?: string | null
          school_id: string
          ss_no?: number | null
          workflow?: Json | null
        }
        Update: {
          auth_users?: Json | null
          created_at?: string
          exam_rows?: Json | null
          filled_from_portal?: Json
          id?: number
          portal_accounts?: Json | null
          portal_registrations?: Json | null
          project_id?: string
          reason?: string
          removed_by?: string | null
          school_id?: string
          ss_no?: number | null
          workflow?: Json | null
        }
        Relationships: []
      }
      school_result_release: {
        Row: {
          id: string
          notes: string | null
          project_id: string
          released_at: string
          released_by: string
          school_id: string
        }
        Insert: {
          id?: string
          notes?: string | null
          project_id: string
          released_at?: string
          released_by: string
          school_id: string
        }
        Update: {
          id?: string
          notes?: string | null
          project_id?: string
          released_at?: string
          released_by?: string
          school_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "school_result_release_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "olympiad_projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "school_result_release_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      schools: {
        Row: {
          additional_contacts: Json | null
          address1: string | null
          address2: string | null
          answer_sheet_status:
            | Database["public"]["Enums"]["answer_sheet_status"]
            | null
          board: string | null
          brochure_delivery_status:
            | Database["public"]["Enums"]["brochure_delivery_status"]
            | null
          concession_per_entry: number | null
          confirmed_participants: number
          consent_form_comment: string | null
          consent_form_requested:
            | Database["public"]["Enums"]["consent_status"]
            | null
          consent_form_sent: string | null
          contact_person_name: string | null
          contacted: Database["public"]["Enums"]["contacted_status"] | null
          coord_mobile: string | null
          corr_mobile: string | null
          corr_name: string | null
          courier_dispatched_at: string | null
          courier_name: string | null
          courier_status: Database["public"]["Enums"]["courier_status"] | null
          courier_tracking_no: string | null
          created_at: string
          current_project_id: string | null
          district: string
          effective_rate_per_entry: number | null
          email: string | null
          expected_amount: number | null
          id: string
          iplus_coordinator: string | null
          mobile1: string | null
          mobile2: string | null
          name: string | null
          name_list_status:
            | Database["public"]["Enums"]["name_list_status"]
            | null
          outstanding_balance: number | null
          payment_amount: number | null
          payment_date: string | null
          payment_mode: string | null
          payment_received: number | null
          payment_status: Database["public"]["Enums"]["payment_status"] | null
          per_entry_rate: number | null
          pincode: string
          portal_registered: boolean
          principal_mobile: string | null
          principal_name: string | null
          prospect_school_id: string | null
          question_paper_sent:
            | Database["public"]["Enums"]["question_paper_status"]
            | null
          registration_interest:
            | Database["public"]["Enums"]["interest_status"]
            | null
          registration_interest_comment: string | null
          registration_status:
            | Database["public"]["Enums"]["registration_status"]
            | null
          result_status: Database["public"]["Enums"]["result_status"] | null
          school_address: string
          school_name: string
          ss_no: number | null
          state: string | null
          teacher_epo: string | null
          teacher_epo_mob: string | null
          teacher_gksspo: string | null
          teacher_gksspo_mob: string | null
          teacher_kidspo: string | null
          teacher_kidspo_mob: string | null
          teacher_lrpo: string | null
          teacher_lrpo_mob: string | null
          teacher_mpo: string | null
          teacher_mpo_mob: string | null
          teacher_spo: string | null
          teacher_spo_mob: string | null
          total_participants: number | null
          updated_at: string
        }
        Insert: {
          additional_contacts?: Json | null
          address1?: string | null
          address2?: string | null
          answer_sheet_status?:
            | Database["public"]["Enums"]["answer_sheet_status"]
            | null
          board?: string | null
          brochure_delivery_status?:
            | Database["public"]["Enums"]["brochure_delivery_status"]
            | null
          concession_per_entry?: number | null
          confirmed_participants?: number
          consent_form_comment?: string | null
          consent_form_requested?:
            | Database["public"]["Enums"]["consent_status"]
            | null
          consent_form_sent?: string | null
          contact_person_name?: string | null
          contacted?: Database["public"]["Enums"]["contacted_status"] | null
          coord_mobile?: string | null
          corr_mobile?: string | null
          corr_name?: string | null
          courier_dispatched_at?: string | null
          courier_name?: string | null
          courier_status?: Database["public"]["Enums"]["courier_status"] | null
          courier_tracking_no?: string | null
          created_at?: string
          current_project_id?: string | null
          district: string
          effective_rate_per_entry?: number | null
          email?: string | null
          expected_amount?: number | null
          id?: string
          iplus_coordinator?: string | null
          mobile1?: string | null
          mobile2?: string | null
          name?: string | null
          name_list_status?:
            | Database["public"]["Enums"]["name_list_status"]
            | null
          outstanding_balance?: number | null
          payment_amount?: number | null
          payment_date?: string | null
          payment_mode?: string | null
          payment_received?: number | null
          payment_status?: Database["public"]["Enums"]["payment_status"] | null
          per_entry_rate?: number | null
          pincode?: string
          portal_registered?: boolean
          principal_mobile?: string | null
          principal_name?: string | null
          prospect_school_id?: string | null
          question_paper_sent?:
            | Database["public"]["Enums"]["question_paper_status"]
            | null
          registration_interest?:
            | Database["public"]["Enums"]["interest_status"]
            | null
          registration_interest_comment?: string | null
          registration_status?:
            | Database["public"]["Enums"]["registration_status"]
            | null
          result_status?: Database["public"]["Enums"]["result_status"] | null
          school_address: string
          school_name: string
          ss_no?: number | null
          state?: string | null
          teacher_epo?: string | null
          teacher_epo_mob?: string | null
          teacher_gksspo?: string | null
          teacher_gksspo_mob?: string | null
          teacher_kidspo?: string | null
          teacher_kidspo_mob?: string | null
          teacher_lrpo?: string | null
          teacher_lrpo_mob?: string | null
          teacher_mpo?: string | null
          teacher_mpo_mob?: string | null
          teacher_spo?: string | null
          teacher_spo_mob?: string | null
          total_participants?: number | null
          updated_at?: string
        }
        Update: {
          additional_contacts?: Json | null
          address1?: string | null
          address2?: string | null
          answer_sheet_status?:
            | Database["public"]["Enums"]["answer_sheet_status"]
            | null
          board?: string | null
          brochure_delivery_status?:
            | Database["public"]["Enums"]["brochure_delivery_status"]
            | null
          concession_per_entry?: number | null
          confirmed_participants?: number
          consent_form_comment?: string | null
          consent_form_requested?:
            | Database["public"]["Enums"]["consent_status"]
            | null
          consent_form_sent?: string | null
          contact_person_name?: string | null
          contacted?: Database["public"]["Enums"]["contacted_status"] | null
          coord_mobile?: string | null
          corr_mobile?: string | null
          corr_name?: string | null
          courier_dispatched_at?: string | null
          courier_name?: string | null
          courier_status?: Database["public"]["Enums"]["courier_status"] | null
          courier_tracking_no?: string | null
          created_at?: string
          current_project_id?: string | null
          district?: string
          effective_rate_per_entry?: number | null
          email?: string | null
          expected_amount?: number | null
          id?: string
          iplus_coordinator?: string | null
          mobile1?: string | null
          mobile2?: string | null
          name?: string | null
          name_list_status?:
            | Database["public"]["Enums"]["name_list_status"]
            | null
          outstanding_balance?: number | null
          payment_amount?: number | null
          payment_date?: string | null
          payment_mode?: string | null
          payment_received?: number | null
          payment_status?: Database["public"]["Enums"]["payment_status"] | null
          per_entry_rate?: number | null
          pincode?: string
          portal_registered?: boolean
          principal_mobile?: string | null
          principal_name?: string | null
          prospect_school_id?: string | null
          question_paper_sent?:
            | Database["public"]["Enums"]["question_paper_status"]
            | null
          registration_interest?:
            | Database["public"]["Enums"]["interest_status"]
            | null
          registration_interest_comment?: string | null
          registration_status?:
            | Database["public"]["Enums"]["registration_status"]
            | null
          result_status?: Database["public"]["Enums"]["result_status"] | null
          school_address?: string
          school_name?: string
          ss_no?: number | null
          state?: string | null
          teacher_epo?: string | null
          teacher_epo_mob?: string | null
          teacher_gksspo?: string | null
          teacher_gksspo_mob?: string | null
          teacher_kidspo?: string | null
          teacher_kidspo_mob?: string | null
          teacher_lrpo?: string | null
          teacher_lrpo_mob?: string | null
          teacher_mpo?: string | null
          teacher_mpo_mob?: string | null
          teacher_spo?: string | null
          teacher_spo_mob?: string | null
          total_participants?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "schools_current_project_id_fkey"
            columns: ["current_project_id"]
            isOneToOne: false
            referencedRelation: "olympiad_projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schools_prospect_school_id_fkey"
            columns: ["prospect_school_id"]
            isOneToOne: false
            referencedRelation: "prospect_schools"
            referencedColumns: ["id"]
          },
        ]
      }
      security_audit_logs: {
        Row: {
          action: string
          created_at: string
          id: string
          ip_address: unknown
          new_values: Json | null
          old_values: Json | null
          record_id: string | null
          table_name: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          action: string
          created_at?: string
          id?: string
          ip_address?: unknown
          new_values?: Json | null
          old_values?: Json | null
          record_id?: string | null
          table_name: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          action?: string
          created_at?: string
          id?: string
          ip_address?: unknown
          new_values?: Json | null
          old_values?: Json | null
          record_id?: string | null
          table_name?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
      seed_contacts: {
        Row: {
          created_at: string | null
          email: string
          id: string
          is_active: boolean
          name: string | null
        }
        Insert: {
          created_at?: string | null
          email: string
          id?: string
          is_active?: boolean
          name?: string | null
        }
        Update: {
          created_at?: string | null
          email?: string
          id?: string
          is_active?: boolean
          name?: string | null
        }
        Relationships: []
      }
      sensitive_data_access_log: {
        Row: {
          access_reason: string | null
          created_at: string | null
          id: string
          ip_address: unknown
          operation: string
          record_count: number | null
          sensitive_columns: string[] | null
          table_name: string
          user_id: string
        }
        Insert: {
          access_reason?: string | null
          created_at?: string | null
          id?: string
          ip_address?: unknown
          operation: string
          record_count?: number | null
          sensitive_columns?: string[] | null
          table_name: string
          user_id: string
        }
        Update: {
          access_reason?: string | null
          created_at?: string | null
          id?: string
          ip_address?: unknown
          operation?: string
          record_count?: number | null
          sensitive_columns?: string[] | null
          table_name?: string
          user_id?: string
        }
        Relationships: []
      }
      state_codes: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          state_code: string
          state_name: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          state_code: string
          state_name: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          state_code?: string
          state_name?: string
        }
        Relationships: []
      }
      student_registration_sequences: {
        Row: {
          class_code: number
          created_at: string
          id: string
          last_sequence: number
          project_id: string
          school_id: string
          updated_at: string
        }
        Insert: {
          class_code: number
          created_at?: string
          id?: string
          last_sequence?: number
          project_id: string
          school_id: string
          updated_at?: string
        }
        Update: {
          class_code?: number
          created_at?: string
          id?: string
          last_sequence?: number
          project_id?: string
          school_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      student_registrations: {
        Row: {
          class_code: number | null
          created_at: string
          created_by: string
          id: string
          project_id: string
          registration_number: string | null
          registration_number_digits: string | null
          registration_number_generated: string | null
          roll_number: string | null
          school_id: string
          student_class: string
          student_id: string | null
          student_name: string
          updated_at: string
        }
        Insert: {
          class_code?: number | null
          created_at?: string
          created_by: string
          id?: string
          project_id: string
          registration_number?: string | null
          registration_number_digits?: string | null
          registration_number_generated?: string | null
          roll_number?: string | null
          school_id: string
          student_class: string
          student_id?: string | null
          student_name: string
          updated_at?: string
        }
        Update: {
          class_code?: number | null
          created_at?: string
          created_by?: string
          id?: string
          project_id?: string
          registration_number?: string | null
          registration_number_digits?: string | null
          registration_number_generated?: string | null
          roll_number?: string | null
          school_id?: string
          student_class?: string
          student_id?: string | null
          student_name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "student_registrations_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "olympiad_projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_registrations_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_registrations_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      student_subjects: {
        Row: {
          created_at: string
          id: string
          registration_id: string
          subject_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          registration_id: string
          subject_id: string
        }
        Update: {
          created_at?: string
          id?: string
          registration_id?: string
          subject_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "student_subjects_registration_id_fkey"
            columns: ["registration_id"]
            isOneToOne: false
            referencedRelation: "student_registrations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_subjects_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "olympiad_subjects"
            referencedColumns: ["id"]
          },
        ]
      }
      students: {
        Row: {
          class_code: number | null
          created_at: string
          created_by: string
          id: string
          project_id: string
          school_id: string
          student_class: string
          student_name: string
          student_name_normalized: string | null
          student_sequence: number
          updated_at: string
        }
        Insert: {
          class_code?: number | null
          created_at?: string
          created_by: string
          id?: string
          project_id: string
          school_id: string
          student_class: string
          student_name: string
          student_name_normalized?: string | null
          student_sequence: number
          updated_at?: string
        }
        Update: {
          class_code?: number | null
          created_at?: string
          created_by?: string
          id?: string
          project_id?: string
          school_id?: string
          student_class?: string
          student_name?: string
          student_name_normalized?: string | null
          student_sequence?: number
          updated_at?: string
        }
        Relationships: []
      }
      subjects: {
        Row: {
          code: number
          name: string
        }
        Insert: {
          code: number
          name: string
        }
        Update: {
          code?: number
          name?: string
        }
        Relationships: []
      }
      template_approval_log: {
        Row: {
          action: string
          actor_id: string | null
          comment: string | null
          created_at: string | null
          id: string
          template_id: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          comment?: string | null
          created_at?: string | null
          id?: string
          template_id: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          comment?: string | null
          created_at?: string | null
          id?: string
          template_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "template_approval_log_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "template_approval_log_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "email_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      transfer_staff: {
        Row: {
          active: boolean
          created_at: string
          created_by: string | null
          id: string
          name: string
          phone: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          phone: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          phone?: string
          updated_at?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      voice_campaign_schools: {
        Row: {
          call_duration: number | null
          campaign_id: string | null
          created_at: string | null
          dtmf: string | null
          event_id: string | null
          id: string
          phone: string
          prospect_school_id: string | null
          sent_at: string | null
          status: string | null
        }
        Insert: {
          call_duration?: number | null
          campaign_id?: string | null
          created_at?: string | null
          dtmf?: string | null
          event_id?: string | null
          id?: string
          phone: string
          prospect_school_id?: string | null
          sent_at?: string | null
          status?: string | null
        }
        Update: {
          call_duration?: number | null
          campaign_id?: string | null
          created_at?: string | null
          dtmf?: string | null
          event_id?: string | null
          id?: string
          phone?: string
          prospect_school_id?: string | null
          sent_at?: string | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "voice_campaign_schools_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "voice_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voice_campaign_schools_prospect_school_id_fkey"
            columns: ["prospect_school_id"]
            isOneToOne: false
            referencedRelation: "prospect_schools"
            referencedColumns: ["id"]
          },
        ]
      }
      voice_campaigns: {
        Row: {
          answered_count: number | null
          audience_filters: Json | null
          caller_id: string | null
          campaign_type: string | null
          created_at: string | null
          created_by: string | null
          failed_count: number | null
          id: string
          name: string
          sent_count: number | null
          speech_content: string
          speech_language: string | null
          status: string | null
          total_count: number | null
        }
        Insert: {
          answered_count?: number | null
          audience_filters?: Json | null
          caller_id?: string | null
          campaign_type?: string | null
          created_at?: string | null
          created_by?: string | null
          failed_count?: number | null
          id?: string
          name: string
          sent_count?: number | null
          speech_content: string
          speech_language?: string | null
          status?: string | null
          total_count?: number | null
        }
        Update: {
          answered_count?: number | null
          audience_filters?: Json | null
          caller_id?: string | null
          campaign_type?: string | null
          created_at?: string | null
          created_by?: string | null
          failed_count?: number | null
          id?: string
          name?: string
          sent_count?: number | null
          speech_content?: string
          speech_language?: string | null
          status?: string | null
          total_count?: number | null
        }
        Relationships: []
      }
      voice_templates: {
        Row: {
          created_at: string
          created_by: string | null
          duration_seconds: number | null
          final_script: string
          id: string
          language_code: string
          mulaw_path: string | null
          name: string
          source_script: string | null
          speaker: string
          updated_at: string
          wav_path: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          duration_seconds?: number | null
          final_script: string
          id?: string
          language_code?: string
          mulaw_path?: string | null
          name: string
          source_script?: string | null
          speaker?: string
          updated_at?: string
          wav_path?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          duration_seconds?: number | null
          final_script?: string
          id?: string
          language_code?: string
          mulaw_path?: string | null
          name?: string
          source_script?: string | null
          speaker?: string
          updated_at?: string
          wav_path?: string | null
        }
        Relationships: []
      }
      wa_replies: {
        Row: {
          campaign_school_id: string | null
          context_wamid: string | null
          id: string
          message_text: string | null
          message_type: string | null
          msg_wamid: string | null
          phone: string
          raw: Json | null
          received_at: string
          sender_name: string | null
          status: string
        }
        Insert: {
          campaign_school_id?: string | null
          context_wamid?: string | null
          id?: string
          message_text?: string | null
          message_type?: string | null
          msg_wamid?: string | null
          phone: string
          raw?: Json | null
          received_at?: string
          sender_name?: string | null
          status?: string
        }
        Update: {
          campaign_school_id?: string | null
          context_wamid?: string | null
          id?: string
          message_text?: string | null
          message_type?: string | null
          msg_wamid?: string | null
          phone?: string
          raw?: Json | null
          received_at?: string
          sender_name?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "wa_replies_campaign_school_id_fkey"
            columns: ["campaign_school_id"]
            isOneToOne: false
            referencedRelation: "campaign_schools"
            referencedColumns: ["id"]
          },
        ]
      }
      wa_reply_responses: {
        Row: {
          created_at: string
          id: string
          message_text: string
          phone: string
          sent_by: string | null
          wa_reply_id: string | null
          wamid: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          message_text: string
          phone: string
          sent_by?: string | null
          wa_reply_id?: string | null
          wamid?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          message_text?: string
          phone?: string
          sent_by?: string | null
          wa_reply_id?: string | null
          wamid?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "wa_reply_responses_wa_reply_id_fkey"
            columns: ["wa_reply_id"]
            isOneToOne: false
            referencedRelation: "wa_replies"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_templates: {
        Row: {
          askeva_template_name: string
          body_variables: Json
          created_at: string
          created_by: string
          header_document_filename: string | null
          header_media_url: string | null
          id: string
          is_active: boolean
          language_code: string
          project_id: string
          raw_payload_template: Json | null
          template_category: string
          template_key: string
          template_name: string
          template_type: string
          updated_at: string
        }
        Insert: {
          askeva_template_name: string
          body_variables?: Json
          created_at?: string
          created_by: string
          header_document_filename?: string | null
          header_media_url?: string | null
          id?: string
          is_active?: boolean
          language_code?: string
          project_id: string
          raw_payload_template?: Json | null
          template_category?: string
          template_key: string
          template_name: string
          template_type: string
          updated_at?: string
        }
        Update: {
          askeva_template_name?: string
          body_variables?: Json
          created_at?: string
          created_by?: string
          header_document_filename?: string | null
          header_media_url?: string | null
          id?: string
          is_active?: boolean
          language_code?: string
          project_id?: string
          raw_payload_template?: Json | null
          template_category?: string
          template_key?: string
          template_name?: string
          template_type?: string
          updated_at?: string
        }
        Relationships: []
      }
      workflow_history: {
        Row: {
          changed_at: string | null
          changed_by: string
          id: string
          new_status: string
          old_status: string | null
          project_id: string | null
          school_id: string
          workflow_stage: string
        }
        Insert: {
          changed_at?: string | null
          changed_by: string
          id?: string
          new_status: string
          old_status?: string | null
          project_id?: string | null
          school_id: string
          workflow_stage: string
        }
        Update: {
          changed_at?: string | null
          changed_by?: string
          id?: string
          new_status?: string
          old_status?: string | null
          project_id?: string | null
          school_id?: string
          workflow_stage?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflow_history_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "olympiad_projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_history_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      zip_jobs: {
        Row: {
          completed_steps: number
          created_at: string
          created_by: string | null
          current_step: string | null
          error_message: string | null
          generation_state: Json | null
          id: string
          processed_at: string | null
          project_id: string | null
          school_id: string
          school_name: string
          ss_no: string
          status: string
          storage_path: string | null
          total_steps: number
          updated_at: string
        }
        Insert: {
          completed_steps?: number
          created_at?: string
          created_by?: string | null
          current_step?: string | null
          error_message?: string | null
          generation_state?: Json | null
          id?: string
          processed_at?: string | null
          project_id?: string | null
          school_id: string
          school_name: string
          ss_no: string
          status?: string
          storage_path?: string | null
          total_steps?: number
          updated_at?: string
        }
        Update: {
          completed_steps?: number
          created_at?: string
          created_by?: string | null
          current_step?: string | null
          error_message?: string | null
          generation_state?: Json | null
          id?: string
          processed_at?: string | null
          project_id?: string | null
          school_id?: string
          school_name?: string
          ss_no?: string
          status?: string
          storage_path?: string | null
          total_steps?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "zip_jobs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "olympiad_projects"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      accounts_payments_in: {
        Row: {
          amount: number | null
          category: string | null
          created_at: string | null
          created_by: string | null
          id: string | null
          payment_mode: string | null
          reference: string | null
          school_id: string | null
          school_name: string | null
          ss_no: number | null
          transaction_date: string | null
        }
        Relationships: []
      }
      credit_notes_with_balance: {
        Row: {
          amount: number | null
          created_at: string | null
          created_by: string | null
          credit_note_number: number | null
          fy: number | null
          id: string | null
          note: string | null
          payment_date: string | null
          payment_mode: string | null
          payment_reference: string | null
          payment_screenshot_url: string | null
          remaining_balance: number | null
          school_id: string | null
          source: string | null
          source_order_id: string | null
          source_return_id: string | null
        }
        Insert: {
          amount?: number | null
          created_at?: string | null
          created_by?: string | null
          credit_note_number?: number | null
          fy?: number | null
          id?: string | null
          note?: string | null
          payment_date?: string | null
          payment_mode?: string | null
          payment_reference?: string | null
          payment_screenshot_url?: string | null
          remaining_balance?: never
          school_id?: string | null
          source?: string | null
          source_order_id?: string | null
          source_return_id?: string | null
        }
        Update: {
          amount?: number | null
          created_at?: string | null
          created_by?: string | null
          credit_note_number?: number | null
          fy?: number | null
          id?: string | null
          note?: string | null
          payment_date?: string | null
          payment_mode?: string | null
          payment_reference?: string | null
          payment_screenshot_url?: string | null
          remaining_balance?: never
          school_id?: string | null
          source?: string | null
          source_order_id?: string | null
          source_return_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "credit_notes_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_notes_source_order_id_fkey"
            columns: ["source_order_id"]
            isOneToOne: false
            referencedRelation: "product_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_notes_source_return_id_fkey"
            columns: ["source_return_id"]
            isOneToOne: false
            referencedRelation: "product_returns"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_supplier_payment_totals: {
        Row: {
          supplier_id: string | null
          total_paid: number | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_supplier_payments_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "inventory_suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      _mirror_workflow_to_school: {
        Args: { p_project_id: string; p_school_id: string }
        Returns: undefined
      }
      acknowledge_portal_payment: {
        Args: {
          p_admin_user_id: string
          p_submission_id: string
          p_verified_amount: number
        }
        Returns: Json
      }
      active_olympiad_project: { Args: never; Returns: string }
      add_stock: {
        Args: { p_product_id: string; p_quantity: number; p_reason: string }
        Returns: Json
      }
      apply_slot_template_to_school: {
        Args: {
          p_project_id: string
          p_school_id: string
          p_template_id: string
        }
        Returns: undefined
      }
      approve_order_items: {
        Args: { p_item_ids: string[]; p_order_id: string }
        Returns: string
      }
      assign_alphabetical_school_codes_for_district: {
        Args: { p_district_code: string; p_state_code: string }
        Returns: undefined
      }
      assign_call_campaign:
        | { Args: { p_per_staff?: number; p_staff: string[] }; Returns: Json }
        | {
            Args: {
              p_per_staff?: number
              p_project_id?: string
              p_reassign?: boolean
              p_require_kit?: boolean
              p_staff: string[]
              p_state?: string
            }
            Returns: Json
          }
      assign_registration_number: {
        Args: { p_enrollment_id: string }
        Returns: string
      }
      assign_school_code: {
        Args: {
          p_district_code: string
          p_school_id: string
          p_state_code: string
        }
        Returns: string
      }
      attach_orphaned_inbound_calls: {
        Args: { p_last10: string; p_prospect_id?: string; p_school_id?: string }
        Returns: number
      }
      build_student_registration_number: {
        Args: {
          class_name: string
          project_uuid: string
          school_uuid: string
          subject_uuid: string
        }
        Returns: string
      }
      bulk_register_students_portal: {
        Args: {
          p_project_id: string
          p_registrations: Json
          p_school_id: string
        }
        Returns: Json
      }
      calculate_expected_amount: {
        Args: { p_school_id: string }
        Returns: undefined
      }
      call_campaign_cutoff: { Args: { p_project_id: string }; Returns: string }
      can_access_school_data: {
        Args: { school_district?: string }
        Returns: boolean
      }
      can_access_student_results: {
        Args: { p_school_id: string }
        Returns: boolean
      }
      check_advanced_rate_limit: {
        Args: {
          p_action: string
          p_daily_limit?: number
          p_max_requests?: number
          p_user_id: string
          p_window_minutes?: number
        }
        Returns: boolean
      }
      claim_wa_campaign_batch: {
        Args: { p_batch_size?: number; p_campaign_id: string }
        Returns: {
          id: string
          mobile: string
          prospect_school_id: string
          school_name: string
        }[]
      }
      cleanup_expired_otps: { Args: never; Returns: undefined }
      cleanup_old_audit_logs: { Args: never; Returns: undefined }
      confirm_product_order_payment: {
        Args: { p_order_id: string; p_verified_amount: number }
        Returns: undefined
      }
      correct_student_class: {
        Args: { p_new_class_code: string; p_student_id: string }
        Returns: Json
      }
      correct_student_registration: {
        Args: {
          p_corrected_by?: string
          p_correction_reason?: string
          p_new_class?: string
          p_new_subject_ids?: string[]
          p_registration_id: string
        }
        Returns: {
          message: string
          new_registration_number: string
          success: boolean
        }[]
      }
      count_not_on_whatsapp: { Args: never; Returns: number }
      create_advance_payment_credit_note: {
        Args: {
          p_amount: number
          p_note: string
          p_payment_date: string
          p_payment_mode: string
          p_payment_reference: string
          p_school_id: string
          p_screenshot_url: string
        }
        Returns: string
      }
      create_invoice: {
        Args: {
          p_buyer_address: string
          p_buyer_gstin: string
          p_buyer_name: string
          p_buyer_state: string
          p_line_items: Json
          p_payment_method: string
          p_prospect_school_id: string
          p_school_id: string
        }
        Returns: Json
      }
      create_manual_product_order: {
        Args: {
          p_credit_amount?: number
          p_credit_note_id?: string
          p_items: Json
          p_notes: string
          p_payment_account_holder_name: string
          p_payment_amount: number
          p_payment_date: string
          p_payment_mode: string
          p_payment_screenshot_url: string
          p_payment_utr_reference: string
          p_school_id: string
        }
        Returns: string
      }
      create_prospect_from_interest: {
        Args: { p_interest_id: number }
        Returns: string
      }
      create_purchase_order: {
        Args: {
          p_expected_date: string
          p_line_items: Json
          p_notes: string
          p_supplier_id: string
        }
        Returns: Json
      }
      create_stock_adjustment: {
        Args: {
          p_product_id: string
          p_quantity_delta: number
          p_reason: string
        }
        Returns: Json
      }
      delete_payment_transaction: {
        Args: { p_reason?: string; p_transaction_id: string }
        Returns: undefined
      }
      delete_pending_payment_submission: {
        Args: { p_reason?: string; p_submission_id: string }
        Returns: undefined
      }
      delete_school_from_project: {
        Args: { p_project_id: string; p_school_id: string }
        Returns: string
      }
      delete_stock_adjustment: {
        Args: { p_adjustment_id: string }
        Returns: Json
      }
      delete_student_registrations_by_school:
        | {
            Args: { p_school_id: string; p_specific_student_ids?: string[] }
            Returns: Json
          }
        | {
            Args: {
              p_school_id: string
              p_specific_people_ids?: string[]
              p_specific_student_ids?: string[]
            }
            Returns: Json
          }
      detect_suspicious_patterns: { Args: never; Returns: undefined }
      ensure_school_code: {
        Args: { p_project_id: string; p_school_id: string }
        Returns: {
          district_code: string
          school_code: string
          state_code: string
        }[]
      }
      fix_all_registration_numbers: {
        Args: never
        Returns: {
          sample_conversions: Json
          total_updated: number
        }[]
      }
      format_registration_number_display: {
        Args: { p_project_id?: string; p_registration_number: string }
        Returns: string
      }
      generate_csrf_token: { Args: never; Returns: string }
      generate_registration_number: {
        Args: {
          p_project_id: string
          p_school_id: string
          p_student_class: string
          p_subject_id: string
        }
        Returns: string
      }
      generate_registration_numbers: {
        Args: { p_project_id?: string }
        Returns: Json
      }
      get_accountant_dashboard_metrics: {
        Args: never
        Returns: {
          total_paid_schools: number
          total_payment_amount: number
          total_registrations: number
        }[]
      }
      get_accountant_payment_data: {
        Args: never
        Returns: {
          created_at: string
          district: string
          id: string
          payment_amount: number
          payment_date: string
          payment_mode: string
          registration_count: number
          school_name: string
          ss_no: number
          state: string
          updated_at: string
        }[]
      }
      get_active_registration_format: {
        Args: { p_project_id?: string }
        Returns: {
          component_order: Json
          separator: string
        }[]
      }
      get_alphabetical_student_sequence: {
        Args: {
          p_class_code: number
          p_project_id: string
          p_school_id: string
          p_student_name: string
          p_subject_id: string
        }
        Returns: number
      }
      get_audience_count:
        | {
            Args: {
              p_board?: string
              p_district?: string
              p_has_email?: boolean
              p_has_mobile?: boolean
              p_stage?: string
              p_state?: string
            }
            Returns: number
          }
        | {
            Args: {
              p_board?: string
              p_district?: string
              p_has_email?: boolean
              p_has_mobile?: boolean
              p_project_id?: string
              p_stage?: string
              p_state?: string
            }
            Returns: number
          }
      get_call_campaign_scoreboard: { Args: never; Returns: Json }
      get_call_reports: {
        Args: { p_from: string; p_to: string }
        Returns: Json
      }
      get_class_code: { Args: { p_class: string }; Returns: number }
      get_current_user_role: {
        Args: never
        Returns: Database["public"]["Enums"]["user_role"]
      }
      get_dashboard_metrics: {
        Args: never
        Returns: {
          answer_sheet_received: number
          brochure_both_physical_digital: number
          brochure_digital_sent: number
          brochure_physical_only: number
          consent_form_sent_digital: number
          consent_form_sent_physical: number
          consent_form_sent_total: number
          consent_requested: number
          contacted_no: number
          contacted_yes: number
          courier_returned: number
          courier_sent: number
          name_list_received: number
          name_list_uploaded: number
          payment_received: number
          question_paper_sent: number
          registration_confirmed: number
          registration_in_progress: number
          registration_interested: number
          registration_not_interested: number
          result_sent: number
          total_schools: number
        }[]
      }
      get_dashboard_metrics_by_date: {
        Args: { target_date: string }
        Returns: {
          answer_sheet_received: number
          communications_count: number
          consent_form_sent_digital: number
          consent_form_sent_physical: number
          consent_form_sent_total: number
          consent_requested: number
          contacted_no: number
          contacted_yes: number
          courier_returned: number
          courier_sent: number
          follow_ups_completed: number
          follow_ups_created: number
          name_list_received: number
          name_list_uploaded: number
          payment_received: number
          question_paper_sent: number
          registration_confirmed: number
          registration_interested: number
          registration_not_interested: number
          result_sent: number
          total_schools: number
        }[]
      }
      get_dashboard_metrics_by_project: {
        Args: { p_project_id?: string }
        Returns: {
          answer_sheet_received: number
          brochure_both_physical_digital: number
          brochure_digital_sent: number
          brochure_physical_only: number
          consent_form_sent_digital: number
          consent_form_sent_physical: number
          consent_form_sent_total: number
          consent_requested: number
          contacted_no: number
          contacted_yes: number
          courier_returned: number
          courier_sent: number
          name_list_received: number
          name_list_uploaded: number
          payment_received: number
          question_paper_sent: number
          registration_confirmed: number
          registration_in_progress: number
          registration_interested: number
          registration_not_interested: number
          registration_pending: number
          result_sent: number
          total_registrations: number
          total_schools: number
        }[]
      }
      get_dashboard_metrics_by_project_with_access: {
        Args: { p_project_id?: string }
        Returns: {
          answer_sheet_received: number
          brochure_both_physical_digital: number
          brochure_digital_sent: number
          brochure_physical_only: number
          consent_count_pending: number
          consent_form_sent_digital: number
          consent_form_sent_physical: number
          consent_form_sent_total: number
          consent_requested: number
          contacted_no: number
          contacted_yes: number
          courier_returned: number
          courier_sent: number
          name_list_received: number
          name_list_uploaded: number
          payment_received: number
          question_paper_sent: number
          registration_confirmed: number
          registration_in_progress: number
          registration_interested: number
          registration_not_interested: number
          registration_pending: number
          result_sent: number
          total_registrations: number
          total_schools: number
        }[]
      }
      get_dashboard_metrics_optimized: {
        Args: { p_project_id?: string }
        Returns: {
          answer_sheet_received: number
          brochure_both_physical_digital: number
          brochure_digital_sent: number
          brochure_physical_only: number
          consent_form_sent_digital: number
          consent_form_sent_physical: number
          consent_form_sent_total: number
          consent_requested: number
          contacted_no: number
          contacted_yes: number
          courier_returned: number
          courier_sent: number
          name_list_received: number
          name_list_uploaded: number
          payment_received: number
          question_paper_sent: number
          registration_confirmed: number
          registration_in_progress: number
          registration_interested: number
          registration_not_interested: number
          registration_pending: number
          result_sent: number
          total_registrations: number
          total_schools: number
        }[]
      }
      get_domain_send_stats: {
        Args: never
        Returns: {
          lifetime_sent: number
          month_sent: number
        }[]
      }
      get_enhanced_accountant_dashboard_metrics: {
        Args: never
        Returns: {
          total_concessions: number
          total_expected_amount: number
          total_outstanding: number
          total_paid_schools: number
          total_payment_amount: number
          total_registrations: number
        }[]
      }
      get_followup_queue: {
        Args: never
        Returns: {
          after_hours: boolean
          assigned_name: string
          assigned_to: string
          burst: boolean
          followup_status: string
          id: string
          last_missed_at: string
          latest_comment: string
          long_ring: boolean
          missed_count: number
          outbound_attempts: number
          phone_last10: string
          priority: string
          prospect_school_id: string
          school_id: string
          school_name: string
          snoozed_until: string
          state: string
        }[]
      }
      get_message_feed: {
        Args: { p_from?: string; p_limit?: number; p_to?: string }
        Returns: {
          channel: string
          direction: string
          event_id: string
          message: string
          party_kind: string
          party_name: string
          phone: string
          prospect_school_id: string
          school_id: string
          source: string
          status: string
          when_at: string
        }[]
      }
      get_message_reports: {
        Args: { p_from: string; p_to: string }
        Returns: Json
      }
      get_my_call_campaign: { Args: { p_close_date?: string }; Returns: Json }
      get_next_school_code: {
        Args: { p_district_code: string }
        Returns: string
      }
      get_next_ss_no: { Args: never; Returns: number }
      get_next_student_sequence:
        | {
            Args: {
              p_class_code: number
              p_project_id: string
              p_school_id: string
            }
            Returns: number
          }
        | {
            Args: {
              p_class_code: number
              p_project_id: string
              p_school_id: string
            }
            Returns: number
          }
      get_olympiad_participations: {
        Args: {
          p_class_code?: string
          p_limit?: number
          p_offset?: number
          p_olympiad_code?: string
          p_project_id: string
          p_school_id?: string
          p_search?: string
          p_slot_template_id?: string
          p_unassigned_only?: boolean
        }
        Returns: {
          class_code: string
          enrollment_id: string
          olympiad_code: string
          school_id: string
          school_name: string
          ss_no: number
          student_id: string
          student_name: string
          total_count: number
        }[]
      }
      get_olympiad_stats: {
        Args: {
          p_project_id: string
          p_slot_template_id?: string
          p_unassigned_only?: boolean
        }
        Returns: {
          subject_stats: Json
          total_participations: number
          total_schools: number
          total_students: number
        }[]
      }
      get_olympiad_subject_class_stats: {
        Args: {
          p_olympiad_code?: string
          p_project_id: string
          p_slot_template_id?: string
          p_unassigned_only?: boolean
        }
        Returns: {
          class_code: string
          count: number
          olympiad_code: string
        }[]
      }
      get_optimized_dashboard_metrics: {
        Args: { p_project_id?: string }
        Returns: {
          answer_sheet_received: number
          brochure_both_physical_digital: number
          brochure_digital_sent: number
          brochure_physical_only: number
          consent_form_sent_digital: number
          consent_form_sent_physical: number
          consent_form_sent_total: number
          consent_requested: number
          contacted_no: number
          contacted_yes: number
          courier_returned: number
          courier_sent: number
          name_list_received: number
          name_list_uploaded: number
          payment_received: number
          question_paper_sent: number
          registration_confirmed: number
          registration_in_progress: number
          registration_interested: number
          registration_not_interested: number
          result_sent: number
          total_schools: number
        }[]
      }
      get_or_create_district_code: {
        Args: { p_district_name: string; p_state_code: string }
        Returns: string
      }
      get_or_create_school_code:
        | { Args: { p_school_id: string }; Returns: string }
        | {
            Args: {
              p_district_code: string
              p_school_id: string
              p_state_code: string
            }
            Returns: string
          }
      get_or_create_state_code: {
        Args: { p_state_name: string }
        Returns: string
      }
      get_payment_transactions_for_accountant: {
        Args: never
        Returns: {
          created_at: string
          district: string
          expected_amount: number
          outstanding_balance: number
          payment_amount: number
          payment_date: string
          payment_mode: string
          registration_count: number
          school_id: string
          school_name: string
          ss_no: number
          state: string
          total_received: number
          transaction_id: string
          transaction_reference: string
        }[]
      }
      get_payment_transactions_paginated: {
        Args: { p_limit?: number; p_offset?: number; p_school_id: string }
        Returns: {
          created_at: string
          id: string
          notes: string
          payment_amount: number
          payment_date: string
          payment_mode: string
          receipt_fy: number
          receipt_number: number
          school_id: string
          transaction_reference: string
        }[]
      }
      get_portal_registration_summary: {
        Args: { p_project_id: string }
        Returns: {
          school_id: string
          school_name: string
          ss_no: number
          subject_counts: Json
        }[]
      }
      get_portal_school_id: { Args: never; Returns: string }
      get_prospect_dashboard: { Args: never; Returns: Json }
      get_prospect_districts: { Args: { p_state: string }; Returns: string[] }
      get_prospect_filter_options: { Args: never; Returns: Json }
      get_prospect_labels: {
        Args: {
          p_board?: string
          p_districts?: string[]
          p_limit?: number
          p_offset?: number
          p_only_unprinted?: boolean
          p_phone_only?: boolean
          p_project_id?: string
          p_school_location?: string
          p_search?: string
          p_state?: string
          p_urban_body_types?: string[]
        }
        Returns: {
          address: string
          district: string
          id: string
          label_printed_at: string
          mobile: string
          pincode: string
          school_name: string
          ss_no: number
          state: string
        }[]
      }
      get_prospect_labels_count: {
        Args: {
          p_board?: string
          p_districts?: string[]
          p_only_unprinted?: boolean
          p_phone_only?: boolean
          p_project_id?: string
          p_school_location?: string
          p_search?: string
          p_state?: string
          p_urban_body_types?: string[]
        }
        Returns: number
      }
      get_prospect_schools: {
        Args: {
          p_active_only?: boolean
          p_board?: string
          p_district?: string
          p_has_email?: boolean
          p_has_mobile?: boolean
          p_limit?: number
          p_max_class?: number
          p_offset?: number
          p_school_category?: string
          p_search?: string
          p_stage?: string
          p_state?: string
        }
        Returns: Json
      }
      get_registration_payment_namelist_crosstab: {
        Args: { p_project_id: string }
        Returns: {
          name_list_status: string
          payment_status: string
          registration_status: string
          school_count: number
        }[]
      }
      get_registration_totals: {
        Args: { p_project_id: string }
        Returns: {
          amount_unpaid: number
          entered: number
          paid: number
          unpaid: number
        }[]
      }
      get_school_history: {
        Args: { p_prospect_school_id: string }
        Returns: Json
      }
      get_school_project_history: {
        Args: { p_prospect_school_id: string }
        Returns: {
          book_order_total: number
          book_orders: number
          communications: number
          enrolments: number
          interest_note: string
          is_active: boolean
          payment_received: number
          payment_status: string
          project_id: string
          project_name: string
          project_year: number
          registration_status: string
          result_status: string
          status: string
          students: number
        }[]
      }
      get_school_students: {
        Args: { p_project_id: string; p_school_id: string }
        Returns: {
          class_code: number
          created_at: string
          participations: Json
          student_class: string
          student_id: string
          student_name: string
          student_sequence: number
        }[]
      }
      get_school_timeline: {
        Args: {
          p_before?: string
          p_limit?: number
          p_project_id?: string
          p_prospect_school_id: string
        }
        Returns: {
          channel: string
          detail: string
          direction: string
          happened_at: string
          project_id: string
          project_name: string
          source: string
          source_id: string
          staff_name: string
          title: string
        }[]
      }
      get_schools_with_masked_data: {
        Args: never
        Returns: {
          answer_sheet_status: Database["public"]["Enums"]["answer_sheet_status"]
          board: string
          consent_form_comment: string
          consent_form_requested: Database["public"]["Enums"]["consent_status"]
          consent_form_sent: string
          contact_person_name: string
          contacted: Database["public"]["Enums"]["contacted_status"]
          courier_status: Database["public"]["Enums"]["courier_status"]
          created_at: string
          current_project_id: string
          district: string
          email: string
          id: string
          mobile1: string
          mobile2: string
          name_list_status: Database["public"]["Enums"]["name_list_status"]
          payment_amount: number
          payment_date: string
          payment_mode: string
          payment_status: Database["public"]["Enums"]["payment_status"]
          pincode: string
          question_paper_sent: Database["public"]["Enums"]["question_paper_status"]
          registration_interest: Database["public"]["Enums"]["interest_status"]
          registration_interest_comment: string
          registration_status: Database["public"]["Enums"]["registration_status"]
          result_status: Database["public"]["Enums"]["result_status"]
          school_address: string
          school_name: string
          ss_no: number
          total_participants: number
          updated_at: string
        }[]
      }
      get_student_registrations_filtered: {
        Args: {
          p_limit?: number
          p_offset?: number
          p_project_id: string
          p_school_id?: string
          p_student_class?: string
          p_subject_id?: string
        }
        Returns: {
          created_at: string
          id: string
          project_id: string
          registration_number: string
          school_id: string
          school_name: string
          school_ss_no: number
          student_class: string
          student_name: string
          subjects: Json
        }[]
      }
      get_total_students_count: {
        Args: { p_project_id: string }
        Returns: number
      }
      get_user_role: {
        Args: { user_uuid: string }
        Returns: Database["public"]["Enums"]["user_role"]
      }
      get_wa_campaign_delivery_stats: {
        Args: { p_campaign_id: string }
        Returns: Json
      }
      get_wa_campaign_engagement: {
        Args: {
          p_campaign_id: string
          p_limit?: number
          p_offset?: number
          p_status?: string
        }
        Returns: {
          delivered_at: string
          delivery_status: string
          district: string
          id: string
          mobile: string
          opened_at: string
          replied_at: string
          reply_text: string
          school_name: string
          sent_at: string
          state: string
        }[]
      }
      get_wa_campaign_progress: {
        Args: { p_campaign_id: string }
        Returns: Json
      }
      get_whatsapp_conversations: {
        Args: { p_search?: string }
        Returns: {
          display_name: string
          last_at: string
          last_direction: string
          last_message: string
          last_status: string
          phone: string
          prospect_school_id: string
          school_id: string
          unread_count: number
        }[]
      }
      get_whatsapp_thread: {
        Args: { p_phone: string }
        Returns: {
          at: string
          direction: string
          id: string
          message: string
          status: string
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      import_interest_leads_to_project: {
        Args: { p_interest_ids: number[]; p_project_id: string }
        Returns: Json
      }
      increment_voice_campaign_counts:
        | {
            Args: { p_campaign_id: string; p_failed?: number; p_sent?: number }
            Returns: undefined
          }
        | {
            Args: {
              p_answered?: number
              p_campaign_id: string
              p_failed?: number
              p_sent?: number
            }
            Returns: undefined
          }
      initialize_project_workflow: {
        Args: { p_project_id: string }
        Returns: number
      }
      is_accountant: { Args: never; Returns: boolean }
      is_accountant_or_above: { Args: never; Returns: boolean }
      is_business_hours: { Args: never; Returns: boolean }
      is_crm_user: { Args: never; Returns: boolean }
      is_manager_or_superadmin: { Args: never; Returns: boolean }
      is_superadmin: { Args: never; Returns: boolean }
      is_superadmin_with_ip_check: { Args: never; Returns: boolean }
      issue_credit_for_return: {
        Args: { p_return_id: string }
        Returns: string
      }
      issue_credit_refund: {
        Args: {
          p_amount: number
          p_credit_note_id: string
          p_note: string
          p_refund_mode: string
          p_refund_reference: string
        }
        Returns: string
      }
      issue_item: {
        Args: {
          p_issued_to_name: string
          p_issued_to_type: string
          p_notes: string
          p_product_id: string
          p_quantity: number
        }
        Returns: Json
      }
      issue_overpayment_credit_note: {
        Args: { p_order_id: string }
        Returns: string
      }
      link_incoming_number: {
        Args: {
          p_contact_name?: string
          p_last10: string
          p_prospect_id?: string
          p_school_id?: string
        }
        Returns: Json
      }
      link_interest_to_prospect: {
        Args: { p_interest_id: number; p_prospect_school_id: string }
        Returns: undefined
      }
      list_backup_tables: { Args: never; Returns: string[] }
      log_campaign_call: {
        Args: {
          p_assignment_id: string
          p_callback_at?: string
          p_notes?: string
          p_outcome: string
          p_reached_dm?: string
          p_registrations?: number
        }
        Returns: Json
      }
      log_pii_access: {
        Args: {
          p_accessed_columns: string[]
          p_operation: string
          p_record_count?: number
          p_table_name: string
        }
        Returns: undefined
      }
      log_security_action: {
        Args: {
          p_action: string
          p_new_values?: Json
          p_old_values?: Json
          p_record_id?: string
          p_table_name: string
        }
        Returns: undefined
      }
      log_sensitive_data_access: {
        Args: {
          p_access_reason?: string
          p_operation: string
          p_record_count?: number
          p_sensitive_columns?: string[]
          p_table_name: string
        }
        Returns: undefined
      }
      map_student_class_to_code: {
        Args: { class_name: string }
        Returns: number
      }
      mark_interested_next_year: {
        Args: { p_note?: string; p_prospect_school_id: string }
        Returns: Json
      }
      mark_invoice_dispatched: {
        Args: { p_invoice_id: string }
        Returns: undefined
      }
      mark_invoice_paid: {
        Args: { p_invoice_id: string; p_paid: boolean }
        Returns: undefined
      }
      mark_not_on_whatsapp: { Args: { p_numbers: string[] }; Returns: Json }
      mark_prospect_labels_printed: {
        Args: { p_ids: string[] }
        Returns: number
      }
      mark_replacement_sent: {
        Args: { p_reference: string; p_return_id: string }
        Returns: undefined
      }
      mark_return_received: {
        Args: { p_condition: string; p_return_id: string }
        Returns: undefined
      }
      match_campaign_school_by_phone: {
        Args: { p_last10: string }
        Returns: string
      }
      match_phone_all: {
        Args: { p_last10: string }
        Returns: {
          prospect_school_id: string
          school_id: string
        }[]
      }
      migrate_current_workflow_to_table: { Args: never; Returns: number }
      migrate_registration_numbers_to_new_format: {
        Args: never
        Returns: {
          sample_new_format: string
          sample_old_format: string
          total_updated: number
        }[]
      }
      next_prospect_ss_no: { Args: never; Returns: number }
      normalize_class_code: { Args: { class_input: string }; Returns: string }
      normalize_district: { Args: { raw: string }; Returns: string }
      normalize_district_name: {
        Args: { input_district: string }
        Returns: string
      }
      normalize_state: { Args: { raw: string }; Returns: string }
      normalize_to_title_case: { Args: { input_text: string }; Returns: string }
      order_overpayment_excess: {
        Args: { p_order_id: string }
        Returns: number
      }
      parse_registration_number: {
        Args: { reg_num: string }
        Returns: {
          class_code: string
          district_code: string
          school_code: string
          state_code: string
          student_code: string
          subject_code: string
        }[]
      }
      populate_campaign_audience: {
        Args: { p_campaign_id: string }
        Returns: number
      }
      populate_exam_schedule_from_slot: {
        Args: { p_project_id: string; p_school_id: string }
        Returns: undefined
      }
      populate_voice_campaign_audience: {
        Args: { p_campaign_id: string }
        Returns: number
      }
      populate_wa_campaign_audience: {
        Args: { p_campaign_id: string }
        Returns: number
      }
      portal_registration_open: {
        Args: { p_project_id: string }
        Returns: boolean
      }
      portal_results_released: {
        Args: { p_project_id: string }
        Returns: boolean
      }
      portal_school_results: {
        Args: { p_project_id: string }
        Returns: {
          class_code: string
          enrollment_id: string
          grade: string
          max_marks: number
          olympiad_code: string
          percentage: number
          rank_district: number
          rank_national: number
          rank_school: number
          rank_state: number
          registration_number: string
          student_name: string
          total: number
        }[]
      }
      process_bulk_registration_new_format: {
        Args: {
          p_project_id: string
          p_registrations: Json
          p_school_id: string
        }
        Returns: Json
      }
      project_eligible_class_max: {
        Args: { p_project_id: string }
        Returns: number
      }
      project_for_date: { Args: { p_at: string }; Returns: string }
      recalculate_all_school_payment_totals: { Args: never; Returns: undefined }
      recalculate_school_payment_totals: {
        Args: { p_school_id: string }
        Returns: undefined
      }
      receive_grn: {
        Args: {
          p_items: Json
          p_notes: string
          p_purchase_order_id: string
          p_received_date: string
        }
        Returns: Json
      }
      recompute_school_payment_state: {
        Args: { p_project_id: string; p_school_id: string }
        Returns: undefined
      }
      refresh_prospect_stats: { Args: never; Returns: undefined }
      rehydrate_all_schools_for_project: {
        Args: { p_project_id: string }
        Returns: number
      }
      reject_entire_order: {
        Args: { p_order_id: string; p_reason: string }
        Returns: undefined
      }
      reject_order_items: {
        Args: { p_item_ids: string[]; p_order_id: string; p_reason: string }
        Returns: undefined
      }
      remove_school_from_project: {
        Args: { p_project_id: string; p_reason?: string; p_school_id: string }
        Returns: Json
      }
      report_return: {
        Args: {
          p_actual_product_id?: string
          p_invoice_line_item_id: string
          p_quantity: number
          p_reason_category: string
          p_reason_note: string
        }
        Returns: string
      }
      request_data_export_approval: {
        Args: {
          p_data_sensitivity_level?: string
          p_export_reason: string
          p_table_name: string
        }
        Returns: string
      }
      request_order_payment_resubmit: {
        Args: { p_order_id: string; p_reason: string }
        Returns: undefined
      }
      resubmit_product_order_payment: {
        Args: {
          p_order_id: string
          p_payment_account_holder_name: string
          p_payment_date: string
          p_payment_mode: string
          p_payment_screenshot_url: string
          p_payment_utr_reference: string
        }
        Returns: undefined
      }
      results_add_manual_award: {
        Args: {
          p_award_name: string
          p_enrollment_id: string
          p_note: string
          p_project_id: string
        }
        Returns: string
      }
      results_allot_awards: { Args: { p_project_id: string }; Returns: Json }
      results_basis_hash: {
        Args: {
          p_answers: string[]
          p_grace: boolean[]
          p_grade: string
          p_keys: string[]
          p_marks: number[]
          p_skills: string[]
        }
        Returns: string
      }
      results_bulk_student_skills: {
        Args: {
          p_only_needing_feedback?: boolean
          p_project_id: string
          p_school_id?: string
        }
        Returns: {
          basis_hash: string
          class_code: string
          correct: number
          enrollment_id: string
          grade: string
          olympiad_code: string
          skill: string
          total: number
        }[]
      }
      results_class_olympiad_summary: {
        Args: { p_project_id: string; p_school_id: string }
        Returns: {
          absent: number
          avg_percentage: number
          class_code: string
          class_name: string
          enrolled: number
          evaluated: number
          olympiad_code: string
          pending: number
          state_avg_percentage: number
        }[]
      }
      results_clear_resend_flag: {
        Args: { p_flag_id: string }
        Returns: boolean
      }
      results_correct_answer:
        | {
            Args: {
              p_evaluation_id: string
              p_question_number: number
              p_value: string
            }
            Returns: undefined
          }
        | {
            Args: {
              p_evaluation_id: string
              p_question_number: number
              p_reason: string
              p_value: string
            }
            Returns: undefined
          }
      results_delete_evaluations: {
        Args: { p_enrollment_ids: string[] }
        Returns: number
      }
      results_digits: { Args: { p: string }; Returns: string }
      results_feedback_basis_hash: {
        Args: { p_enrollment_id: string }
        Returns: string
      }
      results_feedback_status: {
        Args: { p_project_id: string; p_school_id?: string }
        Returns: {
          enrollment_id: string
          has_feedback: boolean
          is_outdated: boolean
        }[]
      }
      results_find_enrollment: {
        Args: { p_project_id: string; p_reg: string }
        Returns: {
          class_code: string
          enrollment_id: string
          olympiad_code: string
          registration_number: string
          school_name: string
          student_name: string
        }[]
      }
      results_group_key: {
        Args: {
          p_class_code: string
          p_olympiad_code: string
          p_project_id: string
        }
        Returns: number
      }
      results_integrity_scan: { Args: { p_project_id: string }; Returns: Json }
      results_lock_group: {
        Args: {
          p_class_code: string
          p_olympiad_code: string
          p_project_id: string
        }
        Returns: undefined
      }
      results_lock_school_groups: {
        Args: { p_project_id: string; p_school_ids: string[] }
        Returns: undefined
      }
      results_olympiad_label: { Args: { p_code: string }; Returns: string }
      results_paper_skill_keys: {
        Args: { p_paper_ids: string[] }
        Returns: {
          grace: boolean[]
          keys: string[]
          paper_id: string
          skills: string[]
        }[]
      }
      results_rank_list: {
        Args: {
          p_class_code: string
          p_district_key?: string
          p_limit?: number
          p_offset?: number
          p_olympiad_code: string
          p_project_id: string
          p_school_id?: string
          p_state_code?: string
        }
        Returns: {
          class_code: string
          district_key: string
          district_name: string
          enrollment_id: string
          grade: string
          max_marks: number
          olympiad_code: string
          percentage: number
          rank_district: number
          rank_national: number
          rank_school: number
          rank_state: number
          registration_number: string
          school_id: string
          school_name: string
          state_code: string
          state_name: string
          student_name: string
          total: number
          total_count: number
        }[]
      }
      results_registered_vs_evaluated: {
        Args: { p_project_id: string }
        Returns: {
          absent: number
          class_code: string
          evaluated: number
          olympiad_code: string
          pending: number
          registered: number
          school_id: string
          school_name: string
        }[]
      }
      results_release_schools: {
        Args: { p_notes: string; p_project_id: string; p_school_ids: string[] }
        Returns: number
      }
      results_released_school_ids: {
        Args: { p_project_id: string }
        Returns: string[]
      }
      results_remove_award: {
        Args: { p_award_id: string; p_note: string }
        Returns: undefined
      }
      results_rerank: {
        Args: {
          p_class_code: string
          p_olympiad_code: string
          p_project_id: string
        }
        Returns: undefined
      }
      results_rerank_core: {
        Args: {
          p_class_code: string
          p_olympiad_code: string
          p_project_id: string
        }
        Returns: undefined
      }
      results_rescore_paper: {
        Args: { p_paper_id: string }
        Returns: undefined
      }
      results_rescore_paper_core: {
        Args: { p_paper_id: string }
        Returns: undefined
      }
      results_restore_award: {
        Args: { p_award_id: string }
        Returns: undefined
      }
      results_restore_evaluation: {
        Args: { p_evaluation_id: string }
        Returns: undefined
      }
      results_review_integrity_flag: {
        Args: { p_flag_id: string; p_notes: string; p_status: string }
        Returns: undefined
      }
      results_school_grade: {
        Args: { p_avg_percentage: number }
        Returns: string
      }
      results_school_summary: {
        Args: { p_project_id: string }
        Returns: {
          absent: number
          avg_percentage: number
          enrolled: number
          evaluated: number
          pending: number
          released: boolean
          resend_flag: boolean
          school_grade: string
          school_id: string
          school_name: string
          state_avg_percentage: number
          state_code: string
          state_name: string
        }[]
      }
      results_score_combinations: {
        Args: { p_project_id: string }
        Returns: {
          class_code: string
          olympiad_code: string
          students: number
        }[]
      }
      results_set_absent: {
        Args: {
          p_absent: boolean
          p_enrollment_ids: string[]
          p_paper_id: string
        }
        Returns: number
      }
      results_skill_credit: {
        Args: {
          p_answers: string[]
          p_grace: boolean[]
          p_keys: string[]
          p_marks: number[]
          p_skills: string[]
        }
        Returns: {
          correct: number
          first_q: number
          skill: string
          total: number
        }[]
      }
      results_skill_summary: {
        Args: {
          p_class_code: string
          p_olympiad_code: string
          p_project_id: string
          p_school_id: string
        }
        Returns: {
          school_pct: number
          skill: string
          state_pct: number
          students: number
        }[]
      }
      results_stage_send: {
        Args: {
          p_channel: string
          p_project_id: string
          p_school_ids: string[]
          p_test_target: string
        }
        Returns: string
      }
      results_student_grade: { Args: { p_percentage: number }; Returns: string }
      results_student_list: {
        Args: {
          p_class_code: string
          p_limit: number
          p_offset: number
          p_olympiad_code: string
          p_project_id: string
          p_school_id: string
          p_search: string
          p_status: string
        }
        Returns: {
          class_code: string
          deleted_at: string
          enrollment_id: string
          evaluation_id: string
          grade: string
          olympiad_code: string
          paper_id: string
          percentage: number
          registration_number: string
          school_id: string
          school_name: string
          status: string
          student_name: string
          total: number
          total_count: number
        }[]
      }
      results_student_skills: {
        Args: { p_enrollment_id: string }
        Returns: {
          correct: number
          percentage: number
          skill: string
          total: number
        }[]
      }
      results_unrelease_school: {
        Args: { p_project_id: string; p_school_id: string }
        Returns: number
      }
      results_upload: {
        Args: {
          p_dry_run: boolean
          p_file_name: string
          p_kind: string
          p_paper_id: string
          p_rows: Json
        }
        Returns: Json
      }
      results_upload_parse: {
        Args: { p_kind: string; p_paper_id: string; p_rows: Json }
        Returns: {
          answers: string[]
          bad: Json
          digits: string
          dup_first_row: number
          enr_class: string
          enr_olympiad: string
          enrollment_id: string
          marks: number[]
          n_values: number
          ord: number
          reg: string
          reg_stored: string
          row_no: number
          school_id: string
          student_name: string
        }[]
      }
      retry_registration_numbers: {
        Args: { p_enrollment_ids: string[] }
        Returns: {
          enrollment_id: string
          error_message: string
          registration_number: string
          success: boolean
        }[]
      }
      safe_boolean_cast: { Args: { input_value: string }; Returns: boolean }
      sanitize_jsonb_for_student: {
        Args: { input_json: Json; student_name: string }
        Returns: Json
      }
      sanitize_text_for_student: {
        Args: { input_text: string; student_name: string }
        Returns: string
      }
      school_removal_blockers: {
        Args: { p_project_id: string; p_school_id: string }
        Returns: Json
      }
      search_callers_by_name: {
        Args: { p_limit?: number; p_query: string }
        Returns: {
          district: string
          id: string
          school_name: string
          source: string
          ss_no: number
          state: string
        }[]
      }
      search_schools_case_insensitive: {
        Args: {
          board_filter?: string
          district_filter?: string
          limit_count?: number
          name_list_filter?: string
          offset_count?: number
          payment_filter?: string
          project_filter?: string
          search_term?: string
          state_filter?: string
          status_filter?: string
          workflow_filter?: string
        }
        Returns: {
          address1: string
          address2: string
          answer_sheet_status: Database["public"]["Enums"]["answer_sheet_status"]
          board: string
          brochure_delivery_status: Database["public"]["Enums"]["brochure_delivery_status"]
          concession_per_entry: number
          consent_form_comment: string
          consent_form_requested: Database["public"]["Enums"]["consent_status"]
          consent_form_sent: string
          contact_person_name: string
          contacted: Database["public"]["Enums"]["contacted_status"]
          courier_status: Database["public"]["Enums"]["courier_status"]
          created_at: string
          current_project_id: string
          district: string
          effective_rate_per_entry: number
          email: string
          expected_amount: number
          id: string
          mobile1: string
          mobile2: string
          name_list_status: Database["public"]["Enums"]["name_list_status"]
          outstanding_balance: number
          payment_amount: number
          payment_date: string
          payment_mode: string
          payment_received: number
          payment_status: Database["public"]["Enums"]["payment_status"]
          per_entry_rate: number
          pincode: string
          portal_registered: boolean
          question_paper_sent: Database["public"]["Enums"]["question_paper_status"]
          registration_interest: Database["public"]["Enums"]["interest_status"]
          registration_interest_comment: string
          registration_status: Database["public"]["Enums"]["registration_status"]
          result_status: Database["public"]["Enums"]["result_status"]
          school_address: string
          school_name: string
          ss_no: number
          state: string
          total_count: number
          total_participants: number
          updated_at: string
        }[]
      }
      search_schools_case_insensitive_v2: {
        Args: {
          board_filter?: string
          district_filter?: string
          limit_count?: number
          offset_count?: number
          payment_filter?: string
          project_filter?: string
          search_term?: string
          state_filter?: string
          status_filter?: string
          workflow_filter?: string
        }
        Returns: {
          board: string
          contact_person_name: string
          contacted: Database["public"]["Enums"]["contacted_status"]
          courier_status: Database["public"]["Enums"]["courier_status"]
          created_at: string
          current_project_id: string
          district: string
          email: string
          expected_amount: number
          id: string
          mobile1: string
          mobile2: string
          name_list_status: Database["public"]["Enums"]["name_list_status"]
          outstanding_balance: number
          payment_amount: number
          payment_date: string
          payment_received: number
          payment_status: Database["public"]["Enums"]["payment_status"]
          per_entry_rate: number
          pincode: string
          registration_interest: Database["public"]["Enums"]["interest_status"]
          registration_status: Database["public"]["Enums"]["registration_status"]
          school_address: string
          school_name: string
          ss_no: number
          state: string
          total_count: number
          updated_at: string
        }[]
      }
      search_schools_for_invoice: {
        Args: { p_limit?: number; p_query: string }
        Returns: {
          address: string
          district: string
          id: string
          school_name: string
          source: string
          ss_no: number
          state: string
        }[]
      }
      search_schools_optimized: {
        Args: {
          p_district?: string
          p_limit?: number
          p_offset?: number
          p_search_term?: string
          p_state?: string
          p_status?: string
        }
        Returns: {
          board: string
          contact_person_name: string
          district: string
          email: string
          id: string
          mobile1: string
          mobile2: string
          name_list_status: Database["public"]["Enums"]["name_list_status"]
          payment_status: Database["public"]["Enums"]["payment_status"]
          registration_status: Database["public"]["Enums"]["registration_status"]
          school_address: string
          school_name: string
          ss_no: number
          state: string
          total_count: number
        }[]
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      submit_olympiad_interest: {
        Args: {
          p_contact_name: string
          p_contact_phone: string
          p_district: string
          p_for_year: number
          p_hp?: string
          p_school_email: string
          p_school_mobile: string
          p_school_name: string
          p_state: string
        }
        Returns: undefined
      }
      submit_product_order: {
        Args: {
          p_items: Json
          p_notes: string
          p_payment_account_holder_name: string
          p_payment_amount: number
          p_payment_date: string
          p_payment_mode: string
          p_payment_screenshot_url: string
          p_payment_utr_reference: string
          p_school_id: string
        }
        Returns: string
      }
      submit_student_list: {
        Args: { p_project_id: string; p_school_id: string }
        Returns: Json
      }
      switch_active_project: {
        Args: { p_project_id: string }
        Returns: undefined
      }
      sync_prospect_from_school: {
        Args: { p_school_id: string }
        Returns: undefined
      }
      tag_as_other_contact: {
        Args: {
          p_category: string
          p_last10: string
          p_name: string
          p_notes?: string
        }
        Returns: Json
      }
      test_registration_number_generation: {
        Args: {
          p_project_id: string
          p_school_id: string
          p_student_class: string
          p_subject_id: string
        }
        Returns: string
      }
      unaccent: { Args: { "": string }; Returns: string }
      unmark_first_prospect_labels_printed: {
        Args: { p_count: number; p_state: string }
        Returns: number
      }
      unmark_last_prospect_labels_printed: {
        Args: { p_count: number; p_state: string }
        Returns: number
      }
      untag_other_contact: { Args: { p_last10: string }; Returns: Json }
      update_invoice: {
        Args: {
          p_buyer_address: string
          p_buyer_gstin: string
          p_buyer_name: string
          p_buyer_state: string
          p_invoice_id: string
          p_line_items: Json
          p_payment_method: string
        }
        Returns: Json
      }
      update_manual_order_items: {
        Args: {
          p_items: Json
          p_new_payment_amount?: number
          p_new_payment_date?: string
          p_order_id: string
        }
        Returns: number
      }
      update_order_payment_details: {
        Args: {
          p_note: string
          p_order_id: string
          p_payment_account_holder_name: string
          p_payment_amount: number
          p_payment_date: string
          p_payment_mode: string
          p_payment_screenshot_url: string
          p_payment_utr_reference: string
        }
        Returns: undefined
      }
      update_registration_numbers_batch: {
        Args: { batch_size?: number }
        Returns: {
          processed_count: number
        }[]
      }
      update_school_namelist_status: {
        Args: { p_school_id: string }
        Returns: undefined
      }
      update_school_with_manual_edit: {
        Args: { p_school_id: string; p_updates: Json }
        Returns: undefined
      }
      validate_csrf_token: {
        Args: { token_to_validate: string }
        Returns: boolean
      }
      validate_email_domain_new_only: {
        Args: { email_address: string }
        Returns: boolean
      }
      validate_iplusedu_email_domain: {
        Args: { email_address: string }
        Returns: boolean
      }
      validate_sensitive_operation: {
        Args: { p_operation: string; p_table_name?: string }
        Returns: boolean
      }
      void_invoice: {
        Args: { p_invoice_id: string; p_reason: string }
        Returns: undefined
      }
    }
    Enums: {
      answer_sheet_status: "Waiting" | "Received"
      app_role: "super_admin" | "user"
      brochure_delivery_status:
        | "Physical Only"
        | "Digital Sent"
        | "Both Physical & Digital"
      class_type: "LKG" | "UKG" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8"
      communication_type: "Phone" | "Email" | "WhatsApp" | "AI Call"
      consent_status: "Yes" | "No"
      contacted_status: "Yes" | "No"
      courier_status: "Sent" | "Returned" | "Delivered"
      interest_status: "Interested" | "Not Interested"
      name_list_status: "Pending" | "Received" | "Uploaded"
      payment_status: "Pending" | "Received" | "Partial" | "Overpaid"
      question_paper_status: "Sent" | "Not Sent"
      registration_status: "Pending" | "Confirmed" | "In Progress"
      result_status: "Sent" | "Not Sent"
      user_role: "superadmin" | "manager" | "accountant"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      answer_sheet_status: ["Waiting", "Received"],
      app_role: ["super_admin", "user"],
      brochure_delivery_status: [
        "Physical Only",
        "Digital Sent",
        "Both Physical & Digital",
      ],
      class_type: ["LKG", "UKG", "1", "2", "3", "4", "5", "6", "7", "8"],
      communication_type: ["Phone", "Email", "WhatsApp", "AI Call"],
      consent_status: ["Yes", "No"],
      contacted_status: ["Yes", "No"],
      courier_status: ["Sent", "Returned", "Delivered"],
      interest_status: ["Interested", "Not Interested"],
      name_list_status: ["Pending", "Received", "Uploaded"],
      payment_status: ["Pending", "Received", "Partial", "Overpaid"],
      question_paper_status: ["Sent", "Not Sent"],
      registration_status: ["Pending", "Confirmed", "In Progress"],
      result_status: ["Sent", "Not Sent"],
      user_role: ["superadmin", "manager", "accountant"],
    },
  },
} as const
