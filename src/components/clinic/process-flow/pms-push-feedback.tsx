"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

export interface PushFieldResultDTO {
  coviuQuestionName: string;
  target: string;
  label: string;
  attemptedValue: string;
  status: "written" | "skipped_existing" | "unmapped" | "failed";
  failureKind?: "validation" | "transport" | "auth" | "mapping";
  detail?: string;
}

interface SubmissionDTO {
  submissionId: string;
  formName: string;
  fields: PushFieldResultDTO[];
  pushStatus: "sent" | "partial" | "failed";
}

interface Props {
  providerLabel: string;
  patientName: string;
  submissions: SubmissionDTO[];
  patientWebLink: string | null;
  isBulk: boolean;
  onRetried: (submissionId: string, field: PushFieldResultDTO) => void;
  onComplete: () => void;
  onClose: () => void;
}

/** Per-field feedback list for the push (plan §6.1). */
export function PmsPushFeedback({
  providerLabel,
  patientName,
  submissions,
  patientWebLink,
  isBulk,
  onRetried,
  onComplete,
  onClose,
}: Props) {
  const allFields = submissions.flatMap((s) => s.fields);
  const written = allFields.filter((f) => f.status === "written").length;
  const kept = allFields.filter((f) => f.status === "skipped_existing").length;
  const failed = allFields.filter((f) => f.status === "failed").length;

  return (
    <div className="p-5 flex flex-col min-h-[300px] space-y-4">
      <div className="text-center">
        <p className="text-base font-semibold text-gray-800">
          Sent to {providerLabel}
        </p>
        <p className="text-sm text-gray-500 mt-1">{patientName}</p>
        <p className="text-xs text-gray-500 mt-2">
          {written} sent · {kept} kept · {failed} failed
        </p>
      </div>

      {allFields.length === 0 && (
        <p className="text-sm text-gray-500 text-center">
          No mapped fields to send.
        </p>
      )}

      <div className="space-y-4 overflow-y-auto">
        {submissions.map((s) => (
          <div key={s.submissionId}>
            {submissions.length > 1 && (
              <p className="text-xs font-medium text-gray-500 mb-1">{s.formName}</p>
            )}
            <ul className="space-y-1.5">
              {s.fields.map((f) => (
                <FieldRow
                  key={f.coviuQuestionName}
                  submissionId={s.submissionId}
                  field={f}
                  providerLabel={providerLabel}
                  patientWebLink={patientWebLink}
                  onRetried={onRetried}
                />
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="mt-auto pt-2">
        {isBulk ? (
          <Button onClick={onComplete} className="w-full">
            Next session
          </Button>
        ) : (
          <Button variant="secondary" onClick={onClose} className="w-full">
            Close
          </Button>
        )}
      </div>
    </div>
  );
}

function FieldRow({
  submissionId,
  field,
  providerLabel,
  patientWebLink,
  onRetried,
}: {
  submissionId: string;
  field: PushFieldResultDTO;
  providerLabel: string;
  patientWebLink: string | null;
  onRetried: (submissionId: string, field: PushFieldResultDTO) => void;
}) {
  const [value, setValue] = useState(field.attemptedValue);
  const [retrying, setRetrying] = useState(false);

  const retry = async () => {
    setRetrying(true);
    const res = await fetch("/api/pms/push/retry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        submissionId,
        questionName: field.coviuQuestionName,
        value,
      }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      field?: PushFieldResultDTO;
    };
    setRetrying(false);
    if (res.ok && data.ok && data.field) {
      onRetried(submissionId, data.field);
    }
  };

  return (
    <li className="rounded-lg border border-gray-200 px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm text-gray-800">{field.label}</span>
        <StatusPill status={field.status} />
      </div>

      {field.status === "skipped_existing" && (
        <p className="text-xs text-amber-600 mt-0.5">
          {field.detail ?? "Kept the value already in the PMS."}
        </p>
      )}
      {field.status === "unmapped" && (
        <p className="text-xs text-gray-500 mt-0.5">
          {field.detail ?? "Stays in Coviu only."}
        </p>
      )}

      {field.status === "failed" && (
        <div className="mt-1.5 space-y-1.5">
          <p className="text-xs text-red-500">{field.detail ?? "Couldn't send."}</p>
          {/* validation/mapping → editable; transport → just retry */}
          {field.failureKind !== "transport" && (
            <input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className="w-full rounded-md border border-gray-200 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
          )}
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={retry} disabled={retrying}>
              {retrying ? "Sending…" : "Send"}
            </Button>
            {patientWebLink && (
              <a
                href={patientWebLink}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-teal-600 hover:underline"
              >
                Open in {providerLabel} ↗
              </a>
            )}
          </div>
        </div>
      )}
    </li>
  );
}

function StatusPill({ status }: { status: PushFieldResultDTO["status"] }) {
  const map: Record<PushFieldResultDTO["status"], { text: string; cls: string }> = {
    written: { text: "Sent", cls: "bg-green-50 text-green-700" },
    skipped_existing: { text: "Kept", cls: "bg-amber-50 text-amber-700" },
    unmapped: { text: "Coviu only", cls: "bg-gray-100 text-gray-500" },
    failed: { text: "Failed", cls: "bg-red-50 text-red-600" },
  };
  const { text, cls } = map[status];
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${cls}`}>
      {text}
    </span>
  );
}
