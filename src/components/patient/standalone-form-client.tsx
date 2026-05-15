"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import { Model } from "survey-core";
import { Survey } from "survey-react-ui";
import "survey-core/survey-core.min.css";
import { coviuTheme } from "@/lib/survey/theme";
import { IDENTITY_QUESTION_NAME } from "@/lib/survey/identity-field";
import {
  IDENTITY_PAGE_NAME,
  IDENTITY_FIELD_NAMES,
  ensureIdentityPage,
} from "@/lib/survey/identity-page";
import { PhoneVerification } from "./phone-verification";
import { PersistentHeader } from "./persistent-header";

// ---------------------------------------------------------------------------
// Source attribution persistence.
// On first load, read `src` from the URL, sanitize against the whitelist, and
// stash in sessionStorage keyed by token. Subsequent navigations within the
// flow read from sessionStorage so the value survives back/forward / refresh.
// Server re-sanitizes on submit, so this is convenience-only, not security.
// ---------------------------------------------------------------------------

function sanitizeSource(raw: string | null): string {
  if (!raw) return "standalone_public";
  if (raw === "sms" || raw === "standalone_sms") return "standalone_sms";
  if (raw === "qr" || raw === "standalone_qr") return "standalone_qr";
  return "standalone_public";
}
function persistSource(token: string): string {
  if (typeof window === "undefined") return "standalone_public";
  const storageKey = `coviu_standalone_src:${token}`;
  try {
    const stored = sessionStorage.getItem(storageKey);
    if (stored) return stored;

    const url = new URL(window.location.href);
    const raw = url.searchParams.get("src");
    const sanitized = sanitizeSource(raw);
    sessionStorage.setItem(storageKey, sanitized);
    return sanitized;
  } catch {
    return "standalone_public";
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface OrgSummary {
  name: string;
  logo_url: string | null;
}

interface FormPayload {
  id: string;
  name: string;
  description: string | null;
  schema: Record<string, unknown>;
  org_id: string;
}

interface PatientContact {
  id: string;
  first_name: string;
  last_name: string;
  date_of_birth: string | null;
}

type StandaloneFormProps =
  | { token: string; kind: "shareable"; form: FormPayload; org: OrgSummary | null }
  | {
      token: string;
      kind: "unavailable";
      reason: "draft" | "archived" | "unavailable";
      org: OrgSummary | null;
    }
  | { token: string; kind: "invalid" };

type Stage = "primer" | "otp" | "survey" | "submitting" | "complete";

// ---------------------------------------------------------------------------
// Runtime identity-page patching.
//
// Every form's schema contains the locked identity page (baked in at form
// creation; backfilled into older forms by migration 021). The page has the
// four capture fields and the intro HTML, but doesn't know about OTP results
// yet. The runtime patcher adds two dynamic pieces:
//
//   1. The existing-match radiogroup — only present when otp.matches is
//      non-empty. Choices = each matched patient + "Someone else".
//   2. Visibility rules on the four capture fields — hidden behind the
//      radiogroup unless the patient picked "Someone else" or there are
//      no matches at all.
//
// We also overwrite the intro HTML to surface the verified phone number, so
// the patient sees what they're confirming.
//
// Defense: if a form is somehow missing the identity page (older prototype
// data, schema tampering), ensureIdentityPage reinserts the static page
// before we apply the dynamic patches.
// ---------------------------------------------------------------------------

function patchIdentityPageForOtp(
  schema: Record<string, unknown>,
  matches: PatientContact[],
  phone: string,
): Record<string, unknown> {
  const ensured = ensureIdentityPage(schema);
  const pages = Array.isArray(ensured.pages) ? [...ensured.pages] : [];

  const idx = pages.findIndex(
    (p) =>
      typeof p === "object" &&
      p !== null &&
      (p as { name?: string }).name === IDENTITY_PAGE_NAME,
  );
  if (idx === -1) return ensured;

  const page = { ...(pages[idx] as Record<string, unknown>) };
  const elements = Array.isArray(page.elements) ? [...page.elements] : [];

  // Phone-aware intro HTML — overwrite whatever was baked in.
  const introIdx = elements.findIndex(
    (e) =>
      typeof e === "object" &&
      e !== null &&
      (e as { name?: string }).name === "__identity_intro",
  );
  const phoneHtml = `<p style="margin:0 0 12px;font-size:14px;color:#8A8985">Verified phone: <strong style="color:#2C2C2A">${phone}</strong></p>`;
  if (introIdx === -1) {
    elements.unshift({ type: "html", name: "__identity_intro", html: phoneHtml });
  } else {
    elements[introIdx] = {
      ...(elements[introIdx] as Record<string, unknown>),
      html: phoneHtml,
    };
  }

  const hasMatches = matches.length > 0;

  // Inject or remove the existing-match radiogroup depending on otp state.
  const existingIdx = elements.findIndex(
    (e) =>
      typeof e === "object" &&
      e !== null &&
      (e as { name?: string }).name === IDENTITY_FIELD_NAMES.existing,
  );
  if (hasMatches) {
    const choices = matches.map((m) => ({
      value: m.id,
      text: `${m.first_name} ${m.last_name}${m.date_of_birth ? ` — DOB ${m.date_of_birth}` : ""}`,
    }));
    choices.push({ value: "__someone_else", text: "Someone else" });
    const radiogroup = {
      type: "radiogroup",
      name: IDENTITY_FIELD_NAMES.existing,
      title: "Who's filling this out?",
      isRequired: true,
      choices,
    };
    if (existingIdx === -1) {
      // Insert just after the intro so the radiogroup sits at the top.
      const introPos = elements.findIndex(
        (e) =>
          typeof e === "object" &&
          e !== null &&
          (e as { name?: string }).name === "__identity_intro",
      );
      elements.splice(introPos === -1 ? 0 : introPos + 1, 0, radiogroup);
    } else {
      elements[existingIdx] = radiogroup;
    }
  } else if (existingIdx !== -1) {
    elements.splice(existingIdx, 1);
  }

  // Patch visibility on the four capture fields.
  const captureVisibleIf = hasMatches
    ? `{${IDENTITY_FIELD_NAMES.existing}} = '__someone_else'`
    : undefined;
  const captureNames: string[] = [
    IDENTITY_FIELD_NAMES.firstName,
    IDENTITY_FIELD_NAMES.lastName,
    IDENTITY_FIELD_NAMES.dateOfBirth,
    IDENTITY_FIELD_NAMES.email,
  ];
  for (let i = 0; i < elements.length; i++) {
    const el = elements[i] as Record<string, unknown>;
    if (!el || typeof el !== "object") continue;
    if (captureNames.includes(el.name as string)) {
      const next: Record<string, unknown> = { ...el };
      if (captureVisibleIf) {
        next.visibleIf = captureVisibleIf;
      } else {
        delete next.visibleIf;
      }
      elements[i] = next;
    }
  }

  page.elements = elements;
  pages[idx] = page;

  return { ...ensured, pages };
}

// ---------------------------------------------------------------------------
// Entrypoint dispatch
// ---------------------------------------------------------------------------

export function StandaloneFormClient(props: StandaloneFormProps) {
  if (props.kind === "invalid") {
    return <InvalidLink />;
  }

  if (props.kind === "unavailable") {
    return <Unavailable reason={props.reason} org={props.org} />;
  }

  return (
    <ShareableFlow token={props.token} form={props.form} org={props.org} />
  );
}

// ---------------------------------------------------------------------------
// Page shell — 420px-max container that mirrors the entry-flow layout.
// Does NOT render a header; callers compose PersistentHeader inside the shell.
// ---------------------------------------------------------------------------

function PageShell({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto w-full max-w-[420px]">{children}</div>;
}

// ---------------------------------------------------------------------------
// Invalid link — no branding (no clinic info to show)
// ---------------------------------------------------------------------------

function InvalidLink() {
  return (
    <div className="mx-auto w-full max-w-[420px] py-12 text-center">
      <h1 className="text-xl font-semibold text-gray-800">
        This link isn&apos;t valid
      </h1>
      <p className="mt-2 text-sm text-gray-500">
        Check that the URL is correct, or contact the clinic that sent it to you.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Unavailable — branded, reason-specific patient copy
// ---------------------------------------------------------------------------

function Unavailable({
  reason,
  org,
}: {
  reason: "draft" | "archived" | "unavailable";
  org: OrgSummary | null;
}) {
  const clinicName = org?.name ?? "the clinic";
  const message =
    reason === "draft"
      ? `This form isn't ready yet. Please check back later or contact ${clinicName}.`
      : reason === "archived"
        ? `This form is no longer in use. Please contact ${clinicName} if you need to fill out an alternative.`
        : `This form isn't available. Please contact ${clinicName}.`;

  return (
    <PageShell>
      <PersistentHeader
        clinicName={org?.name ?? ""}
        logoUrl={org?.logo_url ?? null}
      />
      <div className="rounded-2xl border border-gray-200 bg-white p-6 text-center">
        <h1 className="text-lg font-semibold text-gray-800">
          Form not available
        </h1>
        <p className="mt-2 text-sm text-gray-500">{message}</p>
      </div>
    </PageShell>
  );
}

// ---------------------------------------------------------------------------
// Shareable: the full multi-step flow
// ---------------------------------------------------------------------------

function ShareableFlow({
  token,
  form,
  org,
}: {
  token: string;
  form: FormPayload;
  org: OrgSummary | null;
}) {
  const [stage, setStage] = useState<Stage>("primer");
  const [otp, setOtp] = useState<{
    verificationId: string;
    phone: string;
    matches: PatientContact[];
  } | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    persistSource(token);
  }, [token]);

  const handleSubmit = useCallback(
    async (data: Record<string, unknown>) => {
      if (!otp) return;
      setStage("submitting");
      setSubmitError(null);

      const sanitizedSource =
        typeof window !== "undefined"
          ? sessionStorage.getItem(`coviu_standalone_src:${token}`) ??
            "standalone_public"
          : "standalone_public";

      // Read the identity fields out of the response payload and assemble
      // the patient_selection. The server validates everything; this is just
      // shape-conversion. Strip the __identity_* keys from the rest of the
      // responses so the server sees a clean author-fields-only payload to
      // store alongside the canonical patient_identity snapshot.
      const existingPick = data["__identity_existing"] as string | undefined;
      const captured = {
        first_name: (data["__identity_first_name"] as string | undefined) ?? "",
        last_name: (data["__identity_last_name"] as string | undefined) ?? "",
        date_of_birth:
          (data["__identity_date_of_birth"] as string | undefined) ?? "",
        email: (data["__identity_email"] as string | undefined) ?? "",
      };

      const matches = otp.matches;
      let patient_selection:
        | { kind: "existing"; patient_id: string }
        | { kind: "someone_else"; identity: typeof captured }
        | { kind: "new"; identity: typeof captured };

      if (matches.length > 0) {
        if (existingPick && existingPick !== "__someone_else") {
          patient_selection = { kind: "existing", patient_id: existingPick };
        } else {
          patient_selection = { kind: "someone_else", identity: captured };
        }
      } else {
        patient_selection = { kind: "new", identity: captured };
      }

      // Strip identity scratch keys from the responses payload — the server
      // composes responses.patient_identity itself, and any keys we leave
      // here would be redundant/noisy on the staff side.
      const cleanedResponses: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(data)) {
        if (!k.startsWith("__identity")) {
          cleanedResponses[k] = v;
        }
      }
      // Stash a placeholder under the canonical key so the client-side
      // payload has the right shape; the server overwrites it.
      cleanedResponses[IDENTITY_QUESTION_NAME] = {};

      try {
        const res = await fetch(`/api/forms/standalone/${token}/submit`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            verification_id: otp.verificationId,
            responses: cleanedResponses,
            source: sanitizedSource,
            patient_selection,
          }),
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          setSubmitError(
            (errData && errData.error) || "Couldn't submit. Please try again.",
          );
          setStage("survey");
          return;
        }

        setStage("complete");
      } catch {
        setSubmitError("Couldn't reach the server. Check your connection.");
        setStage("survey");
      }
    },
    [otp, token],
  );

  // Build the augmented SurveyJS Model once we've reached the survey stage.
  // useMemo binds it to the otp state so a re-OTP rebuilds the survey with
  // the new match set / phone.
  const surveyModel = useMemo(() => {
    if (stage !== "survey" && stage !== "submitting") return null;
    if (!otp) return null;
    const schema = patchIdentityPageForOtp(form.schema, otp.matches, otp.phone);
    const m = new Model(schema);
    m.applyTheme(coviuTheme);
    m.showTitle = false;
    m.showProgressBar = "off";
    return m;
  }, [stage, otp, form.schema]);

  useEffect(() => {
    if (!surveyModel) return;
    const handler = (sender: Model) =>
      handleSubmit(sender.data as Record<string, unknown>);
    surveyModel.onComplete.add(handler);
    return () => {
      surveyModel.onComplete.remove(handler);
    };
  }, [surveyModel, handleSubmit]);

  const headerProps = {
    clinicName: org?.name ?? "",
    logoUrl: org?.logo_url ?? null,
    roomName: null,
  };

  if (stage === "primer") {
    return (
      <PageShell>
        <PersistentHeader {...headerProps} />
        <div className="rounded-2xl border border-gray-200 bg-white p-6">
          <h1 className="text-xl font-semibold text-gray-800">{form.name}</h1>
          {form.description && (
            <p className="mt-2 text-sm text-gray-500">{form.description}</p>
          )}
          <p className="mt-4 text-sm text-gray-500">
            We&apos;ll verify your phone number, then walk you through the form.
          </p>
          <button
            onClick={() => setStage("otp")}
            className="mt-6 w-full rounded-lg bg-teal-500 px-6 py-3 text-base font-medium text-white transition-colors hover:bg-teal-600"
          >
            Get started
          </button>
        </div>
      </PageShell>
    );
  }

  if (stage === "otp") {
    return (
      <PageShell>
        <PhoneVerification
          clinicName={headerProps.clinicName}
          logoUrl={headerProps.logoUrl}
          roomName={null}
          currentStep={1}
          totalSteps={2}
          prefillPhone={null}
          sessionId={null}
          orgId={form.org_id}
          onVerified={(phone, verificationId, patients) => {
            setOtp({ verificationId, phone, matches: patients });
            setStage("survey");
          }}
        />
      </PageShell>
    );
  }

  if (stage === "survey" && surveyModel) {
    // Render to match the intake-journey FormStep: no outer card/border,
    // form name as an h1 above the survey, no SurveyJS progress bar (the
    // PersistentHeader's stepper carries that signal). Mirrors
    // src/components/patient/intake-journey.tsx FormStep render.
    return (
      <PageShell>
        <PersistentHeader {...headerProps} currentStep={2} totalSteps={2} />
        <div className="w-full">
          <h1 className="mb-3 text-xl font-semibold text-gray-800">
            {form.name}
          </h1>
          {submitError && (
            <p className="mb-2 text-sm text-red-500" role="alert">
              {submitError}
            </p>
          )}
          <Survey model={surveyModel} />
        </div>
      </PageShell>
    );
  }

  if (stage === "submitting") {
    return (
      <PageShell>
        <PersistentHeader {...headerProps} />
        <div className="rounded-2xl border border-gray-200 bg-white p-6 text-center text-sm text-gray-500">
          Submitting…
        </div>
      </PageShell>
    );
  }

  // complete
  return (
    <PageShell>
      <PersistentHeader {...headerProps} />
      <div className="rounded-2xl border border-gray-200 bg-white p-6 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-teal-50">
          <svg
            className="h-6 w-6 text-teal-500"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M4.5 12.75l6 6 9-13.5"
            />
          </svg>
        </div>
        <h1 className="text-xl font-semibold text-gray-800">Thanks</h1>
        <p className="mt-2 text-sm text-gray-500">
          We&apos;ve received your submission. You can close this page.
        </p>
      </div>
    </PageShell>
  );
}
