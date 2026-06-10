import { describe, it, expect } from "vitest";
import {
  buildHandlerContext,
  resolveActionPhone,
  type ClaimedActionData,
  type ActionBlockData,
  type AppointmentData,
  type ContextLookups,
} from "../context";

const action: ClaimedActionData = {
  id: "action-1",
  appointment_id: "appt-1",
  session_id: null,
  config: { message: "action snapshot" },
  form_id: null,
};

const block: ActionBlockData = {
  action_type: "send_sms",
  config: { message: "block config" },
  form_id: "block-form",
  parent_action_block_id: null,
};

const appt: AppointmentData = {
  patient_id: "patient-1",
  scheduled_at: "2026-06-10T00:00:00.000Z",
  clinician_id: null,
  org_id: "org-1",
  phone_number: "+61400000001",
};

const lookups: ContextLookups = {
  patientFirstName: "Ada",
  primaryPhone: "+61400000002",
  clinicName: "North Clinic",
  clinicianName: null,
  timezone: "Australia/Sydney",
  sessionEndedAt: null,
};

describe("resolveActionPhone", () => {
  it("prefers the patient's primary phone", () => {
    expect(resolveActionPhone("+61400000002", appt)).toBe("+61400000002");
  });

  it("falls back to the appointment-row phone (manual run-sheet entries)", () => {
    expect(resolveActionPhone(null, appt)).toBe("+61400000001");
  });

  it("returns empty string when neither exists", () => {
    expect(resolveActionPhone(null, { phone_number: null })).toBe("");
  });
});

describe("buildHandlerContext", () => {
  it("applies the appointment-phone fallback in the assembled context", () => {
    const ctx = buildHandlerContext({
      action,
      block,
      appt,
      patientId: "patient-1",
      lookups: { ...lookups, primaryPhone: null },
    });
    expect(ctx.phoneNumber).toBe("+61400000001");
  });

  it("reads config from the block for pre-appointment actions (no session)", () => {
    const ctx = buildHandlerContext({
      action,
      block,
      appt,
      patientId: "patient-1",
      lookups,
    });
    expect(ctx.config).toEqual({ message: "block config" });
  });

  it("reads config from the action snapshot for post-appointment actions", () => {
    const ctx = buildHandlerContext({
      action: { ...action, session_id: "session-1" },
      block,
      appt,
      patientId: "patient-1",
      lookups,
    });
    expect(ctx.config).toEqual({ message: "action snapshot" });
  });

  it("falls back to block config when a session action has no snapshot", () => {
    const ctx = buildHandlerContext({
      action: { ...action, session_id: "session-1", config: null },
      block,
      appt,
      patientId: "patient-1",
      lookups,
    });
    expect(ctx.config).toEqual({ message: "block config" });
  });

  it("prefers the action's form_id over the block's", () => {
    const withActionForm = buildHandlerContext({
      action: { ...action, form_id: "action-form" },
      block,
      appt,
      patientId: "patient-1",
      lookups,
    });
    expect(withActionForm.formId).toBe("action-form");

    const withBlockForm = buildHandlerContext({
      action,
      block,
      appt,
      patientId: "patient-1",
      lookups,
    });
    expect(withBlockForm.formId).toBe("block-form");
  });

  it("defaults suppressNotification to false and passes timezone through", () => {
    const ctx = buildHandlerContext({
      action,
      block,
      appt,
      patientId: "patient-1",
      lookups,
    });
    expect(ctx.suppressNotification).toBe(false);
    expect(ctx.timezone).toBe("Australia/Sydney");
  });
});
