"use client";

import { useState, useEffect, useCallback } from "react";
import { getJson, postJson } from "@/lib/api-client";
import { useOrg } from "@/hooks/useOrg";
import { SlideOver } from "@/components/ui/slide-over";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { FormAssignmentStatus } from "@/lib/types/domain";
import { Select } from "@/components/ui/input";

interface AssignmentRow {
  id: string;
  token: string;
  status: FormAssignmentStatus;
  patient_first_name: string | null;
  patient_last_name: string | null;
  scheduled_at: string | null;
  sent_at: string | null;
  opened_at: string | null;
  completed_at: string | null;
}

interface PatientOption {
  id: string;
  first_name: string;
  last_name: string;
  phone_number: string | null;
}

const STATUS_BADGE: Record<
  FormAssignmentStatus,
  { label: string; variant: "gray" | "amber" | "teal" }
> = {
  pending: { label: "Pending", variant: "gray" },
  sent: { label: "Sent", variant: "amber" },
  opened: { label: "Opened", variant: "amber" },
  completed: { label: "Completed", variant: "teal" },
};

interface FormAssignmentsPanelProps {
  open: boolean;
  onClose: () => void;
  formId: string;
  formName: string;
}

export function FormAssignmentsPanel({
  open,
  onClose,
  formId,
  formName,
}: FormAssignmentsPanelProps) {
  const { org } = useOrg();
  const [assignments, setAssignments] = useState<AssignmentRow[]>([]);
  const [patients, setPatients] = useState<PatientOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPatientId, setSelectedPatientId] = useState("");
  const [sending, setSending] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const fetchAssignments = useCallback(async () => {
    setLoading(true);
    const result = await getJson<{ assignments: AssignmentRow[] }>(
      `/api/forms/assignments?form_id=${formId}`
    );
    if (result.ok) {
      setAssignments(result.data.assignments);
    }
    setLoading(false);
  }, [formId]);

  const fetchPatients = useCallback(async () => {
    if (!org) return;
    const result = await getJson<{ patients: PatientOption[] }>(
      `/api/forms/patients?org_id=${org.id}`
    );
    if (result.ok) {
      setPatients(result.data.patients);
    }
  }, [org]);

  useEffect(() => {
    if (open) {
      // Imperative refetch on panel open. fetchAssignments flips the loading
      // flag synchronously before its await — intentional, not a state sync.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      fetchAssignments();
      fetchPatients();
    }
  }, [open, fetchAssignments, fetchPatients]);

  const handleCreateAndSend = async () => {
    if (!selectedPatientId) return;
    setCreating(true);

    // Create assignment
    const createResult = await postJson<{ assignment: { id: string } }>(
      "/api/forms/assignments",
      { form_id: formId, patient_id: selectedPatientId },
      "Failed to create assignment"
    );

    if (!createResult.ok) {
      alert(createResult.error);
      setCreating(false);
      return;
    }

    // Send SMS
    const sendResult = await postJson(
      "/api/forms/assignments/send",
      { assignment_id: createResult.data.assignment.id },
      "Assignment created but SMS failed"
    );

    if (!sendResult.ok) {
      alert(sendResult.error);
    }

    setSelectedPatientId("");
    fetchAssignments();
    setCreating(false);
  };

  const handleResend = async (assignmentId: string) => {
    setSending(assignmentId);

    const result = await postJson(
      "/api/forms/assignments/send",
      { assignment_id: assignmentId },
      "Failed to send SMS"
    );

    if (!result.ok) {
      alert(result.error);
    }

    fetchAssignments();
    setSending(null);
  };

  const formatTime = (dateStr: string | null) => {
    if (!dateStr) return null;
    return new Date(dateStr).toLocaleString("en-AU", {
      day: "numeric",
      month: "short",
      hour: "numeric",
      minute: "2-digit",
    });
  };

  return (
    <SlideOver open={open} onClose={onClose} title={`Send: ${formName}`} width="w-[400px]">
      <div className="p-5 space-y-6">
        {/* New assignment */}
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-gray-800">
            Send to patient
          </h3>
          <Select
            value={selectedPatientId}
            onChange={(e) => setSelectedPatientId(e.target.value)}
          >
            <option value="">Select a patient...</option>
            {patients.map((p) => (
              <option key={p.id} value={p.id}>
                {p.first_name} {p.last_name}
                {p.phone_number ? ` (${p.phone_number})` : " (no phone)"}
              </option>
            ))}
          </Select>
          <Button
            onClick={handleCreateAndSend}
            disabled={!selectedPatientId || creating}
            size="sm"
          >
            {creating ? "Sending..." : "Create & Send SMS"}
          </Button>
        </div>

        {/* Existing assignments */}
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-gray-800">
            Assignments ({assignments.length})
          </h3>

          {loading ? (
            <div className="space-y-2">
              {[1, 2].map((i) => (
                <div
                  key={i}
                  className="h-16 animate-pulse rounded-lg border border-gray-200 bg-gray-50"
                />
              ))}
            </div>
          ) : assignments.length === 0 ? (
            <p className="text-sm text-gray-400">
              No assignments yet.
            </p>
          ) : (
            <div className="space-y-2">
              {assignments.map((a) => {
                const badge = STATUS_BADGE[a.status];
                return (
                  <div
                    key={a.id}
                    className="rounded-lg border border-gray-200 bg-white p-3"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="text-sm font-medium text-gray-800">
                          {a.patient_first_name} {a.patient_last_name}
                        </span>
                        <Badge variant={badge.variant} className="ml-2">
                          {badge.label}
                        </Badge>
                      </div>
                      {a.status !== "completed" && (
                        <button
                          onClick={() => handleResend(a.id)}
                          disabled={sending === a.id}
                          className="text-xs text-teal-600 hover:text-teal-700 disabled:opacity-50"
                        >
                          {sending === a.id ? "Sending..." : "Resend SMS"}
                        </button>
                      )}
                    </div>
                    <div className="mt-1 text-xs text-gray-400 space-x-3">
                      {a.sent_at && <span>Sent {formatTime(a.sent_at)}</span>}
                      {a.opened_at && (
                        <span>Opened {formatTime(a.opened_at)}</span>
                      )}
                      {a.completed_at && (
                        <span>Completed {formatTime(a.completed_at)}</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </SlideOver>
  );
}
