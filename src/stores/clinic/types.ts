import type {
  DbWorkflowTemplate,
  DbWorkflowActionBlock,
} from "@/lib/workflows/types";

export interface AppointmentTypeRow {
  id: string;
  name: string;
  duration_minutes: number;
  default_fee_cents: number;
  modality: string;
  source: string;
  pms_provider: string | null;
  pre_workflow_template_id: string | null;
  terminal_type: "run_sheet" | "collection_only" | null;
  action_count: number;
  in_flight_count: number;
}

export interface OutcomePathwayRow {
  id: string;
  name: string;
  description: string | null;
  workflow_template_id: string | null;
  archived_at: string | null;
  template: DbWorkflowTemplate | null;
  blocks: DbWorkflowActionBlock[];
  action_count: number;
  in_flight_count: number;
}

export interface FormRow {
  id: string;
  name: string;
  description: string | null;
  status: "draft" | "published" | "archived";
  schema: Record<string, unknown>;
  public_token: string;
  updated_at: string;
  assignment_counts: { total: number; completed: number };
}

export interface FileRow {
  id: string;
  name: string;
  description: string | null;
  storage_path: string;
  file_size_bytes: number;
  mime_type: string;
  uploaded_by: string | null;
  created_at: string;
}

export interface StandaloneSubmissionRow {
  id: string;
  form_id: string;
  form_name: string;
  patient_id: string;
  patient_name: string;
  patient_first_name: string;
  patient_last_name: string;
  submission_source:
    | "standalone_public"
    | "standalone_sms"
    | "standalone_qr"
    | string;
  review_status: "pending" | "reviewed" | "archived" | string;
  duplicate: {
    possible_duplicate_patient_id: string | null;
    possible_duplicate_patient_name: string | null;
  } | null;
  created_at: string;
}

export interface WorkflowAction {
  action_id: string;
  action_type: string;
  action_label: string;
  status: string;
  scheduled_for: string;
  fired_at: string | null;
  completed_at: string | null;
  error_message: string | null;
  form_name: string | null;
  offset_minutes: number;
  offset_direction: string;
  updated_at?: string | null;
  // Post-appointment fields
  session_id?: string | null;
  config?: Record<string, unknown> | null;
  resolved_at?: string | null;
  resolved_by?: string | null;
  resolution_note?: string | null;
  pathway_name?: string | null;
}

export interface OutstandingForm {
  assignment_id: string;
  form_name: string;
  status: string;
  sent_at: string | null;
  created_at: string;
}

export type ReadinessDirection = "pre_appointment" | "post_appointment";

export interface ReadinessCounts {
  pre: number;
  post: number;
}

export interface CompletedFormSubmission {
  submission_id: string;
  form_id: string;
  form_name: string;
  completed_at: string;
  source: "assignment" | "intake_package";
}

export interface ReadinessAppointment {
  appointment_id: string;
  scheduled_at: string | null;
  patient_id: string;
  patient_first_name: string;
  patient_last_name: string;
  clinician_name: string | null;
  primary_phone: string | null;
  room_name: string | null;
  appointment_type_name: string | null;
  priority: string;
  total_actions: number;
  completed_actions: number;
  outstanding_actions: number;
  actions: WorkflowAction[];
  outstanding_forms: OutstandingForm[];
  completed_form_submissions: CompletedFormSubmission[];
  // Post-appointment fields
  pathway_name?: string | null;
  session_ended_at?: string | null;
}

export interface RoomClinician {
  staff_assignment_id: string;
  full_name: string;
}

export interface RoomWithClinicians {
  id: string;
  location_id: string;
  name: string;
  room_type: "clinical" | "reception" | "shared" | "triage";
  link_token: string;
  sort_order: number;
  payments_enabled: boolean;
  clinicians: RoomClinician[];
}

export interface ClinicianAccount {
  staff_assignment_id: string;
  user_id: string;
  role: string;
  full_name: string;
  stripe_account_id: string | null;
}

export interface PaymentsData {
  routing_mode: "location" | "clinician";
  location_stripe_account_id: string | null;
  clinicians: ClinicianAccount[];
}

export interface RoomPayment {
  id: string;
  name: string;
  room_type: "clinical" | "reception" | "shared" | "triage";
  payments_enabled: boolean;
}

export type OnboardingStage =
  | "not_started"
  | "test_session_sent"
  | "call_active"
  | "call_completed";

export interface OnboardingState {
  stage: OnboardingStage;
  hasSeenPatientJourney: boolean;
  testSessionId: string | null;
  coachMarkDismissed: Partial<Record<OnboardingStage, boolean>>;
}
