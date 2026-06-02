import type { WorkflowAction } from "@/stores/clinic-store";

export interface AppointmentRow {
  appointment_id: string | null;
  session_id: string | null;
  scheduled_at: string | null;
  created_at: string | null;
  type_name: string | null;
  room_name: string | null;
  modality: "telehealth" | "in_person" | null;
  appointment_status: string | null;
  session_status: string | null;
  bucket: "past" | "today" | "upcoming" | "awaiting_scheduling";
  location_timezone: string | null;
}

export interface FormAssignmentRow {
  id: string;
  form_id: string;
  appointment_id: string | null;
  form_name: string;
  status: string;
  sent_at: string | null;
  completed_at: string | null;
  created_at: string;
  submission_id: string | null;
}

export interface FormSubmissionRow {
  submission_id: string;
  form_id: string;
  appointment_id: string | null;
  form_name: string;
  completed_at: string;
  created_at: string;
}

/**
 * Minimal seed for opening the contact card instantly. Carried from the
 * dashboard row so the panel header paints with no network wait when the
 * caller has no full readiness `appointment` (e.g. standalone form rows).
 */
export interface PatientSeed {
  id: string;
  firstName: string;
  lastName: string;
  /** Standalone rows have no phone — omit and the contact section shimmers. */
  primaryPhone?: string | null;
}

export interface PatientDetails {
  patient: {
    id: string;
    first_name: string;
    last_name: string;
    date_of_birth: string | null;
  };
  phone_numbers: { phone_number: string; is_primary: boolean }[];
  payment_methods: {
    card_brand: string;
    card_last_four: string;
    card_expiry: string | null;
    is_default: boolean;
  }[];
  appointments: AppointmentRow[];
  total_appointment_count: number;
  form_assignments: FormAssignmentRow[];
  form_submissions: FormSubmissionRow[];
  // True when the bounded form history was truncated (set by /history).
  form_history_truncated?: boolean;
}

// Response shapes for the split endpoints. Their union (minus workflow_actions)
// equals PatientDetails; no field appears in both summary and history.
export interface PatientSummaryResponse {
  patient: PatientDetails["patient"];
  phone_numbers: PatientDetails["phone_numbers"];
  payment_methods: PatientDetails["payment_methods"];
  // Present only when an active appointment_id was supplied (Stage 7).
  workflow_actions?: WorkflowAction[];
}

export interface PatientHistoryResponse {
  appointments: AppointmentRow[];
  total_appointment_count: number;
  form_assignments: FormAssignmentRow[];
  form_submissions: FormSubmissionRow[];
  form_history_truncated: boolean;
}

export interface CompletedFormDisplayRow {
  submission_id: string;
  form_name: string;
  completed_at: string;
}

export const ACTION_STATUS_BADGE: Record<
  string,
  { label: string; variant: string }
> = {
  scheduled: { label: "Scheduled", variant: "gray" },
  pending: { label: "Pending", variant: "gray" },
  firing: { label: "Firing", variant: "amber" },
  sent: { label: "Sent", variant: "amber" },
  opened: { label: "Opened", variant: "amber" },
  completed: { label: "Completed", variant: "teal" },
  captured: { label: "Captured", variant: "teal" },
  verified: { label: "Verified", variant: "teal" },
  transcribed: { label: "Transcribed", variant: "teal" },
  skipped: { label: "Skipped", variant: "gray" },
  failed: { label: "Failed", variant: "red" },
};
