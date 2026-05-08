import { NextRequest, NextResponse } from "next/server";
import { Document, Page, Text, View, StyleSheet, Image, renderToBuffer } from "@react-pdf/renderer";
import { createServiceClient } from "@/lib/supabase/service";
import {
  assertStaffCanAccessPatient,
  requireAuthenticatedUser,
} from "@/lib/auth/staff-access";
import {
  normaliseQuestions,
  type NormalisedAnswer,
  type NormalisedQuestion,
  type SchemaRoot,
} from "@/lib/forms/format-answer-pdf";

// GET /api/forms/submissions/[id]/pdf
// Renders a form submission as an inline PDF. Staff-only; org-scoped.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  // Cookie auth first — must precede any service-role lookup.
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }

  const supabase = createServiceClient();

  const { data: submission, error } = await supabase
    .from("form_submissions")
    .select("id, form_id, patient_id, appointment_id, responses, created_at")
    .eq("id", id)
    .single();

  if (error || !submission) {
    return NextResponse.json({ error: "Submission not found" }, { status: 404 });
  }

  const access = await assertStaffCanAccessPatient(supabase, submission.patient_id);
  if (!access.ok) {
    // 404 on the org-mismatch case — no existence leak.
    return NextResponse.json({ error: "Submission not found" }, { status: 404 });
  }

  const [formRes, assignmentRes, patientRes, orgRes] = await Promise.all([
    supabase.from("forms").select("name, schema").eq("id", submission.form_id).single(),
    supabase
      .from("form_assignments")
      .select("schema_snapshot, completed_at")
      .eq("submission_id", id)
      .maybeSingle(),
    supabase
      .from("patients")
      .select("first_name, last_name, date_of_birth, org_id")
      .eq("id", submission.patient_id)
      .single(),
    (async () => {
      const { data: p } = await supabase
        .from("patients")
        .select("org_id")
        .eq("id", submission.patient_id)
        .single();
      if (!p?.org_id) return { data: null };
      return supabase
        .from("organisations")
        .select("name, logo_url")
        .eq("id", p.org_id)
        .single();
    })(),
  ]);

  // Schema source: prefer assignment-level snapshot (taken at send time),
  // fall back to forms.schema (current published schema) for intake-package
  // submissions which have no assignment row.
  const snapshot = assignmentRes.data?.schema_snapshot as SchemaRoot | null | undefined;
  const fallbackSchema = (formRes.data?.schema as SchemaRoot | null | undefined) ?? null;
  const schema = snapshot ?? fallbackSchema ?? null;
  const usedFallbackSchema = !snapshot && !!fallbackSchema;

  const responses = (submission.responses as Record<string, unknown>) ?? {};
  const questions = normaliseQuestions(schema, responses);

  const completedAt = assignmentRes.data?.completed_at ?? submission.created_at;
  const formName = formRes.data?.name ?? "Form";
  const patientName = patientRes.data
    ? `${patientRes.data.first_name} ${patientRes.data.last_name}`
    : "Patient";
  const dob = patientRes.data?.date_of_birth ?? null;
  const orgName = orgRes.data?.name ?? null;
  const orgLogoUrl = orgRes.data?.logo_url ?? null;

  const buffer = await renderToBuffer(
    <SubmissionPdf
      formName={formName}
      patientName={patientName}
      patientDob={dob}
      orgName={orgName}
      orgLogoUrl={orgLogoUrl}
      completedAt={completedAt}
      questions={questions}
      formId={submission.form_id}
      submissionId={submission.id}
      usedFallbackSchema={usedFallbackSchema}
    />,
  );

  // ArrayBuffer cast keeps TS happy with the Response body type.
  return new Response(buffer as unknown as ArrayBuffer, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${pdfFilename(patientName, formName, completedAt)}"`,
      "Cache-Control": "private, no-cache",
    },
  });
}

function pdfFilename(patientName: string, formName: string, completedAt: string): string {
  const date = new Date(completedAt);
  const yyyymmdd = Number.isNaN(date.getTime())
    ? "unknown"
    : `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
  const slug = (s: string) =>
    s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return `${slug(patientName)}-${slug(formName)}-${yyyymmdd}.pdf`;
}

// ---------------------------------------------------------------------------
// PDF document
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  page: { padding: 40, fontSize: 10, fontFamily: "Helvetica", color: "#2C2C2A" },
  header: { flexDirection: "row", alignItems: "center", marginBottom: 18, gap: 10 },
  logo: { width: 36, height: 36, objectFit: "contain" },
  orgName: { fontSize: 12, fontWeight: 600, color: "#2C2C2A" },
  formTitle: { fontSize: 16, fontWeight: 700, marginBottom: 4 },
  meta: { fontSize: 9, color: "#8A8985", marginBottom: 18 },
  question: { marginBottom: 12 },
  qLabel: { fontSize: 10, fontWeight: 600, color: "#2C2C2A", marginBottom: 3 },
  qValue: { fontSize: 10, color: "#2C2C2A" },
  qValueMuted: { fontSize: 10, color: "#8A8985" },
  qList: { marginLeft: 10, fontSize: 10 },
  qMatrixRow: { flexDirection: "row", gap: 6, marginBottom: 2 },
  qMatrixLabel: { width: 140, color: "#8A8985" },
  qMatrixValue: { flex: 1 },
  divider: { height: 1, backgroundColor: "#E2E1DE", marginVertical: 14 },
  footer: { position: "absolute", bottom: 30, left: 40, right: 40, fontSize: 8, color: "#8A8985" },
  footerNote: { fontSize: 8, color: "#B8741F", marginTop: 2 },
});

interface SubmissionPdfProps {
  formName: string;
  patientName: string;
  patientDob: string | null;
  orgName: string | null;
  orgLogoUrl: string | null;
  completedAt: string;
  questions: NormalisedQuestion[];
  formId: string;
  submissionId: string;
  usedFallbackSchema: boolean;
}

function SubmissionPdf(props: SubmissionPdfProps) {
  const completedDate = new Date(props.completedAt);
  const completedFormatted = Number.isNaN(completedDate.getTime())
    ? props.completedAt
    : completedDate.toLocaleString("en-AU", {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });

  const dobFormatted = props.patientDob
    ? new Date(props.patientDob + "T00:00:00").toLocaleDateString("en-AU", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : null;

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          {props.orgLogoUrl ? (
            // eslint-disable-next-line jsx-a11y/alt-text -- @react-pdf/renderer Image doesn't accept alt
            <Image src={props.orgLogoUrl} style={styles.logo} />
          ) : null}
          {props.orgName ? <Text style={styles.orgName}>{props.orgName}</Text> : null}
        </View>

        <Text style={styles.formTitle}>{props.formName}</Text>
        <Text style={styles.meta}>
          {props.patientName}
          {dobFormatted ? `  ·  DOB ${dobFormatted}` : ""}
          {`  ·  Submitted ${completedFormatted}`}
        </Text>

        {props.questions.length === 0 ? (
          <Text style={styles.qValueMuted}>No questions to render.</Text>
        ) : (
          props.questions.map((q) => (
            <View key={q.name} style={styles.question} wrap={false}>
              <Text style={styles.qLabel}>{q.label}</Text>
              <AnswerView answer={q.answer} />
            </View>
          ))
        )}

        <View style={styles.footer} fixed>
          <Text>
            Submitted via Coviu  ·  form: {props.formId}  ·  submission: {props.submissionId}
          </Text>
          {props.usedFallbackSchema ? (
            <Text style={styles.footerNote}>
              Rendered from the form&apos;s current schema (assignment-level snapshot was unavailable).
            </Text>
          ) : null}
        </View>
      </Page>
    </Document>
  );
}

function AnswerView({ answer }: { answer: NormalisedAnswer }) {
  switch (answer.kind) {
    case "empty":
      return <Text style={styles.qValueMuted}>—</Text>;
    case "scalar":
      return <Text style={styles.qValue}>{answer.value}</Text>;
    case "multiline":
      return (
        <View>
          {answer.value.split(/\r?\n/).map((line, i) => (
            <Text key={i} style={styles.qValue}>
              {line || " "}
            </Text>
          ))}
        </View>
      );
    case "list":
      return (
        <View style={styles.qList}>
          {answer.values.map((v, i) => (
            <Text key={i} style={styles.qValue}>
              {`•  ${v}`}
            </Text>
          ))}
        </View>
      );
    case "matrix":
      return (
        <View>
          {answer.rows.map((r, i) => (
            <View key={i} style={styles.qMatrixRow}>
              <Text style={styles.qMatrixLabel}>{r.label}</Text>
              <Text style={styles.qMatrixValue}>{r.value || "—"}</Text>
            </View>
          ))}
        </View>
      );
    case "object":
      return (
        <View>
          {answer.entries.map((e, i) => (
            <View key={i} style={styles.qMatrixRow}>
              <Text style={styles.qMatrixLabel}>{e.label}</Text>
              <Text style={styles.qMatrixValue}>{e.value || "—"}</Text>
            </View>
          ))}
        </View>
      );
    case "file":
      return <Text style={styles.qValueMuted}>{answer.placeholder}</Text>;
  }
}
