import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { broadcastOrgSubmissionChange } from "@/lib/realtime/broadcast";
import {
  IDENTITY_QUESTION_NAME,
  type IdentitySnapshot,
} from "@/lib/survey/identity-field";

type SubmitBody = {
  verification_id?: string;
  responses?: Record<string, unknown>;
  source?: string;
  patient_selection?:
    | { kind: "existing"; patient_id: string }
    | { kind: "someone_else"; identity: IdentityInput }
    | { kind: "new"; identity: IdentityInput };
};

type IdentityInput = {
  first_name?: string;
  last_name?: string;
  date_of_birth?: string;
  email?: string;
};

const SOURCE_WHITELIST: Record<string, "standalone_sms" | "standalone_qr"> = {
  sms: "standalone_sms",
  standalone_sms: "standalone_sms",
  qr: "standalone_qr",
  standalone_qr: "standalone_qr",
};

function sanitizeSource(
  raw: string | undefined | null,
): "standalone_public" | "standalone_sms" | "standalone_qr" {
  if (!raw) return "standalone_public";
  return SOURCE_WHITELIST[raw] ?? "standalone_public";
}

function validateIdentity(
  identity: IdentityInput | undefined,
): { ok: true; value: Required<IdentityInput> } | { ok: false; error: string } {
  if (!identity) return { ok: false, error: "identity payload required" };
  const { first_name, last_name, date_of_birth, email } = identity;
  if (!first_name || !last_name || !date_of_birth || !email) {
    return {
      ok: false,
      error: "first_name, last_name, date_of_birth, and email are required",
    };
  }
  // YYYY-MM-DD validation — Postgres DATE column accepts ISO date strings.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date_of_birth)) {
    return { ok: false, error: "date_of_birth must be YYYY-MM-DD" };
  }
  return {
    ok: true,
    value: { first_name, last_name, date_of_birth, email },
  };
}

/**
 * POST /api/forms/standalone/[public_token]/submit
 *
 * Submission endpoint for standalone forms. See spec for the full contract:
 * docs/specs/standalone-forms-spec.md
 *
 * Critical security invariants enforced here:
 *  1. Form must be published — re-checked server-side regardless of what the
 *     GET returned to the client.
 *  2. OTP verification_id must resolve to a verified record whose phone is
 *     the source of the match-set the patient selection is validated against.
 *  3. Patient selection.kind drives different validation:
 *     - "existing": patient_id MUST be in the server-resolved OTP match set
 *     - "someone_else": match set MUST be non-empty (shared phone case)
 *     - "new": match set MUST be empty
 *  4. responses.patient_identity and responses.__server_meta are SERVER-OWNED.
 *     Whatever the client put in those keys is discarded; the server builds
 *     them from the validated identity/resolution.
 *  5. source is sanitized to the whitelist; arbitrary strings never reach the
 *     submission_source column.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ public_token: string }> },
) {
  const { public_token } = await params;
  if (!public_token) {
    return NextResponse.json({}, { status: 404 });
  }

  let body: SubmitBody;
  try {
    body = (await request.json()) as SubmitBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { verification_id, responses, source, patient_selection } = body;

  if (!verification_id) {
    return NextResponse.json(
      { error: "verification_id required" },
      { status: 400 },
    );
  }
  if (!responses || typeof responses !== "object") {
    return NextResponse.json({ error: "responses required" }, { status: 400 });
  }
  if (!patient_selection || typeof patient_selection !== "object") {
    return NextResponse.json(
      { error: "patient_selection required" },
      { status: 400 },
    );
  }

  const supabase = createServiceClient();

  // 1. Resolve form by public token and re-enforce publish state.
  const { data: form } = await supabase
    .from("forms")
    .select("id, status, org_id")
    .eq("public_token", public_token)
    .maybeSingle();

  if (!form) {
    return NextResponse.json({}, { status: 404 });
  }
  if (form.status !== "published") {
    // Flat 404 — no typed reason on submit (page already gated via GET).
    return NextResponse.json({}, { status: 404 });
  }

  // 2. Verify the OTP record and pull the verified phone.
  const { data: verification } = await supabase
    .from("phone_verifications")
    .select("phone_number, verified_at, expires_at")
    .eq("id", verification_id)
    .maybeSingle();

  if (!verification || !verification.verified_at) {
    return NextResponse.json(
      { error: "OTP verification not found or unverified" },
      { status: 400 },
    );
  }
  // Defense in depth — the OTP send route sets a 5-minute expiry; we accept
  // a verified record as long as it isn't ancient (24h ceiling on stale
  // tokens). This window can be tightened later if needed.
  const verifiedAge = Date.now() - new Date(verification.verified_at).getTime();
  if (verifiedAge > 24 * 60 * 60 * 1000) {
    return NextResponse.json(
      { error: "OTP session expired, please verify again" },
      { status: 410 },
    );
  }

  const verifiedPhone = verification.phone_number;

  // 3. Server-resolve the OTP match set for this phone at the form's org.
  // Do NOT trust any match set sent by the client.
  const { data: phoneMatches } = await supabase
    .from("patient_phone_numbers")
    .select("patient_id, patients!inner(id, first_name, last_name, date_of_birth, org_id)")
    .eq("phone_number", verifiedPhone);

  type PhoneMatch = {
    patient_id: string;
    patients:
      | {
          id: string;
          first_name: string;
          last_name: string;
          date_of_birth: string | null;
          org_id: string;
        }
      | {
          id: string;
          first_name: string;
          last_name: string;
          date_of_birth: string | null;
          org_id: string;
        }[]
      | null;
  };

  const matchSet = ((phoneMatches as PhoneMatch[] | null) ?? [])
    .map((row) => {
      const p = row.patients;
      const patient = Array.isArray(p) ? p[0] : p;
      return patient;
    })
    .filter((p): p is NonNullable<typeof p> => !!p && p.org_id === form.org_id);

  // 4. Validate patient_selection against the server-resolved match set,
  //    then resolve to a patient_id (creating a new patient if needed).
  let resolvedPatientId: string;
  let resolutionKind: "existing" | "someone_else" | "new";
  let snapshotIdentity: Required<IdentityInput>;
  let duplicateSuspectedMeta: {
    duplicate_suspected: true;
    possible_duplicate_patient_id: string;
    possible_duplicate_patient_name: string;
  } | null = null;

  if (patient_selection.kind === "existing") {
    const inSet = matchSet.find((m) => m.id === patient_selection.patient_id);
    if (!inSet) {
      return NextResponse.json(
        { error: "Selected patient is not on this phone" },
        { status: 403 },
      );
    }
    resolvedPatientId = inSet.id;
    resolutionKind = "existing";
    snapshotIdentity = {
      first_name: inSet.first_name,
      last_name: inSet.last_name,
      date_of_birth: inSet.date_of_birth ?? "",
      // Patients table has no email column today — snapshot holds the email
      // for audit, but it can't be sourced from the patient record for the
      // existing branch. Leave empty in the snapshot.
      email: "",
    };
  } else if (patient_selection.kind === "someone_else") {
    if (matchSet.length === 0) {
      return NextResponse.json(
        { error: "No matching patients on this phone; use kind=new" },
        { status: 400 },
      );
    }
    const v = validateIdentity(patient_selection.identity);
    if (!v.ok) {
      return NextResponse.json({ error: v.error }, { status: 400 });
    }
    snapshotIdentity = v.value;

    // Soft duplicate check: same first/last/DOB on this phone.
    const dup = matchSet.find(
      (m) =>
        m.first_name.toLowerCase() === v.value.first_name.toLowerCase() &&
        m.last_name.toLowerCase() === v.value.last_name.toLowerCase() &&
        m.date_of_birth === v.value.date_of_birth,
    );
    if (dup) {
      duplicateSuspectedMeta = {
        duplicate_suspected: true,
        possible_duplicate_patient_id: dup.id,
        possible_duplicate_patient_name: `${dup.first_name} ${dup.last_name}`,
      };
    }

    const { data: newPatient, error: insertErr } = await supabase
      .from("patients")
      .insert({
        org_id: form.org_id,
        first_name: v.value.first_name,
        last_name: v.value.last_name,
        date_of_birth: v.value.date_of_birth,
      })
      .select("id")
      .single();

    if (!newPatient || insertErr) {
      console.error(
        "[standalone-forms] someone_else patient insert failed:",
        insertErr,
      );
      return NextResponse.json(
        { error: "Failed to create patient" },
        { status: 500 },
      );
    }
    resolvedPatientId = newPatient.id;
    resolutionKind = "someone_else";

    await supabase.from("patient_phone_numbers").insert({
      patient_id: resolvedPatientId,
      phone_number: verifiedPhone,
      verified_at: new Date().toISOString(),
    });
  } else if (patient_selection.kind === "new") {
    if (matchSet.length > 0) {
      return NextResponse.json(
        {
          error:
            "Phone is already linked to one or more patients; use existing or someone_else",
        },
        { status: 409 },
      );
    }
    const v = validateIdentity(patient_selection.identity);
    if (!v.ok) {
      return NextResponse.json({ error: v.error }, { status: 400 });
    }
    snapshotIdentity = v.value;

    const { data: newPatient, error: insertErr } = await supabase
      .from("patients")
      .insert({
        org_id: form.org_id,
        first_name: v.value.first_name,
        last_name: v.value.last_name,
        date_of_birth: v.value.date_of_birth,
      })
      .select("id")
      .single();

    if (!newPatient || insertErr) {
      console.error(
        "[standalone-forms] new patient insert failed:",
        insertErr,
      );
      return NextResponse.json(
        { error: "Failed to create patient" },
        { status: 500 },
      );
    }
    resolvedPatientId = newPatient.id;
    resolutionKind = "new";

    await supabase.from("patient_phone_numbers").insert({
      patient_id: resolvedPatientId,
      phone_number: verifiedPhone,
      verified_at: new Date().toISOString(),
    });
  } else {
    return NextResponse.json(
      { error: "Invalid patient_selection.kind" },
      { status: 400 },
    );
  }

  // 5. Build server-owned response blocks.
  // Strip anything the client put under the server-owned keys.
  const clientResponses = { ...responses };
  delete (clientResponses as Record<string, unknown>)[IDENTITY_QUESTION_NAME];
  delete (clientResponses as Record<string, unknown>).__server_meta;

  const identitySnapshot: IdentitySnapshot = {
    first_name: snapshotIdentity.first_name,
    last_name: snapshotIdentity.last_name,
    date_of_birth: snapshotIdentity.date_of_birth,
    email: snapshotIdentity.email,
    phone: verifiedPhone, // Always server-forced, never client-trusted.
    resolved_patient_id: resolvedPatientId,
    resolution_kind: resolutionKind,
  };

  const serverMeta = duplicateSuspectedMeta ?? undefined;

  const finalResponses: Record<string, unknown> = {
    ...clientResponses,
    [IDENTITY_QUESTION_NAME]: identitySnapshot,
  };
  if (serverMeta) {
    finalResponses.__server_meta = serverMeta;
  }

  // 6. Sanitize source.
  const submissionSource = sanitizeSource(source);

  // 7. Insert the submission.
  const { data: submission, error: subErr } = await supabase
    .from("form_submissions")
    .insert({
      form_id: form.id,
      patient_id: resolvedPatientId,
      appointment_id: null,
      responses: finalResponses,
      submission_source: submissionSource,
      review_status: "pending",
    })
    .select("id")
    .single();

  if (!submission || subErr) {
    console.error("[standalone-forms] submission insert failed:", subErr);
    return NextResponse.json(
      { error: "Failed to save submission" },
      { status: 500 },
    );
  }

  // 8. Emit org-room event so Readiness sections refresh in real-time.
  // Non-fatal: helper logs and swallows.
  await broadcastOrgSubmissionChange(form.org_id, "submission_created", {
    submission_id: submission.id,
    form_id: form.id,
  });

  return NextResponse.json({ ok: true, submission_id: submission.id });
}
