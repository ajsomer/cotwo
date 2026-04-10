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
          scheduled_at: string | null
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
          scheduled_at?: string | null
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
          scheduled_at?: string | null
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
      intake_package_journeys: {
        Row: {
          appointment_id: string
          card_captured_at: string | null
          completed_at: string | null
          consent_completed_at: string | null
          created_at: string
          form_ids: string[]
          forms_completed: Json
          id: string
          includes_card_capture: boolean
          includes_consent: boolean
          journey_token: string
          patient_id: string | null
          status: string
        }
        Insert: {
          appointment_id: string
          card_captured_at?: string | null
          completed_at?: string | null
          consent_completed_at?: string | null
          created_at?: string
          form_ids?: string[]
          forms_completed?: Json
          id?: string
          includes_card_capture?: boolean
          includes_consent?: boolean
          journey_token: string
          patient_id?: string | null
          status?: string
        }
        Update: {
          appointment_id?: string
          card_captured_at?: string | null
          completed_at?: string | null
          consent_completed_at?: string | null
          created_at?: string
          form_ids?: string[]
          forms_completed?: Json
          id?: string
          includes_card_capture?: boolean
          includes_consent?: boolean
          journey_token?: string
          patient_id?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "intake_package_journeys_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intake_package_journeys_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
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
          parent_action_block_id: string | null
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
          parent_action_block_id?: string | null
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
          parent_action_block_id?: string | null
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
            foreignKeyName: "workflow_action_blocks_parent_action_block_id_fkey"
            columns: ["parent_action_block_id"]
            isOneToOne: false
            referencedRelation: "workflow_action_blocks"
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
          at_risk_after_days: number | null
          created_at: string
          description: string | null
          direction: Database["public"]["Enums"]["workflow_direction"]
          id: string
          name: string
          org_id: string
          overdue_after_days: number | null
          status: Database["public"]["Enums"]["workflow_template_status"]
          terminal_type: Database["public"]["Enums"]["workflow_terminal_type"]
          updated_at: string
        }
        Insert: {
          at_risk_after_days?: number | null
          created_at?: string
          description?: string | null
          direction: Database["public"]["Enums"]["workflow_direction"]
          id?: string
          name: string
          org_id: string
          overdue_after_days?: number | null
          status?: Database["public"]["Enums"]["workflow_template_status"]
          terminal_type?: Database["public"]["Enums"]["workflow_terminal_type"]
          updated_at?: string
        }
        Update: {
          at_risk_after_days?: number | null
          created_at?: string
          description?: string | null
          direction?: Database["public"]["Enums"]["workflow_direction"]
          id?: string
          name?: string
          org_id?: string
          overdue_after_days?: number | null
          status?: Database["public"]["Enums"]["workflow_template_status"]
          terminal_type?: Database["public"]["Enums"]["workflow_terminal_type"]
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
      configure_appointment_type: {
        Args: {
          p_appointment_type_id?: string
          p_at_risk_after_days?: number
          p_default_fee_cents?: number
          p_duration_minutes?: number
          p_form_ids?: string[]
          p_includes_card_capture?: boolean
          p_includes_consent?: boolean
          p_modality?: Database["public"]["Enums"]["appointment_modality"]
          p_name?: string
          p_org_id: string
          p_overdue_after_days?: number
          p_reminders?: Json
          p_terminal_type?: Database["public"]["Enums"]["workflow_terminal_type"]
        }
        Returns: Json
      }
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
        | "transcribed"
        | "dropped"
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
        | "intake_package"
        | "intake_reminder"
        | "add_to_runsheet"
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
      workflow_terminal_type: "run_sheet" | "collection_only"
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
        "transcribed",
        "dropped",
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
        "intake_package",
        "intake_reminder",
        "add_to_runsheet",
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
      workflow_terminal_type: ["run_sheet", "collection_only"],
    },
  },
} as const

// Re-export custom types so all consumers can import from '@/lib/supabase/types'
// Custom types live in custom-types.ts to survive `supabase gen types` overwrites.
export * from './custom-types';
