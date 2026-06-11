"use client";

import { useState, useEffect, useCallback } from "react";
import { postJson } from "@/lib/api-client";
import { SlideOver } from "@/components/ui/slide-over";
import { CloseButton } from "@/components/ui/close-button";
import { formatDayMonthTime } from "@/lib/runsheet/format";
import {
  fetchReviewData,
  standaloneSubmissionUrl,
} from "./review-prefetch-cache";
import {
  FieldRow,
  ReviewFooter,
  ReviewFooterButton,
  ReviewSkeleton,
} from "./review-panel-parts";

interface StandaloneSubmissionPanelProps {
  submissionId: string;
  // Optional seeds from the dashboard row — render the header before the
  // detail fetch returns instead of showing "—". The fetched `detail`
  // overrides once present. Note: the row carries `created_at`, which maps to
  // the panel's `detail.created_at` submitted timestamp.
  seedFormName?: string | null;
  seedPatientName?: string | null;
  seedCreatedAt?: string | null;
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

/**
 * Slide-over detail panel for a standalone form submission. Mirrors
 * FormHandoffPanel's layout exactly so the staff experience is consistent
 * across appointment-bound transcription handoffs and standalone reviews.
 * Footer actions are state-aware: Mark reviewed only shows when pending,
 * Archive shows when pending or reviewed.
 */
export function StandaloneSubmissionPanel({
  submissionId,
  seedFormName = null,
  seedPatientName = null,
  seedCreatedAt = null,
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
      const res = await fetchReviewData(standaloneSubmissionUrl(submissionId));
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
    const result = await postJson(
      `/api/forms/standalone/submissions/${submissionId}/${kind}`,
      undefined,
      `Couldn't ${kind} the submission.`
    );
    setActing(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onActioned();
  };

  const status = detail?.review_status;
  const showReview = status === "pending";

  // Custom header: title inline with the X close button (replacing the
  // SlideOver's default header), with subtitle metadata stacked below.
  const customHeader = (
    <div className="border-b border-gray-200 px-5 py-4">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-sm font-semibold text-gray-800 min-w-0">
          Form completed: {detail?.form_name ?? seedFormName ?? "—"}
        </h2>
        <CloseButton
          onClick={onClose}
          className="p-1 text-gray-500 hover:text-gray-800 transition-colors rounded flex-shrink-0"
        />
      </div>
      <p className="text-xs text-gray-500 mt-0.5">
        {detail?.patient.name ?? seedPatientName ?? "Unknown patient"}
        {(detail?.created_at ?? seedCreatedAt) && (
          <>
            {" "}
            · Submitted {formatDayMonthTime(detail?.created_at ?? seedCreatedAt!)}
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
            <ReviewSkeleton />
          ) : detail && detail.fields.length > 0 ? (
            <div className="space-y-3">
              {detail.fields.map((field, i) => (
                <FieldRow key={i} label={field.label} value={field.value} />
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
        <ReviewFooter>
          {detail && (
            <ReviewFooterButton
              onClick={() =>
                window.open(
                  `/api/forms/submissions/${detail.id}/pdf`,
                  "_blank",
                )
              }
            >
              Download form
            </ReviewFooterButton>
          )}
          {showReview && (
            <ReviewFooterButton
              variant="primary"
              onClick={() => act("review")}
              disabled={acting !== null}
            >
              {acting === "review" ? "Marking…" : "Mark reviewed"}
            </ReviewFooterButton>
          )}
        </ReviewFooter>
      </div>
    </SlideOver>
  );
}
