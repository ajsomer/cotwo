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
  // True for a PMS-imported type not yet confirmed (no confirmed modality or
  // sync off) — usable for authoring workflows, but won't reach the run sheet
  // until confirmed + a practitioner is mapped to a room. Drives the hint.
  is_pms_unconfirmed?: boolean;
  // Whether sync from the PMS is enabled for this type (editor toggle state).
  pms_sync_enabled?: boolean;
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
  // Workflow-run grouping (patient pane Workflows section). Nullable: legacy
  // actions predating runs, or actions with no run linkage, carry null run id
  // and group under a per-appointment "Other messages" fallback block.
  workflow_run_id?: string | null;
  workflow_template_name?: string | null;
  workflow_direction?: "pre_appointment" | "post_appointment" | null;
  run_appointment_id?: string | null;
  run_started_at?: string | null;
  // The run's appointment scheduled_at — the date shown in the block header.
  run_appointment_scheduled_at?: string | null;
  // Appointment type name (what the Workflows tab labels workflows by). The
  // block header prefers this over the template name.
  appointment_type_name?: string | null;
  // "action" (patient must do — forms, card, consent, intake), "message" (the
  // workflow's configurable SMS), or "system" (add_to_runsheet, plain
  // appointment reminders — hidden from the Workflows section). Drives the
  // Actions-first / Messages split in the pane.
  action_kind?: "action" | "message" | "system";
  // The configured SMS template (placeholders unresolved) for a message-type
  // action — shown in the expandable Messages dropdown. Null when there's no
  // meaningful template to show.
  message_template?: string | null;
  // For an intake_package action: its constituent to-dos broken out of the
  // intake_package_journeys row, so the pane lists each form / card / consent
  // with its own done/outstanding state.
  intake_items?: IntakeItem[];
}

export interface IntakeItem {
  key: string;
  label: string;
  kind: "form" | "card" | "consent";
  completed: boolean;
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
  room_id: string | null;
  room_name: string | null;
  appointment_type_id: string | null;
  appointment_type_name: string | null;
  priority: string;
  total_actions: number;
  completed_actions: number;
  outstanding_actions: number;
  actions: WorkflowAction[];
  outstanding_forms: OutstandingForm[];
  completed_form_submissions: CompletedFormSubmission[];
  // Intake package journey token for this appointment (opens /intake/{token}).
  intake_journey_token?: string | null;
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
