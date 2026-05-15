"use client";

import { useState, useEffect, useCallback } from "react";
import { SlideOver } from "@/components/ui/slide-over";

interface StandaloneSubmissionPanelProps {
  submissionId: string;
  onClose: () => void;
  onActioned: () => void;
}

interface FormField {
  label: string;
  value: string;
}

interface SubmissionDetail {
  id: string;
  form_name: string;
  patient: { id: string; name: string };
  submission_source: string;
  review_status: "pending" | "reviewed" | "archived" | string;
  created_at: string;
  identity: {
    first_name: string | null;
    last_name: string | null;
    date_of_birth: string | null;
    email: string | null;
    phone: string | null;
    resolution_kind: "existing" | "someone_else" | "new" | null;
  };
  duplicate: {
    possible_duplicate_patient_id: string | null;
    possible_duplicate_patient_name: string | null;
  } | null;
  fields: FormField[];
}

const SOURCE_LABEL: Record<string, string> = {
  standalone_public: "Public link",
  standalone_sms: "SMS",
  standalone_qr: "QR",
};

const RESOLUTION_LABEL: Record<string, string> = {
  existing: "confirmed existing patient",
  someone_else: "new patient on a shared phone",
  new: "new patient",
};

function CopyButton({ text, small }: { text: string; small?: boolean }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button
      onClick={handleCopy}
      className={`shrink-0 ${
        small
          ? "text-[10px] text-gray-400 hover:text-teal-600"
          : "rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50"
      }`}
    >
      {copied ? (small ? "✓" : "Copied!") : small ? "Copy" : "Copy all fields"}
    </button>
  );
}

/**
 * Slide-over detail panel for a standalone form submission. Mirrors
 * FormHandoffPanel's layout exactly so the staff experience is consistent
 * across appointment-bound transcription handoffs and standalone reviews.
 * Footer actions are state-aware: Mark reviewed only shows when pending,
 * Archive shows when pending or reviewed.
 */
export function StandaloneSubmissionPanel({
  submissionId,
  onClose,
  onActioned,
}: StandaloneSubmissionPanelProps) {
  const [detail, setDetail] = useState<SubmissionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<"review" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/forms/standalone/submissions/${submissionId}`);
      if (!res.ok) {
        setError("Couldn't load submission.");
        setDetail(null);
        return;
      }
      const data = (await res.json()) as SubmissionDetail;
      setDetail(data);
    } catch {
      setError("Couldn't reach the server.");
    } finally {
      setLoading(false);
    }
  }, [submissionId]);

  useEffect(() => {
    load();
  }, [load]);

  const act = async (kind: "review") => {
    setActing(kind);
    setError(null);
    try {
      const res = await fetch(
        `/api/forms/standalone/submissions/${submissionId}/${kind}`,
        { method: "POST" },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? `Couldn't ${kind} the submission.`);
        return;
      }
      onActioned();
    } catch {
      setError("Network error.");
    } finally {
      setActing(null);
    }
  };

  const status = detail?.review_status;
  const showReview = status === "pending";

  // Custom header: title inline with the X close button (replacing the
  // SlideOver's default header), with subtitle metadata stacked below.
  const customHeader = (
    <div className="border-b border-gray-200 px-5 py-4">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-sm font-semibold text-gray-800 min-w-0">
          Form completed: {detail?.form_name ?? "—"}
        </h2>
        <button
          onClick={onClose}
          className="p-1 text-gray-500 hover:text-gray-800 transition-colors rounded flex-shrink-0"
          aria-label="Close"
        >
          <svg
            className="h-5 w-5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      </div>
      <p className="text-xs text-gray-500 mt-0.5">
        {detail?.patient.name ?? "Unknown patient"}
        {detail?.created_at && (
          <>
            {" "}
            · Submitted{" "}
            {new Date(detail.created_at).toLocaleString("en-AU", {
              day: "numeric",
              month: "short",
              hour: "numeric",
              minute: "2-digit",
            })}
          </>
        )}
      </p>
      {detail && (
        <p className="text-xs text-gray-400 mt-1">
          Standalone submission · {SOURCE_LABEL[detail.submission_source] ?? detail.submission_source}
          {detail.identity.resolution_kind && (
            <> · {RESOLUTION_LABEL[detail.identity.resolution_kind] ?? detail.identity.resolution_kind}</>
          )}
        </p>
      )}
      {detail?.duplicate?.possible_duplicate_patient_name && (
        <p className="text-xs text-amber-600 mt-1">
          Possible duplicate of {detail.duplicate.possible_duplicate_patient_name}
        </p>
      )}
    </div>
  );

  return (
    <SlideOver open onClose={onClose} title="" width="w-[420px]" customHeader={customHeader}>
      <div className="flex h-full flex-col">
        {/* Field list */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="animate-pulse">
                  <div className="h-3 bg-gray-100 rounded w-1/3 mb-1" />
                  <div className="h-4 bg-gray-100 rounded w-2/3" />
                </div>
              ))}
            </div>
          ) : detail && detail.fields.length > 0 ? (
            <div className="space-y-3">
              {detail.fields.map((field, i) => (
                <div
                  key={i}
                  className="flex items-start justify-between gap-2 rounded-lg border border-gray-100 px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="text-[10px] font-medium text-gray-400 uppercase tracking-wide">
                      {field.label}
                    </p>
                    <p className="text-sm text-gray-800 break-words">
                      {field.value || "—"}
                    </p>
                  </div>
                  <CopyButton text={field.value} small />
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8">
              <p className="text-sm text-gray-500">
                {error ?? "No form fields to display"}
              </p>
            </div>
          )}

          {error && detail && (
            <p className="text-xs text-red-500 mt-4">{error}</p>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-gray-200 px-5 py-3 flex gap-2 justify-end">
          {detail && (
            <button
              onClick={() =>
                window.open(
                  `/api/forms/submissions/${detail.id}/pdf`,
                  "_blank",
                )
              }
              className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
            >
              Download form
            </button>
          )}
          {showReview && (
            <button
              onClick={() => act("review")}
              disabled={acting !== null}
              className="rounded-lg bg-teal-500 px-4 py-2 text-sm font-medium text-white hover:bg-teal-600 disabled:opacity-50"
            >
              {acting === "review" ? "Marking…" : "Mark reviewed"}
            </button>
          )}
        </div>
      </div>
    </SlideOver>
  );
}
