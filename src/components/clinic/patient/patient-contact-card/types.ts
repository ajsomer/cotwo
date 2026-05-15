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
