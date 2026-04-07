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
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      appointment_actions: {
        Row: {
          action_block_id: string
          appointment_id: string
          completed_at: string | null
          created_at: string
          error_message: string | null
          fired_at: string | null
          id: string
          result: Json | null
          scheduled_for: string
          status: Database["public"]["Enums"]["action_status"]
          updated_at: string
          workflow_run_id: string | null
        }
        Insert: {
          action_block_id: string
          appointment_id: string
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          fired_at?: string | null
          id?: string
          result?: Json | null
          scheduled_for: string
          status?: Database["public"]["Enums"]["action_status"]
          updated_at?: string
          workflow_run_id?: string | null
        }
        Update: {
          action_block_id?: string
          appointment_id?: string
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          fired_at?: string | null
          id?: string
          result?: Json | null
          scheduled_for?: string
          status?: Database["public"]["Enums"]["action_status"]
          updated_at?: string
          workflow_run_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "appointment_actions_action_block_id_fkey"
            columns: ["action_block_id"]
            isOneToOne: false
            referencedRelation: "workflow_action_blocks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_actions_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_actions_workflow_run_id_fkey"
            columns: ["workflow_run_id"]
            isOneToOne: false
            referencedRelation: "appointment_workflow_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      appointment_types: {
        Row: {
          created_at: string
          default_fee_cents: number
          duration_minutes: number
          id: string
          modality: Database["public"]["Enums"]["appointment_modality"]
          name: string
          org_id: string
          pms_external_id: string | null
          pms_provider: string | null
          source: Database["public"]["Enums"]["appointment_type_source"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          default_fee_cents?: number
          duration_minutes?: number
          id?: string
          modality?: Database["public"]["Enums"]["appointment_modality"]
          name: string
          org_id: string
          pms_external_id?: string | null
          pms_provider?: string | null
          source?: Database["public"]["Enums"]["appointment_type_source"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          default_fee_cents?: number
          duration_minutes?: number
          id?: string
          modality?: Database["public"]["Enums"]["appointment_modality"]
          name?: string
          org_id?: string
          pms_external_id?: string | null
          pms_provider?: string | null
          source?: Database["public"]["Enums"]["appointment_type_source"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointment_types_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
        ]
      }
      appointment_workflow_runs: {
        Row: {
          appointment_id: string
          completed_at: string | null
          created_at: string
          direction: Database["public"]["Enums"]["workflow_direction"]
          id: string
          started_at: string
          status: Database["public"]["Enums"]["workflow_run_status"]
          updated_at: string
          workflow_template_id: string
        }
        Insert: {
          appointment_id: string
          completed_at?: string | null
          created_at?: string
          direction: Database["public"]["Enums"]["workflow_direction"]
          id?: string
          started_at?: string
          status?: Database["public"]["Enums"]["workflow_run_status"]
          updated_at?: string
          workflow_template_id: string
        }
        Update: {
          appointment_id?: string
          completed_at?: string | null
          created_at?: string
          direction?: Database["public"]["Enums"]["workflow_direction"]
          id?: string
          started_at?: string
          status?: Database["public"]["Enums"]["workflow_run_status"]
          updated_at?: string
          workflow_template_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointment_workflow_runs_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_workflow_runs_workflow_template_id_fkey"
            columns: ["workflow_template_id"]
            isOneToOne: false
            referencedRelation: "workflow_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      appointments: {
        Row: {
          appointment_type_id: string | null
          clinician_id: string | null
          created_at: string
          id: string
          location_id: string
          org_id: string
          patient_id: string | null
          phone_number: string | null
          pms_external_id: string | null
          room_id: string | null
          scheduled_at: string
          status: Database["public"]["Enums"]["appointment_status"]
          updated_at: string
        }
        Insert: {
          appointment_type_id?: string | null
          clinician_id?: string | null
          created_at?: string
          id?: string
          location_id: string
          org_id: string
          patient_id?: string | null
          phone_number?: string | null
          pms_external_id?: string | null
          room_id?: string | null
          scheduled_at: string
          status?: Database["public"]["Enums"]["appointment_status"]
          updated_at?: string
        }
        Update: {
          appointment_type_id?: string | null
          clinician_id?: string | null
          created_at?: string
          id?: string
          location_id?: string
          org_id?: string
          patient_id?: string | null
          phone_number?: string | null
          pms_external_id?: string | null
          room_id?: string | null
          scheduled_at?: string
          status?: Database["public"]["Enums"]["appointment_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointments_appointment_type_id_fkey"
            columns: ["appointment_type_id"]
            isOneToOne: false
            referencedRelation: "appointment_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_clinician_id_fkey"
            columns: ["clinician_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      clinician_room_assignments: {
        Row: {
          created_at: string
          id: string
          room_id: string
          staff_assignment_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          room_id: string
          staff_assignment_id: string
        }
        Update: {
          created_at?: string
          id?: string
          room_id?: string
          staff_assignment_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "clinician_room_assignments_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clinician_room_assignments_staff_assignment_id_fkey"
            columns: ["staff_assignment_id"]
            isOneToOne: false
            referencedRelation: "staff_assignments"
            referencedColumns: ["id"]
          },
        ]
      }
      form_assignments: {
        Row: {
          appointment_id: string | null
          completed_at: string | null
          created_at: string
          form_id: string
          id: string
          opened_at: string | null
          patient_id: string
          schema_snapshot: Json
          sent_at: string | null
          status: string
          submission_id: string | null
          token: string
          updated_at: string
        }
        Insert: {
          appointment_id?: string | null
          completed_at?: string | null
          created_at?: string
          form_id: string
          id?: string
          opened_at?: string | null
          patient_id: string
          schema_snapshot?: Json
          sent_at?: string | null
          status?: string
          submission_id?: string | null
          token?: string
          updated_at?: string
        }
        Update: {
          appointment_id?: string | null
          completed_at?: string | null
          created_at?: string
          form_id?: string
          id?: string
          opened_at?: string | null
          patient_id?: string
          schema_snapshot?: Json
          sent_at?: string | null
          status?: string
          submission_id?: string | null
          token?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "form_assignments_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "form_assignments_form_id_fkey"
            columns: ["form_id"]
            isOneToOne: false
            referencedRelation: "forms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "form_assignments_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "form_assignments_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "form_submissions"
            referencedColumns: ["id"]
          },
        ]
      }
      form_fields: {
        Row: {
          created_at: string
          field_type: string
          form_id: string
          id: string
          is_required: boolean
          label: string
          options: Json | null
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          field_type: string
          form_id: string
          id?: string
          is_required?: boolean
          label: string
          options?: Json | null
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          field_type?: string
          form_id?: string
          id?: string
          is_required?: boolean
          label?: string
          options?: Json | null
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "form_fields_form_id_fkey"
            columns: ["form_id"]
            isOneToOne: false
            referencedRelation: "forms"
            referencedColumns: ["id"]
          },
        ]
      }
      form_submissions: {
        Row: {
          appointment_id: string | null
          created_at: string
          form_id: string
          id: string
          patient_id: string
          responses: Json
        }
        Insert: {
          appointment_id?: string | null
          created_at?: string
          form_id: string
          id?: string
          patient_id: string
          responses?: Json
        }
        Update: {
          appointment_id?: string | null
          created_at?: string
          form_id?: string
          id?: string
          patient_id?: string
          responses?: Json
        }
        Relationships: [
          {
            foreignKeyName: "form_submissions_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "form_submissions_form_id_fkey"
            columns: ["form_id"]
            isOneToOne: false
            referencedRelation: "forms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "form_submissions_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
        ]
      }
      forms: {
        Row: {
          created_at: string
          description: string | null
          id: string
          name: string
          org_id: string
          schema: Json
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          name: string
          org_id: string
          schema?: Json
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          org_id?: string
          schema?: Json
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "forms_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
        ]
      }
      locations: {
        Row: {
          address: string | null
          created_at: string
          id: string
          name: string
          org_id: string
          qr_token: string | null
          stripe_account_id: string | null
          timezone: string
          updated_at: string
        }
        Insert: {
          address?: string | null
          created_at?: string
          id?: string
          name: string
          org_id: string
          qr_token?: string | null
          stripe_account_id?: string | null
          timezone?: string
          updated_at?: string
        }
        Update: {
          address?: string | null
          created_at?: string
          id?: string
          name?: string
          org_id?: string
          qr_token?: string | null
          stripe_account_id?: string | null
          timezone?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "locations_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
        ]
      }
      organisations: {
        Row: {
          created_at: string
          id: string
          logo_url: string | null
          name: string
          slug: string
          stripe_routing: Database["public"]["Enums"]["stripe_routing"]
          tier: string
          timezone: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          logo_url?: string | null
          name: string
          slug: string
          stripe_routing?: Database["public"]["Enums"]["stripe_routing"]
          tier?: string
          timezone?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          logo_url?: string | null
          name?: string
          slug?: string
          stripe_routing?: Database["public"]["Enums"]["stripe_routing"]
          tier?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
      outcome_pathways: {
        Row: {
          created_at: string
          description: string | null
          id: string
          name: string
          org_id: string
          updated_at: string
          workflow_template_id: string | null
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          name: string
          org_id: string
          updated_at?: string
          workflow_template_id?: string | null
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          org_id?: string
          updated_at?: string
          workflow_template_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "outcome_pathways_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outcome_pathways_workflow_template_id_fkey"
            columns: ["workflow_template_id"]
            isOneToOne: false
            referencedRelation: "workflow_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      patient_phone_numbers: {
        Row: {
          created_at: string
          id: string
          is_primary: boolean
          patient_id: string
          phone_number: string
          verified_at: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          is_primary?: boolean
          patient_id: string
          phone_number: string
          verified_at?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          is_primary?: boolean
          patient_id?: string
          phone_number?: string
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "patient_phone_numbers_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
        ]
      }
      patients: {
        Row: {
          created_at: string
          date_of_birth: string | null
          first_name: string
          id: string
          last_name: string
          org_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          date_of_birth?: string | null
          first_name: string
          id?: string
          last_name: string
          org_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          date_of_birth?: string | null
          first_name?: string
          id?: string
          last_name?: string
          org_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "patients_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_methods: {
        Row: {
          card_brand: string
          card_expiry: string | null
          card_last_four: string
          created_at: string
          id: string
          is_default: boolean
          patient_id: string
          stripe_payment_method_id: string
        }
        Insert: {
          card_brand: string
          card_expiry?: string | null
          card_last_four: string
          created_at?: string
          id?: string
          is_default?: boolean
          patient_id: string
          stripe_payment_method_id: string
        }
        Update: {
          card_brand?: string
          card_expiry?: string | null
          card_last_four?: string
          created_at?: string
          id?: string
          is_default?: boolean
          patient_id?: string
          stripe_payment_method_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_methods_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount_cents: number
          appointment_id: string | null
          created_at: string
          id: string
          patient_id: string | null
          session_id: string | null
          status: Database["public"]["Enums"]["payment_status"]
          stripe_account_id: string | null
          stripe_payment_intent_id: string | null
          updated_at: string
        }
        Insert: {
          amount_cents: number
          appointment_id?: string | null
          created_at?: string
          id?: string
          patient_id?: string | null
          session_id?: string | null
          status?: Database["public"]["Enums"]["payment_status"]
          stripe_account_id?: string | null
          stripe_payment_intent_id?: string | null
          updated_at?: string
        }
        Update: {
          amount_cents?: number
          appointment_id?: string | null
          created_at?: string
          id?: string
          patient_id?: string | null
          session_id?: string | null
          status?: Database["public"]["Enums"]["payment_status"]
          stripe_account_id?: string | null
          stripe_payment_intent_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      phone_verifications: {
        Row: {
          code: string
          created_at: string
          expires_at: string
          id: string
          phone_number: string
          session_id: string | null
          verified_at: string | null
        }
        Insert: {
          code: string
          created_at?: string
          expires_at: string
          id?: string
          phone_number: string
          session_id?: string | null
          verified_at?: string | null
        }
        Update: {
          code?: string
          created_at?: string
          expires_at?: string
          id?: string
          phone_number?: string
          session_id?: string | null
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "phone_verifications_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      rooms: {
        Row: {
          created_at: string
          id: string
          link_token: string | null
          location_id: string
          name: string
          payments_enabled: boolean
          room_type: Database["public"]["Enums"]["room_type"]
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          link_token?: string | null
          location_id: string
          name: string
          payments_enabled?: boolean
          room_type?: Database["public"]["Enums"]["room_type"]
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          link_token?: string | null
          location_id?: string
          name?: string
          payments_enabled?: boolean
          room_type?: Database["public"]["Enums"]["room_type"]
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "rooms_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      session_participants: {
        Row: {
          created_at: string
          id: string
          patient_id: string
          role: string
          session_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          patient_id: string
          role?: string
          session_id: string
        }
        Update: {
          created_at?: string
          id?: string
          patient_id?: string
          role?: string
          session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "session_participants_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_participants_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      sessions: {
        Row: {
          appointment_id: string | null
          card_captured: boolean
          created_at: string
          device_tested: boolean
          entry_token: string | null
          id: string
          invite_sent: boolean
          invite_sent_at: string | null
          location_id: string
          notification_sent: boolean
          notification_sent_at: string | null
          patient_arrived: boolean
          patient_arrived_at: string | null
          prep_completed: boolean
          room_id: string | null
          session_ended_at: string | null
          session_started_at: string | null
          status: Database["public"]["Enums"]["session_status"]
          updated_at: string
          video_call_id: string | null
        }
        Insert: {
          appointment_id?: string | null
          card_captured?: boolean
          created_at?: string
          device_tested?: boolean
          entry_token?: string | null
          id?: string
          invite_sent?: boolean
          invite_sent_at?: string | null
          location_id: string
          notification_sent?: boolean
          notification_sent_at?: string | null
          patient_arrived?: boolean
          patient_arrived_at?: string | null
          prep_completed?: boolean
          room_id?: string | null
          session_ended_at?: string | null
          session_started_at?: string | null
          status?: Database["public"]["Enums"]["session_status"]
          updated_at?: string
          video_call_id?: string | null
        }
        Update: {
          appointment_id?: string | null
          card_captured?: boolean
          created_at?: string
          device_tested?: boolean
          entry_token?: string | null
          id?: string
          invite_sent?: boolean
          invite_sent_at?: string | null
          location_id?: string
          notification_sent?: boolean
          notification_sent_at?: string | null
          patient_arrived?: boolean
          patient_arrived_at?: string | null
          prep_completed?: boolean
          room_id?: string | null
          session_ended_at?: string | null
          session_started_at?: string | null
          status?: Database["public"]["Enums"]["session_status"]
          updated_at?: string
          video_call_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sessions_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sessions_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sessions_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_assignments: {
        Row: {
          created_at: string
          employment_type: Database["public"]["Enums"]["employment_type"]
          id: string
          location_id: string
          role: Database["public"]["Enums"]["user_role"]
          stripe_account_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          employment_type?: Database["public"]["Enums"]["employment_type"]
          id?: string
          location_id: string
          role: Database["public"]["Enums"]["user_role"]
          stripe_account_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          employment_type?: Database["public"]["Enums"]["employment_type"]
          id?: string
          location_id?: string
          role?: Database["public"]["Enums"]["user_role"]
          stripe_account_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_assignments_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_assignments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      type_workflow_links: {
        Row: {
          appointment_type_id: string
          created_at: string
          direction: Database["public"]["Enums"]["workflow_direction"]
          id: string
          workflow_template_id: string
        }
        Insert: {
          appointment_type_id: string
          created_at?: string
          direction: Database["public"]["Enums"]["workflow_direction"]
          id?: string
          workflow_template_id: string
        }
        Update: {
          appointment_type_id?: string
          created_at?: string
          direction?: Database["public"]["Enums"]["workflow_direction"]
          id?: string
          workflow_template_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "type_workflow_links_appointment_type_id_fkey"
            columns: ["appointment_type_id"]
            isOneToOne: false
            referencedRelation: "appointment_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "type_workflow_links_workflow_template_id_fkey"
            columns: ["workflow_template_id"]
            isOneToOne: false
            referencedRelation: "workflow_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string
          full_name: string
          id: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email: string
          full_name: string
          id: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string
          full_name?: string
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      workflow_action_blocks: {
        Row: {
          action_type: Database["public"]["Enums"]["action_type"]
          config: Json
          created_at: string
          form_id: string | null
          id: string
          modality_filter:
            | Database["public"]["Enums"]["appointment_modality"]
            | null
          offset_direction: string
          offset_minutes: number
          precondition: Json | null
          sort_order: number
          template_id: string
          updated_at: string
        }
        Insert: {
          action_type: Database["public"]["Enums"]["action_type"]
          config?: Json
          created_at?: string
          form_id?: string | null
          id?: string
          modality_filter?:
            | Database["public"]["Enums"]["appointment_modality"]
            | null
          offset_direction?: string
          offset_minutes?: number
          precondition?: Json | null
          sort_order?: number
          template_id: string
          updated_at?: string
        }
        Update: {
          action_type?: Database["public"]["Enums"]["action_type"]
          config?: Json
          created_at?: string
          form_id?: string | null
          id?: string
          modality_filter?:
            | Database["public"]["Enums"]["appointment_modality"]
            | null
          offset_direction?: string
          offset_minutes?: number
          precondition?: Json | null
          sort_order?: number
          template_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_workflow_action_blocks_form"
            columns: ["form_id"]
            isOneToOne: false
            referencedRelation: "forms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_action_blocks_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "workflow_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      workflow_templates: {
        Row: {
          created_at: string
          description: string | null
          direction: Database["public"]["Enums"]["workflow_direction"]
          id: string
          name: string
          org_id: string
          status: Database["public"]["Enums"]["workflow_template_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          direction: Database["public"]["Enums"]["workflow_direction"]
          id?: string
          name: string
          org_id: string
          status?: Database["public"]["Enums"]["workflow_template_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          direction?: Database["public"]["Enums"]["workflow_direction"]
          id?: string
          name?: string
          org_id?: string
          status?: Database["public"]["Enums"]["workflow_template_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflow_templates_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      user_location_ids: { Args: never; Returns: string[] }
      user_org_ids: { Args: never; Returns: string[] }
    }
    Enums: {
      action_status:
        | "pending"
        | "sent"
        | "completed"
        | "failed"
        | "skipped"
        | "scheduled"
        | "opened"
        | "captured"
        | "verified"
        | "cancelled"
        | "firing"
      action_type:
        | "send_sms"
        | "deliver_form"
        | "capture_card"
        | "send_reminder"
        | "send_nudge"
        | "send_session_link"
        | "send_resource"
        | "send_proms"
        | "send_rebooking_nudge"
        | "verify_contact"
        | "send_file"
      appointment_modality: "telehealth" | "in_person"
      appointment_status:
        | "scheduled"
        | "arrived"
        | "in_progress"
        | "completed"
        | "cancelled"
        | "no_show"
      appointment_type_source: "coviu" | "pms"
      employment_type: "full_time" | "part_time"
      payment_status:
        | "pending"
        | "processing"
        | "completed"
        | "failed"
        | "refunded"
      room_type: "clinical" | "reception" | "shared" | "triage"
      session_status:
        | "queued"
        | "waiting"
        | "checked_in"
        | "in_session"
        | "complete"
        | "done"
      stripe_routing: "location" | "clinician"
      user_role:
        | "practice_manager"
        | "receptionist"
        | "clinician"
        | "clinic_owner"
      workflow_direction: "pre_appointment" | "post_appointment"
      workflow_run_status: "active" | "complete" | "cancelled"
      workflow_template_status: "draft" | "published" | "archived"
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
      action_status: [
        "pending",
        "sent",
        "completed",
        "failed",
        "skipped",
        "scheduled",
        "opened",
        "captured",
        "verified",
        "cancelled",
        "firing",
      ],
      action_type: [
        "send_sms",
        "deliver_form",
        "capture_card",
        "send_reminder",
        "send_nudge",
        "send_session_link",
        "send_resource",
        "send_proms",
        "send_rebooking_nudge",
        "verify_contact",
        "send_file",
      ],
      appointment_modality: ["telehealth", "in_person"],
      appointment_status: [
        "scheduled",
        "arrived",
        "in_progress",
        "completed",
        "cancelled",
        "no_show",
      ],
      appointment_type_source: ["coviu", "pms"],
      employment_type: ["full_time", "part_time"],
      payment_status: [
        "pending",
        "processing",
        "completed",
        "failed",
        "refunded",
      ],
      room_type: ["clinical", "reception", "shared", "triage"],
      session_status: [
        "queued",
        "waiting",
        "checked_in",
        "in_session",
        "complete",
        "done",
      ],
      stripe_routing: ["location", "clinician"],
      user_role: [
        "practice_manager",
        "receptionist",
        "clinician",
        "clinic_owner",
      ],
      workflow_direction: ["pre_appointment", "post_appointment"],
      workflow_run_status: ["active", "complete", "cancelled"],
      workflow_template_status: ["draft", "published", "archived"],
    },
  },
} as const

// ============================================================================
// Hand-written application types for the run sheet
// ============================================================================

export type UserRole = 'clinic_owner' | 'practice_manager' | 'receptionist' | 'clinician';
export type RoomType = 'clinical' | 'reception' | 'shared' | 'triage';
export type AppointmentModality = 'telehealth' | 'in_person';
export type SessionStatus = 'queued' | 'waiting' | 'checked_in' | 'in_session' | 'complete' | 'done';
export type PaymentStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'refunded';
export type OrgTier = 'core' | 'complete';

export type DerivedDisplayState =
  | 'queued'
  | 'upcoming'
  | 'late'
  | 'waiting'
  | 'checked_in'
  | 'in_session'
  | 'running_over'
  | 'complete'
  | 'done';

export interface Organisation {
  id: string;
  name: string;
  slug: string;
  tier: OrgTier;
  logo_url: string | null;
  stripe_routing: 'location' | 'clinician';
  timezone: string;
}

export interface Location {
  id: string;
  org_id: string;
  name: string;
  address: string | null;
  timezone: string;
  qr_token: string;
  stripe_account_id: string | null;
}

export interface Room {
  id: string;
  location_id: string;
  name: string;
  room_type: RoomType;
  link_token: string;
  sort_order: number;
  payments_enabled: boolean;
}

export interface AppointmentType {
  id: string;
  org_id: string;
  name: string;
  modality: AppointmentModality;
  duration_minutes: number;
  default_fee_cents: number;
}

export interface Patient {
  id: string;
  org_id: string;
  first_name: string;
  last_name: string;
  date_of_birth: string | null;
}

export interface StaffAssignment {
  id: string;
  user_id: string;
  location_id: string;
  role: UserRole;
  employment_type: 'full_time' | 'part_time';
  stripe_account_id: string | null;
}

export interface User {
  id: string;
  email: string;
  full_name: string;
  avatar_url: string | null;
}

/** The flat row returned by the run sheet query, with all joins resolved. */
export interface RunsheetSession {
  // Session fields
  session_id: string;
  status: SessionStatus;
  entry_token: string;
  video_call_id: string | null;
  notification_sent: boolean;
  notification_sent_at: string | null;
  patient_arrived: boolean;
  patient_arrived_at: string | null;
  session_started_at: string | null;
  session_ended_at: string | null;
  session_created_at: string;

  // Appointment fields (nullable for on-demand sessions)
  appointment_id: string | null;
  scheduled_at: string | null;
  appointment_status: string | null;
  phone_number: string | null;

  // Appointment type
  appointment_type_id: string | null;
  type_name: string | null;
  modality: AppointmentModality | null;
  duration_minutes: number | null;
  default_fee_cents: number | null;

  // Patient
  patient_id: string | null;
  patient_first_name: string | null;
  patient_last_name: string | null;

  // Room
  room_id: string | null;
  room_name: string | null;
  room_type: RoomType | null;
  room_sort_order: number | null;

  // Clinician (assigned to appointment)
  clinician_id: string | null;
  clinician_name: string | null;

  // Payment method on file
  has_card_on_file: boolean;
  card_last_four: string | null;
  card_brand: string | null;
}

/** A RunsheetSession enriched with its derived display state. */
export interface EnrichedSession extends RunsheetSession {
  derived_state: DerivedDisplayState;
  patient_disconnected: boolean;
}

/** Sessions grouped by room for rendering. */
export interface RoomGroup {
  room_id: string;
  room_name: string;
  room_type: RoomType;
  room_sort_order: number;
  link_token: string;
  payments_enabled: boolean;
  clinician_name: string | null;
  sessions: EnrichedSession[];
  counts: RoomCounts;
}

export interface RoomCounts {
  total: number;
  late: number;
  upcoming: number;
  waiting: number;
  active: number;
  complete: number;
  done: number;
}

/** Aggregate summary across all rooms for the summary bar. */
export interface RunsheetSummary {
  total: number;
  late: number;
  upcoming: number;
  waiting: number;
  active: number;
  complete: number;
  done: number;
}

/** Badge config for a derived state. */
export interface StatusBadgeConfig {
  label: string;
  variant: 'red' | 'amber' | 'amber-soft' | 'teal' | 'teal-muted' | 'blue' | 'blue-muted' | 'gray' | 'gray-muted' | 'faded' | 'green';
}

/** Action button config for a derived state. */
export type ActionConfig = {
  label: string;
  variant: 'red' | 'amber' | 'teal' | 'blue';
  action: 'call' | 'nudge' | 'admit' | 'process';
} | null;

// ============================================================================
// Patient Entry Flow Types
// ============================================================================

/** The type of token used to enter the patient flow. */
export type EntryType = 'session' | 'on_demand' | 'qr_code';

/** Context resolved from the entry token. */
export interface EntryContext {
  entry_type: EntryType;
  org: { id: string; name: string; logo_url: string | null; tier: OrgTier };
  location: { id: string; name: string; stripe_account_id: string | null };
  room: { id: string; name: string; room_type: RoomType } | null;
  session: {
    id: string;
    entry_token: string;
    status: SessionStatus;
    appointment_id: string | null;
    scheduled_at: string | null;
    phone_number: string | null;
    clinician_name: string | null;
  } | null;
  payments_enabled: boolean;
}

/** State tracked as the patient progresses through the flow. */
export interface PatientFlowState {
  current_step: number;
  total_steps: number;
  phone_verified: boolean;
  phone_number: string | null;
  verification_id: string | null;
  patient_id: string | null;
  patient_name: string | null;
  identity_confirmed: boolean;
  card_on_file: boolean;
  card_last_four: string | null;
  card_brand: string | null;
  device_tested: boolean;
  session_id: string | null;
}

/** Patient contact returned during identity step. */
export interface PatientContact {
  id: string;
  first_name: string;
  last_name: string;
  date_of_birth: string | null;
}

/** Phone verification record. */
export interface PhoneVerification {
  id: string;
  phone_number: string;
  code: string;
  expires_at: string;
  verified_at: string | null;
  session_id: string | null;
  created_at: string;
}

// ============================================================================
// Forms Types
// ============================================================================

export type FormStatus = 'draft' | 'published' | 'archived';
export type FormAssignmentStatus = 'pending' | 'sent' | 'opened' | 'completed';

export interface Form {
  id: string;
  org_id: string;
  name: string;
  description: string | null;
  schema: Record<string, unknown>;
  status: FormStatus;
  created_at: string;
  updated_at: string;
}

export interface FormAssignment {
  id: string;
  form_id: string;
  appointment_id: string | null;
  patient_id: string;
  token: string;
  schema_snapshot: Record<string, unknown>;
  status: FormAssignmentStatus;
  sent_at: string | null;
  opened_at: string | null;
  completed_at: string | null;
  submission_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface FormSubmission {
  id: string;
  form_id: string;
  patient_id: string;
  appointment_id: string | null;
  responses: Record<string, unknown>;
  created_at: string;
}
