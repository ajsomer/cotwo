"use client";

import { useState, useEffect, useCallback } from "react";
import { useOrg } from "@/hooks/useOrg";
import { SlideOver } from "@/components/ui/slide-over";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { FormAssignmentStatus } from "@/lib/supabase/types";

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
    try {
      const res = await fetch(`/api/forms/assignments?form_id=${formId}`);
      const data = await res.json();
      if (res.ok) {
        setAssignments(data.assignments);
      }
    } finally {
      setLoading(false);
    }
  }, [formId]);

  const fetchPatients = useCallback(async () => {
    if (!org) return;
    const res = await fetch(`/api/forms/patients?org_id=${org.id}`);
    const data = await res.json();
    if (res.ok) {
      setPatients(data.patients);
    }
  }, [org]);

  useEffect(() => {
    if (open) {
      fetchAssignments();
      fetchPatients();
    }
  }, [open, fetchAssignments, fetchPatients]);

  const handleCreateAndSend = async () => {
    if (!selectedPatientId) return;
    setCreating(true);

    try {
      // Create assignment
      const createRes = await fetch("/api/forms/assignments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          form_id: formId,
          patient_id: selectedPatientId,
        }),
      });

      if (!createRes.ok) {
        const data = await createRes.json();
        alert(data.error ?? "Failed to create assignment");
        return;
      }

      const { assignment } = await createRes.json();

      // Log patient form link for dev testing
      const formUrl = `${window.location.origin}/form/${assignment.token}`;
      console.log(`[Forms] Patient form link: ${formUrl}`);

      // Send SMS
      const sendRes = await fetch("/api/forms/assignments/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignment_id: assignment.id }),
      });

      if (!sendRes.ok) {
        const data = await sendRes.json();
        alert(data.error ?? "Assignment created but SMS failed");
      }

      setSelectedPatientId("");
      fetchAssignments();
    } finally {
      setCreating(false);
    }
  };

  const handleResend = async (assignmentId: string) => {
    setSending(assignmentId);

    try {
      const res = await fetch("/api/forms/assignments/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignment_id: assignmentId }),
      });

      if (!res.ok) {
        const data = await res.json();
        alert(data.error ?? "Failed to send SMS");
      }

      fetchAssignments();
    } finally {
      setSending(null);
    }
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
          <select
            value={selectedPatientId}
            onChange={(e) => setSelectedPatientId(e.target.value)}
            className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
          >
            <option value="">Select a patient...</option>
            {patients.map((p) => (
              <option key={p.id} value={p.id}>
                {p.first_name} {p.last_name}
                {p.phone_number ? ` (${p.phone_number})` : " (no phone)"}
              </option>
            ))}
          </select>
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
