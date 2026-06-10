"use client";

import { useEffect, useRef, useState } from "react";
import { getJson } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { markSessionDone } from "@/lib/runsheet/actions";
import { formatPatientName } from "@/lib/runsheet/format";
import type { EnrichedSession } from "@/lib/types/domain";
import { PmsPushFeedback } from "./pms-push-feedback";
import type { PushFieldResultDTO } from "./pms-push-feedback";

interface ProcessFlowDoneProps {
  session: EnrichedSession;
  onComplete: () => void;
  onClose: () => void;
  isBulk: boolean;
}

interface PushGate {
  active: boolean;
  providerLabel: string | null;
  patientWebLink: string | null;
}

interface PushSubmissionDTO {
  submissionId: string;
  formName: string;
  fields: PushFieldResultDTO[];
  pushStatus: "sent" | "partial" | "failed";
}

export function ProcessFlowDone({
  session,
  onComplete,
  onClose,
  isBulk,
}: ProcessFlowDoneProps) {
  const hasMarked = useRef(false);
  // null = still resolving the gate; once known we either take the legacy path
  // or render the send-to-PMS UI.
  const [gate, setGate] = useState<PushGate | null>(null);
  const [gateResolved, setGateResolved] = useState(false);

  const [pushing, setPushing] = useState(false);
  const [submissions, setSubmissions] = useState<PushSubmissionDTO[] | null>(null);
  const [pushError, setPushError] = useState<string | null>(null);

  const patientName = formatPatientName(
    session.patient_first_name,
    session.patient_last_name
  );

  // 1. Resolve the gate. Gate FALSE → byte-for-byte today's behaviour
  //    (auto markSessionDone + auto-close). Plan §6.1, finding 6.
  useEffect(() => {
    let cancelled = false;
    async function resolveGate() {
      const params = new URLSearchParams({ sessionId: session.session_id });
      if (session.patient_id) params.set("patientId", session.patient_id);
      const result = await getJson<PushGate>(`/api/pms/push?${params.toString()}`);
      const data = result.ok
        ? result.data
        : { active: false, providerLabel: null, patientWebLink: null };
      if (!cancelled) {
        setGate(data);
        setGateResolved(true);
      }
    }
    resolveGate();
    return () => {
      cancelled = true;
    };
  }, [session.session_id, session.patient_id]);

  // 2. Legacy path: when the gate is resolved and inactive, mark done on mount
  //    and auto-advance for single processing — exactly as before.
  useEffect(() => {
    if (!gateResolved || gate?.active) return;
    if (!hasMarked.current) {
      hasMarked.current = true;
      markSessionDone(session.session_id);
    }
  }, [gateResolved, gate?.active, session.session_id]);

  useEffect(() => {
    if (!gateResolved || gate?.active) return;
    if (!isBulk) {
      const timer = setTimeout(onClose, 2000);
      return () => clearTimeout(timer);
    }
  }, [gateResolved, gate?.active, isBulk, onClose]);

  // ── Send-to-PMS path ──
  const handleCompleteAndSend = async () => {
    setPushing(true);
    setPushError(null);
    try {
      const res = await fetch("/api/pms/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: session.session_id }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        submissions?: PushSubmissionDTO[];
        error?: string;
      };
      if (res.ok && data.ok) {
        setSubmissions(data.submissions ?? []);
      } else {
        setPushError(data.error ?? "Send failed.");
        setSubmissions([]);
      }
    } catch {
      setPushError("Couldn't reach the server.");
      setSubmissions([]);
    } finally {
      // Completion is never blocked by a failed field (plan §6.1).
      if (!hasMarked.current) {
        hasMarked.current = true;
        markSessionDone(session.session_id);
      }
      setPushing(false);
    }
  };

  // ── Render ──

  // Resolving the gate — keep it quiet (no flash of the legacy tick).
  if (!gateResolved) {
    return (
      <div className="p-5 flex flex-col items-center justify-center min-h-[300px] text-center">
        <p className="text-sm text-gray-500">Finishing up…</p>
      </div>
    );
  }

  // Legacy / no-PMS path — unchanged confirmation UI.
  if (!gate?.active) {
    return <PlainDone patientName={patientName} isBulk={isBulk} onComplete={onComplete} onClose={onClose} />;
  }

  // PMS path: before send → the gated button; after → feedback.
  const providerLabel = gate.providerLabel ?? "PMS";

  if (submissions === null) {
    return (
      <div className="p-5 flex flex-col items-center justify-center min-h-[300px] text-center space-y-4">
        <div className="h-14 w-14 rounded-full bg-teal-500/10 flex items-center justify-center">
          <svg className="h-7 w-7 text-teal-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M13 6l6 6-6 6" />
          </svg>
        </div>
        <div>
          <p className="text-base font-semibold text-gray-800">
            Sync to {providerLabel}
          </p>
          <p className="text-sm text-gray-500 mt-1">{patientName}</p>
          <p className="text-xs text-gray-500 mt-2 max-w-xs">
            We&apos;ll write the patient&apos;s form details back to {providerLabel},
            then mark the session done.
          </p>
        </div>
        {pushError && <p className="text-sm text-red-500">{pushError}</p>}
        <Button onClick={handleCompleteAndSend} disabled={pushing} className="mt-2">
          {pushing ? "Syncing…" : `Sync to ${providerLabel}`}
        </Button>
      </div>
    );
  }

  // After push — per-field feedback list.
  return (
    <PmsPushFeedback
      providerLabel={providerLabel}
      patientName={patientName}
      submissions={submissions}
      patientWebLink={gate.patientWebLink}
      isBulk={isBulk}
      onRetried={(submissionId, field) => {
        setSubmissions((prev) =>
          (prev ?? []).map((s) =>
            s.submissionId === submissionId
              ? {
                  ...s,
                  fields: s.fields.map((f) =>
                    f.coviuQuestionName === field.coviuQuestionName ? field : f
                  ),
                }
              : s
          )
        );
      }}
      onComplete={onComplete}
      onClose={onClose}
    />
  );
}

/** The original confirmation UI, preserved verbatim for the no-PMS path. */
function PlainDone({
  patientName,
  isBulk,
  onComplete,
  onClose,
}: {
  patientName: string;
  isBulk: boolean;
  onComplete: () => void;
  onClose: () => void;
}) {
  return (
    <div className="p-5 flex flex-col items-center justify-center min-h-[300px] text-center space-y-4">
      <div className="h-16 w-16 rounded-full bg-green-500/10 flex items-center justify-center">
        <svg className="h-8 w-8 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      </div>
      <div>
        <p className="text-base font-semibold text-gray-800">Session processed</p>
        <p className="text-sm text-gray-500 mt-1">{patientName}</p>
      </div>
      {isBulk ? (
        <Button onClick={onComplete} className="mt-4">
          Next session
        </Button>
      ) : (
        <Button variant="secondary" onClick={onClose} className="mt-4">
          Close
        </Button>
      )}
    </div>
  );
}
