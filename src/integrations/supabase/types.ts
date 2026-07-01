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
    PostgrestVersion: "13.0.4"
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
      communication_templates: {
        Row: {
          created_at: string
          created_by: string
          email_body: string
          id: string
          is_active: boolean
          parent_template_id: string | null
          project_id: string | null
          subject: string
          template_name: string
          template_type: string
          updated_at: string
          whatsapp_message: string | null
        }
        Insert: {
          created_at?: string
          created_by: string
          email_body: string
          id?: string
          is_active?: boolean
          parent_template_id?: string | null
          project_id?: string | null
          subject: string
          template_name: string
          template_type: string
          updated_at?: string
          whatsapp_message?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string
          email_body?: string
          id?: string
          is_active?: boolean
          parent_template_id?: string | null
          project_id?: string | null
          subject?: string
          template_name?: string
          template_type?: string
          updated_at?: string
          whatsapp_message?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "communication_templates_parent_template_id_fkey"
            columns: ["parent_template_id"]
            isOneToOne: false
            referencedRelation: "communication_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "communication_templates_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "olympiad_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      communications: {
        Row: {
          communication_type: Database["public"]["Enums"]["communication_type"]
          contacted_mobile_no: string | null
          contacted_person_name: string | null
          created_at: string
          designation: string | null
          email_status: string | null
          id: string
          message: string
          project_id: string
          school_id: string
          template_type: string | null
          user_id: string
        }
        Insert: {
          communication_type: Database["public"]["Enums"]["communication_type"]
          contacted_mobile_no?: string | null
          contacted_person_name?: string | null
          created_at?: string
          designation?: string | null
          email_status?: string | null
          id?: string
          message: string
          project_id: string
          school_id: string
          template_type?: string | null
          user_id: string
        }
        Update: {
          communication_type?: Database["public"]["Enums"]["communication_type"]
          contacted_mobile_no?: string | null
          contacted_person_name?: string | null
          created_at?: string
          designation?: string | null
          email_status?: string | null
          id?: string
          message?: string
          project_id?: string
          school_id?: string
          template_type?: string | null
          user_id?: string
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
            foreignKeyName: "fk_communications_school_id"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_communications_user_id"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      consent_forms: {
        Row: {
          class: Database["public"]["Enums"]["class_type"]
          created_at: string
          forms_requested: number
          id: string
          project_id: string
          school_id: string
          updated_at: string
        }
        Insert: {
          class: Database["public"]["Enums"]["class_type"]
          created_at?: string
          forms_requested?: number
          id?: string
          project_id: string
          school_id: string
          updated_at?: string
        }
        Update: {
          class?: Database["public"]["Enums"]["class_type"]
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
            foreignKeyName: "fk_district_state_code"
            columns: ["state_code"]
            isOneToOne: false
            referencedRelation: "state_codes"
            referencedColumns: ["state_code"]
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
          created_at: string | null
          created_by: string
          follow_up_date: string
          follow_up_time: string
          id: string
          project_id: string
          school_id: string
          status: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          created_by: string
          follow_up_date: string
          follow_up_time: string
          id?: string
          project_id: string
          school_id: string
          status?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string
          follow_up_date?: string
          follow_up_time?: string
          id?: string
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
      olympiad_projects: {
        Row: {
          created_at: string
          created_by: string
          id: string
          is_active: boolean
          project_name: string
          project_year: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          is_active?: boolean
          project_name: string
          project_year: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          is_active?: boolean
          project_name?: string
          project_year?: number
          updated_at?: string
        }
        Relationships: []
      }
      olympiad_results: {
        Row: {
          certificate_number: string | null
          created_at: string
          created_by: string
          grade: string | null
          id: string
          marks_obtained: number | null
          percentage: number | null
          rank_in_district: number | null
          rank_in_school: number | null
          rank_overall: number | null
          registration_id: string
          result_status: string
          total_marks: number
          updated_at: string
        }
        Insert: {
          certificate_number?: string | null
          created_at?: string
          created_by: string
          grade?: string | null
          id?: string
          marks_obtained?: number | null
          percentage?: number | null
          rank_in_district?: number | null
          rank_in_school?: number | null
          rank_overall?: number | null
          registration_id: string
          result_status?: string
          total_marks?: number
          updated_at?: string
        }
        Update: {
          certificate_number?: string | null
          created_at?: string
          created_by?: string
          grade?: string | null
          id?: string
          marks_obtained?: number | null
          percentage?: number | null
          rank_in_district?: number | null
          rank_in_school?: number | null
          rank_overall?: number | null
          registration_id?: string
          result_status?: string
          total_marks?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "olympiad_results_registration_id_fkey"
            columns: ["registration_id"]
            isOneToOne: true
            referencedRelation: "student_registrations"
            referencedColumns: ["id"]
          },
        ]
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
      receipt_numbers: {
        Row: {
          generated_at: string
          id: string
          payment_transaction_id: string
          receipt_number: number
        }
        Insert: {
          generated_at?: string
          id?: string
          payment_transaction_id: string
          receipt_number: number
        }
        Update: {
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
      school_codes: {
        Row: {
          assigned_at: string
          district_code: string
          id: string
          is_active: boolean
          school_code: string
          school_id: string
          state_code: string
        }
        Insert: {
          assigned_at?: string
          district_code: string
          id?: string
          is_active?: boolean
          school_code: string
          school_id: string
          state_code: string
        }
        Update: {
          assigned_at?: string
          district_code?: string
          id?: string
          is_active?: boolean
          school_code?: string
          school_id?: string
          state_code?: string
        }
        Relationships: []
      }
      school_project_workflow: {
        Row: {
          answer_sheet_status:
            | Database["public"]["Enums"]["answer_sheet_status"]
            | null
          brochure_delivery_status:
            | Database["public"]["Enums"]["brochure_delivery_status"]
            | null
          concession_per_entry: number | null
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
          concession_per_entry?: number | null
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
          concession_per_entry?: number | null
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
      schools: {
        Row: {
          answer_sheet_status:
            | Database["public"]["Enums"]["answer_sheet_status"]
            | null
          board: string
          brochure_delivery_status:
            | Database["public"]["Enums"]["brochure_delivery_status"]
            | null
          concession_per_entry: number | null
          consent_form_comment: string | null
          consent_form_requested:
            | Database["public"]["Enums"]["consent_status"]
            | null
          consent_form_sent: string | null
          contact_person_name: string | null
          contacted: Database["public"]["Enums"]["contacted_status"] | null
          courier_status: Database["public"]["Enums"]["courier_status"] | null
          created_at: string
          current_project_id: string | null
          district: string
          effective_rate_per_entry: number | null
          email: string | null
          expected_amount: number | null
          id: string
          mobile1: string | null
          mobile2: string | null
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
          ss_no: number
          state: string | null
          total_participants: number | null
          updated_at: string
        }
        Insert: {
          answer_sheet_status?:
            | Database["public"]["Enums"]["answer_sheet_status"]
            | null
          board: string
          brochure_delivery_status?:
            | Database["public"]["Enums"]["brochure_delivery_status"]
            | null
          concession_per_entry?: number | null
          consent_form_comment?: string | null
          consent_form_requested?:
            | Database["public"]["Enums"]["consent_status"]
            | null
          consent_form_sent?: string | null
          contact_person_name?: string | null
          contacted?: Database["public"]["Enums"]["contacted_status"] | null
          courier_status?: Database["public"]["Enums"]["courier_status"] | null
          created_at?: string
          current_project_id?: string | null
          district: string
          effective_rate_per_entry?: number | null
          email?: string | null
          expected_amount?: number | null
          id?: string
          mobile1?: string | null
          mobile2?: string | null
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
          ss_no: number
          state?: string | null
          total_participants?: number | null
          updated_at?: string
        }
        Update: {
          answer_sheet_status?:
            | Database["public"]["Enums"]["answer_sheet_status"]
            | null
          board?: string
          brochure_delivery_status?:
            | Database["public"]["Enums"]["brochure_delivery_status"]
            | null
          concession_per_entry?: number | null
          consent_form_comment?: string | null
          consent_form_requested?:
            | Database["public"]["Enums"]["consent_status"]
            | null
          consent_form_sent?: string | null
          contact_person_name?: string | null
          contacted?: Database["public"]["Enums"]["contacted_status"] | null
          courier_status?: Database["public"]["Enums"]["courier_status"] | null
          created_at?: string
          current_project_id?: string | null
          district?: string
          effective_rate_per_entry?: number | null
          email?: string | null
          expected_amount?: number | null
          id?: string
          mobile1?: string | null
          mobile2?: string | null
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
          ss_no?: number
          state?: string | null
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
            foreignKeyName: "fk_student_subjects_olympiad_subjects"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "olympiad_subjects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_subjects_registration_id_fkey"
            columns: ["registration_id"]
            isOneToOne: false
            referencedRelation: "student_registrations"
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      _mirror_workflow_to_school: {
        Args: { p_project_id: string; p_school_id: string }
        Returns: undefined
      }
      assign_alphabetical_school_codes_for_district: {
        Args: { p_district_code: string; p_state_code: string }
        Returns: undefined
      }
      assign_school_code: {
        Args: {
          p_district_code: string
          p_school_id: string
          p_state_code: string
        }
        Returns: string
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
      calculate_expected_amount: {
        Args: { p_school_id: string }
        Returns: undefined
      }
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
      cleanup_expired_otps: { Args: never; Returns: undefined }
      cleanup_old_audit_logs: { Args: never; Returns: undefined }
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
          payment_reference: string
          receipt_number: number
          school_id: string
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
      initialize_project_workflow: {
        Args: { p_project_id: string }
        Returns: number
      }
      is_accountant: { Args: never; Returns: boolean }
      is_accountant_or_above: { Args: never; Returns: boolean }
      is_business_hours: { Args: never; Returns: boolean }
      is_manager_or_superadmin: { Args: never; Returns: boolean }
      is_superadmin: { Args: { user_uuid: string }; Returns: boolean }
      is_superadmin_with_ip_check: { Args: never; Returns: boolean }
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
      migrate_current_workflow_to_table: { Args: never; Returns: number }
      migrate_registration_numbers_to_new_format: {
        Args: never
        Returns: {
          sample_new_format: string
          sample_old_format: string
          total_updated: number
        }[]
      }
      normalize_district_name: {
        Args: { input_district: string }
        Returns: string
      }
      normalize_to_title_case: { Args: { input_text: string }; Returns: string }
      process_bulk_registration_new_format: {
        Args: {
          p_project_id: string
          p_registrations: Json
          p_school_id: string
        }
        Returns: Json
      }
      recalculate_all_school_payment_totals: { Args: never; Returns: undefined }
      recalculate_school_payment_totals: {
        Args: { p_school_id: string }
        Returns: undefined
      }
      rehydrate_all_schools_for_project: {
        Args: { p_project_id: string }
        Returns: number
      }
      request_data_export_approval: {
        Args: {
          p_data_sensitivity_level?: string
          p_export_reason: string
          p_table_name: string
        }
        Returns: string
      }
      safe_boolean_cast: { Args: { input_value: string }; Returns: boolean }
      search_schools_case_insensitive: {
        Args: {
          board_filter?: string
          district_filter?: string
          limit_count?: number
          offset_count?: number
          payment_filter?: string
          search_term?: string
          state_filter?: string
          status_filter?: string
          workflow_filter?: string
        }
        Returns: {
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
      switch_active_project: {
        Args: { p_project_id: string }
        Returns: undefined
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
    }
    Enums: {
      answer_sheet_status: "Waiting" | "Received"
      brochure_delivery_status:
        | "Physical Only"
        | "Digital Sent"
        | "Both Physical & Digital"
      class_type: "LKG" | "UKG" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8"
      communication_type: "Phone" | "Email" | "WhatsApp"
      consent_status: "Yes" | "No"
      contacted_status: "Yes" | "No"
      courier_status: "Sent" | "Delivered" | "Returned"
      interest_status: "Interested" | "Not Interested"
      name_list_status: "Pending" | "Received" | "Uploaded"
      payment_status: "Pending" | "Received" | "Partial"
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      answer_sheet_status: ["Waiting", "Received"],
      brochure_delivery_status: [
        "Physical Only",
        "Digital Sent",
        "Both Physical & Digital",
      ],
      class_type: ["LKG", "UKG", "1", "2", "3", "4", "5", "6", "7", "8"],
      communication_type: ["Phone", "Email", "WhatsApp"],
      consent_status: ["Yes", "No"],
      contacted_status: ["Yes", "No"],
      courier_status: ["Sent", "Delivered", "Returned"],
      interest_status: ["Interested", "Not Interested"],
      name_list_status: ["Pending", "Received", "Uploaded"],
      payment_status: ["Pending", "Received", "Partial"],
      question_paper_status: ["Sent", "Not Sent"],
      registration_status: ["Pending", "Confirmed", "In Progress"],
      result_status: ["Sent", "Not Sent"],
      user_role: ["superadmin", "manager", "accountant"],
    },
  },
} as const
