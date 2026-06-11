"use client";

import { useCallback, useEffect, useState } from "react";
import { postJson } from "@/lib/api-client";
import { SlideOver } from "@/components/ui/slide-over";
import { formatDayMonthTime } from "@/lib/runsheet/format";
import {
  fetchReviewData,
  formSubmissionUrl,
} from "./review-prefetch-cache";
import {
  FieldRow,
  ReviewCopyButton,
  ReviewFooter,
  ReviewFooterButton,
  ReviewSkeleton,
} from "./review-panel-parts";

interface FormHandoffPanelProps {
  actionId: string;
  formName: string;
  submissionId?: string | null;
  patientName: string;
  appointmentId: string;
  /** Row's completed_at — seeds the header timestamp before the fetch lands. */
  submittedAt?: string | null;
  onClose: () => void;
  onTranscribed: () => void;
}

interface FormField {
  label: string;
  value: string;
}

export function FormHandoffPanel({
  actionId,
  formName,
  submissionId: initialSubmissionId,
  patientName,
  appointmentId,
  submittedAt: seedSubmittedAt = null,
  onClose,
  onTranscribed,
}: FormHandoffPanelProps) {
  const [fields, setFields] = useState<FormField[]>([]);
  const [loading, setLoading] = useState(true);
  const [marking, setMarking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Seed from the row's completed_at; the fetched value overrides once present.
  const [submittedAt, setSubmittedAt] = useState<string | null>(
    seedSubmittedAt
  );
  const [loadedSubmissionId, setLoadedSubmissionId] = useState<string | null>(null);

  const loadFormData = useCallback(async () => {
    try {
      // Reads an in-flight/resolved prefetch from the shared cache when one was
      // warmed on hover; otherwise fetches fresh. URL must match the prefetch
      // site's exactly — both go through formSubmissionUrl.
      const res = await fetchReviewData(
        formSubmissionUrl({
          appointmentId,
          formName,
          submissionId: initialSubmissionId,
        })
      );

      if (res.ok) {
        const data = await res.json();
        setFields(data.fields ?? []);
        if (data.submitted_at) setSubmittedAt(data.submitted_at);
        setLoadedSubmissionId(data.submission_id ?? null);
      } else {
        // If no dedicated endpoint exists, show a message
        setFields([]);
        setError("Form submission data not available for review.");
      }
    } catch {
      setError("Failed to load form data");
    } finally {
      setLoading(false);
    }
  }, [appointmentId, initialSubmissionId, formName]);

  useEffect(() => {
    void loadFormData();
  }, [loadFormData]);

  const handleMarkTranscribed = async () => {
    setMarking(true);
    setError(null);

    const result = await postJson(
      "/api/tasks/mark-transcribed",
      { action_id: actionId },
      "Failed to mark as transcribed"
    );
    setMarking(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    onTranscribed();
  };

  const allFieldsText = fields
    .map((f) => `${f.label}: ${f.value}`)
    .join("\n");

  return (
    <SlideOver open onClose={onClose} title="" width="w-[420px]">
      <div className="flex h-full flex-col">
        {/* Header */}
        <div className="border-b border-gray-200 px-5 py-4">
          <h2 className="text-sm font-semibold text-gray-800">
            Form completed: {formName}
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">
            {patientName}
            {submittedAt && (
              <>
                {" "}
                &middot; Submitted {formatDayMonthTime(submittedAt)}
              </>
            )}
          </p>
        </div>

        {/* Field list */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading ? (
            <ReviewSkeleton />
          ) : fields.length > 0 ? (
            <>
              {/* Bulk copy */}
              <div className="mb-4">
                <ReviewCopyButton text={allFieldsText} />
              </div>

              <div className="space-y-3">
                {fields.map((field, i) => (
                  <FieldRow key={i} label={field.label} value={field.value} />
                ))}
              </div>
            </>
          ) : (
            <div className="text-center py-8">
              <p className="text-sm text-gray-500">
                {error ?? "No form fields to display"}
              </p>
              <p className="text-xs text-gray-400 mt-1">
                The patient may not have submitted the form yet, or the
                submission data is not available for inline review.
              </p>
            </div>
          )}

          {error && fields.length > 0 && (
            <p className="text-xs text-red-500 mt-4">{error}</p>
          )}
        </div>

        {/* Footer */}
        <ReviewFooter>
          <ReviewFooterButton onClick={onClose}>Back</ReviewFooterButton>
          {loadedSubmissionId && (
            <ReviewFooterButton
              onClick={() =>
                window.open(
                  `/api/forms/submissions/${loadedSubmissionId}/pdf`,
                  "_blank",
                )
              }
            >
              Download form
            </ReviewFooterButton>
          )}
          <ReviewFooterButton
            variant="primary"
            onClick={handleMarkTranscribed}
            disabled={marking}
          >
            {marking ? "Marking..." : "Mark as transcribed"}
          </ReviewFooterButton>
        </ReviewFooter>
      </div>
    </SlideOver>
  );
}
