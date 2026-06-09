/**
 * Shared @react-pdf/renderer document components + helpers for rendering form
 * submissions to PDF. Extracted from the single-submission route so both that
 * route and the appointment-scoped intake-package route can reuse the same
 * styling, answer rendering, and filename logic.
 *
 * Two documents are exported:
 *  - <SubmissionPdf>      one form on one page (single-submission download)
 *  - <IntakePackagePdf>   one page per form for an intake package, plus an
 *                         optional card-on-file / consent summary page.
 */

import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  Image,
} from "@react-pdf/renderer";
import type {
  NormalisedAnswer,
  NormalisedQuestion,
} from "@/lib/forms/format-answer-pdf";

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

export const styles = StyleSheet.create({
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
  sectionTitle: { fontSize: 11, fontWeight: 700, marginBottom: 8, color: "#2C2C2A" },
});

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString("en-AU", {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
}

function formatDob(dob: string | null): string | null {
  if (!dob) return null;
  const d = new Date(dob + "T00:00:00");
  return Number.isNaN(d.getTime())
    ? dob
    : d.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
}

const slug = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);

function yyyymmdd(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "unknown"
    : `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}

/** Filename for a single-form submission PDF. */
export function pdfFilename(patientName: string, formName: string, completedAt: string): string {
  return `${slug(patientName)}-${slug(formName)}-${yyyymmdd(completedAt)}.pdf`;
}

/** Filename for an intake-package PDF (multi-form). */
export function intakePackagePdfFilename(patientName: string, completedAt: string): string {
  return `${slug(patientName)}-intake-package-${yyyymmdd(completedAt)}.pdf`;
}

// ---------------------------------------------------------------------------
// Shared sub-components
// ---------------------------------------------------------------------------

function OrgHeader({ orgName, orgLogoUrl }: { orgName: string | null; orgLogoUrl: string | null }) {
  return (
    <View style={styles.header}>
      {orgLogoUrl ? (
        // eslint-disable-next-line jsx-a11y/alt-text -- @react-pdf/renderer Image doesn't accept alt
        <Image src={orgLogoUrl} style={styles.logo} />
      ) : null}
      {orgName ? <Text style={styles.orgName}>{orgName}</Text> : null}
    </View>
  );
}

export function AnswerView({ answer }: { answer: NormalisedAnswer }) {
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

/** A form's questions, or a muted "no submission" note when empty. */
function QuestionList({
  questions,
  emptyNote = "No submission data available.",
}: {
  questions: NormalisedQuestion[];
  emptyNote?: string;
}) {
  if (questions.length === 0) {
    return <Text style={styles.qValueMuted}>{emptyNote}</Text>;
  }
  return (
    <>
      {questions.map((q) => (
        <View key={q.name} style={styles.question} wrap={false}>
          <Text style={styles.qLabel}>{q.label}</Text>
          <AnswerView answer={q.answer} />
        </View>
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// Single-submission document
// ---------------------------------------------------------------------------

export interface SubmissionPdfProps {
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

export function SubmissionPdf(props: SubmissionPdfProps) {
  const dobFormatted = formatDob(props.patientDob);

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <OrgHeader orgName={props.orgName} orgLogoUrl={props.orgLogoUrl} />

        <Text style={styles.formTitle}>{props.formName}</Text>
        <Text style={styles.meta}>
          {props.patientName}
          {dobFormatted ? `  ·  DOB ${dobFormatted}` : ""}
          {`  ·  Submitted ${formatDateTime(props.completedAt)}`}
        </Text>

        <QuestionList questions={props.questions} emptyNote="No questions to render." />

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

// ---------------------------------------------------------------------------
// Intake-package document (multi-form + card/consent summary)
// ---------------------------------------------------------------------------

export interface IntakePackageFormSection {
  formId: string;
  formName: string;
  /** The submission row id, kept in the footer for audit. Null if none. */
  submissionId: string | null;
  /** Per-form completion time; falls back to the package completion time. */
  submittedAt: string | null;
  questions: NormalisedQuestion[];
}

export interface IntakePackagePdfProps {
  patientName: string;
  patientDob: string | null;
  orgName: string | null;
  orgLogoUrl: string | null;
  /** Package-level completion time — header + filename anchor. */
  completedAt: string;
  forms: IntakePackageFormSection[];
  /** Brand / last-four / captured timestamp only. Null when no card on file. */
  card: { brand: string; last_four: string; captured_at: string } | null;
  consent: { completed_at: string } | null;
}

export function IntakePackagePdf(props: IntakePackagePdfProps) {
  const dobFormatted = formatDob(props.patientDob);
  const metaLine = (
    <Text style={styles.meta}>
      {props.patientName}
      {dobFormatted ? `  ·  DOB ${dobFormatted}` : ""}
      {`  ·  Submitted ${formatDateTime(props.completedAt)}`}
    </Text>
  );

  const hasSummary = !!props.card || !!props.consent;

  return (
    <Document>
      {props.forms.map((form) => (
        <Page key={form.formId} size="A4" style={styles.page}>
          <OrgHeader orgName={props.orgName} orgLogoUrl={props.orgLogoUrl} />

          <Text style={styles.formTitle}>{form.formName}</Text>
          {metaLine}

          <QuestionList questions={form.questions} />

          <View style={styles.footer} fixed>
            <Text>
              Submitted via Coviu  ·  form: {form.formId}
              {form.submissionId ? `  ·  submission: ${form.submissionId}` : ""}
            </Text>
          </View>
        </Page>
      ))}

      {hasSummary ? (
        <Page size="A4" style={styles.page}>
          <OrgHeader orgName={props.orgName} orgLogoUrl={props.orgLogoUrl} />
          <Text style={styles.formTitle}>Intake package</Text>
          {metaLine}

          {props.card ? (
            <View style={styles.question} wrap={false}>
              <Text style={styles.sectionTitle}>Card on file</Text>
              <Text style={styles.qValue}>
                {props.card.brand}
                {props.card.last_four ? ` ending ${props.card.last_four}` : ""}
                {`  ·  captured ${formatDateTime(props.card.captured_at)}`}
              </Text>
            </View>
          ) : null}

          {props.consent ? (
            <View style={styles.question} wrap={false}>
              <Text style={styles.sectionTitle}>Consent</Text>
              <Text style={styles.qValue}>
                {`Recorded ${formatDateTime(props.consent.completed_at)}`}
              </Text>
            </View>
          ) : null}

          <View style={styles.footer} fixed>
            <Text>Submitted via Coviu  ·  intake package</Text>
          </View>
        </Page>
      ) : null}
    </Document>
  );
}
