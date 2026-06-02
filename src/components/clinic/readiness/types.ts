import type { ReadinessAppointment } from "@/stores/clinic-store";
import type { ReadinessPriority } from "@/lib/readiness/derived-state";
import type { PatientSeed } from "@/components/clinic/patient/patient-contact-card/types";

export type ActivePanel =
  | { type: "add-patient" }
  | {
      type: "detail";
      // Appointment-bound open (run-sheet / readiness): full context.
      // Patient-only open (e.g. clicking a standalone-submission patient):
      // appointment is null; PatientContactCard runs in patientId-only mode.
      appointment: ReadinessAppointment | null;
      patientId: string;
      // Generic seed for instant-open when there's no readiness appointment
      // (e.g. standalone form rows). Lets the panel paint the header without a
      // network wait.
      patientSeed?: PatientSeed | null;
    }
  | {
      type: "form-handoff";
      appointment: ReadinessAppointment;
      actionId: string;
      formName: string;
      submissionId: string | null;
      /** Row's completed_at, seeds the header timestamp before fetch. */
      submittedAt: string | null;
      /** What to show on close. "detail" reopens the patient card, "none" closes everything. */
      returnTo: "detail" | "none";
    }
  | {
      type: "intake-handoff";
      appointment: ReadinessAppointment;
      actionId: string;
      /** Intake action's completion time, seeds the header timestamp. */
      submittedAt: string | null;
      returnTo: "detail" | "none";
    }
  | {
      type: "standalone-submission";
      submissionId: string;
      // Row seeds so the panel header renders before the detail fetch.
      seedFormName: string | null;
      seedPatientName: string | null;
      seedCreatedAt: string | null;
    }
  | null;

export interface PrioritySlot {
  key: ReadinessPriority;
  label: string;
  borderColor: string;
  rowTint: string;
  badgeVariant: string;
}

export const PRIORITY_SLOTS: PrioritySlot[] = [
  {
    key: "overdue",
    label: "Overdue",
    borderColor: "border-l-red-500",
    rowTint: "bg-red-500/[0.03]",
    badgeVariant: "red",
  },
  {
    key: "form_completed_needs_transcription",
    label: "Form Completed",
    borderColor: "border-l-amber-500",
    rowTint: "bg-amber-500/[0.03]",
    badgeVariant: "amber",
  },
  {
    key: "at_risk",
    label: "At Risk",
    borderColor: "border-l-amber-500",
    rowTint: "bg-amber-500/[0.03]",
    badgeVariant: "amber",
  },
  {
    key: "in_progress",
    label: "In Progress",
    borderColor: "border-l-gray-200",
    rowTint: "",
    badgeVariant: "gray",
  },
  {
    key: "recently_completed",
    label: "Completed",
    borderColor: "border-l-gray-200",
    rowTint: "",
    badgeVariant: "faded",
  },
];

export const ACTION_BUTTON_VARIANT_MAP: Record<
  string,
  "danger" | "accent" | "primary"
> = {
  red: "danger",
  amber: "accent",
  teal: "primary",
};

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
  cancelled: { label: "Cancelled", variant: "gray" },
};

export const STANDALONE_SOURCE_LABEL: Record<string, string> = {
  standalone_public: "Public link",
  standalone_sms: "SMS",
  standalone_qr: "QR",
};
