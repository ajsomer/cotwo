import { describe, it, expect } from "vitest";
import {
  renderTemplate,
  smsTemplateVars,
  intakeTemplateVars,
  SMS_TEMPLATE_VARIABLES,
  INTAKE_TEMPLATE_VARIABLES,
} from "../template";

describe("renderTemplate", () => {
  it("replaces every occurrence of each placeholder", () => {
    expect(
      renderTemplate("Hi {first_name}, {first_name} at {clinic_name}", {
        first_name: "Ada",
        clinic_name: "North Clinic",
      })
    ).toBe("Hi Ada, Ada at North Clinic");
  });

  it("leaves unknown placeholders visible rather than dropping them", () => {
    expect(renderTemplate("Hi {nope}", { first_name: "Ada" })).toBe("Hi {nope}");
  });

  it("handles values containing regex-special characters", () => {
    expect(renderTemplate("{link}", { link: "https://x.test/a?b=$1&c=2" })).toBe(
      "https://x.test/a?b=$1&c=2"
    );
  });
});

describe("smsTemplateVars", () => {
  const base = {
    patientFirstName: "Ada",
    clinicName: "North Clinic",
    clinicianName: "Dr Smith",
    scheduledAt: null as string | null,
    sessionEndedAt: null as string | null,
    timezone: "Australia/Sydney",
  };

  it("formats appointment_time in the location timezone, not the server's", () => {
    // 2026-01-15T03:30Z = 14:30 AEDT (UTC+11) = 11:30 AWST (UTC+8)
    const instant = "2026-01-15T03:30:00.000Z";
    const sydney = smsTemplateVars({ ...base, scheduledAt: instant });
    const perth = smsTemplateVars({
      ...base,
      scheduledAt: instant,
      timezone: "Australia/Perth",
    });
    expect(sydney.appointment_time.toLowerCase()).toContain("2:30");
    expect(perth.appointment_time.toLowerCase()).toContain("11:30");
  });

  it("formats session_date in the location timezone across the midnight boundary", () => {
    // 2026-01-15T14:30Z is already 16 Jan in Sydney
    const vars = smsTemplateVars({
      ...base,
      sessionEndedAt: "2026-01-15T14:30:00.000Z",
    });
    expect(vars.session_date).toContain("16 January 2026");
  });

  it("falls back to readable copy when times are missing", () => {
    const vars = smsTemplateVars(base);
    expect(vars.appointment_time).toBe("your appointment");
    expect(vars.session_date).toBe("your recent appointment");
  });

  it("aliases patient_name to first_name and defaults clinician_name", () => {
    const vars = smsTemplateVars({ ...base, clinicianName: null });
    expect(vars.patient_name).toBe("Ada");
    expect(vars.clinician_name).toBe("your clinician");
  });

  it("renders every advertised SMS placeholder (UI vocabulary can't drift)", () => {
    const template = SMS_TEMPLATE_VARIABLES.map((v) => v.key).join(" ");
    const rendered = renderTemplate(template, smsTemplateVars(base));
    expect(rendered).not.toMatch(/\{[a-z_]+\}/);
  });
});

describe("intakeTemplateVars", () => {
  const ctx = { patientFirstName: "Ada", clinicName: "North Clinic" };

  it("renders every advertised intake placeholder", () => {
    const template = INTAKE_TEMPLATE_VARIABLES.map((v) => v.key).join(" ");
    const rendered = renderTemplate(
      template,
      intakeTemplateVars(ctx, "https://x.test/intake/t")
    );
    expect(rendered).not.toMatch(/\{[a-z_]+\}/);
  });

  it("accepts {first_name} as an alias so SMS-vocabulary templates still render", () => {
    expect(
      renderTemplate("Hi {first_name}", intakeTemplateVars(ctx, "l"))
    ).toBe("Hi Ada");
  });
});
