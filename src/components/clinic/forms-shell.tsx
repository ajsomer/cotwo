"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useOrg } from "@/hooks/useOrg";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FormAssignmentsPanel } from "./form-assignments-panel";
import type { FormStatus } from "@/lib/supabase/types";

interface FormRow {
  id: string;
  name: string;
  description: string | null;
  status: FormStatus;
  schema: Record<string, unknown>;
  updated_at: string;
  assignment_counts: { total: number; completed: number };
}

const STATUS_BADGE: Record<
  FormStatus,
  { label: string; variant: "teal" | "gray" | "amber" }
> = {
  draft: { label: "Draft", variant: "gray" },
  published: { label: "Published", variant: "teal" },
  archived: { label: "Archived", variant: "amber" },
};

export function FormsShell() {
  const { org } = useOrg();
  const router = useRouter();
  const [forms, setForms] = useState<FormRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sendingForm, setSendingForm] = useState<FormRow | null>(null);

  const fetchForms = useCallback(async () => {
    if (!org) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/forms?org_id=${org.id}`);
      const data = await res.json();
      if (res.ok) {
        setForms(data.forms);
      } else {
        setError(data.error);
      }
    } finally {
      setLoading(false);
    }
  }, [org]);

  useEffect(() => {
    fetchForms();
  }, [fetchForms]);

  const handleDelete = async (formId: string, formName: string) => {
    if (!confirm(`Delete "${formName}"? This cannot be undone.`)) return;

    const res = await fetch(`/api/forms?id=${formId}`, { method: "DELETE" });

    if (!res.ok) {
      const data = await res.json();
      alert(data.error ?? "Failed to delete form");
      return;
    }

    fetchForms();
  };

  const handleNew = async () => {
    if (!org) return;

    const res = await fetch("/api/forms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ org_id: org.id, name: "Untitled Form" }),
    });

    if (res.ok) {
      const data = await res.json();
      router.push(`/forms/${data.form.id}`);
    }
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString("en-AU", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  };

  if (!org) {
    return (
      <div className="p-6 text-sm text-gray-500">No organisation found.</div>
    );
  }

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-800">Forms</h1>
          <p className="mt-1 text-sm text-gray-500">
            Build and manage patient forms
          </p>
        </div>
        <Button onClick={handleNew}>+ New form</Button>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
          {error}
        </div>
      )}

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-16 animate-pulse rounded-xl border border-gray-200 bg-white"
            />
          ))}
        </div>
      ) : forms.length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white p-8 text-center">
          <p className="text-sm text-gray-500">
            No forms yet. Create your first form to get started.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50/50">
                <th className="px-4 py-3 text-left font-medium text-gray-500">
                  Name
                </th>
                <th className="w-28 px-4 py-3 text-left font-medium text-gray-500">
                  Status
                </th>
                <th className="w-28 px-4 py-3 text-left font-medium text-gray-500">
                  Assigned
                </th>
                <th className="w-32 px-4 py-3 text-left font-medium text-gray-500">
                  Updated
                </th>
                <th className="w-32 px-4 py-3 text-right font-medium text-gray-500">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {forms.map((form) => {
                const badge = STATUS_BADGE[form.status];
                const { total, completed } = form.assignment_counts;
                return (
                  <tr
                    key={form.id}
                    className="cursor-pointer border-b border-gray-100 last:border-0 hover:bg-gray-50/50"
                    onClick={() => router.push(`/forms/${form.id}`)}
                  >
                    <td className="px-4 py-3">
                      <span className="font-medium text-gray-800">
                        {form.name}
                      </span>
                      {form.description && (
                        <span className="ml-2 text-gray-400">
                          {form.description}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={badge.variant}>{badge.label}</Badge>
                    </td>
                    <td className="px-4 py-3 text-gray-500">
                      {total > 0 ? (
                        <span>
                          {completed}/{total}
                        </span>
                      ) : (
                        <span className="text-gray-400">&mdash;</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-500">
                      {formatDate(form.updated_at)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div
                        className="flex items-center justify-end gap-1"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          onClick={() => router.push(`/forms/${form.id}`)}
                          className="rounded px-2 py-1 text-xs text-gray-600 hover:bg-gray-100"
                        >
                          Edit
                        </button>
                        {form.status === "published" && (
                          <button
                            onClick={() => setSendingForm(form)}
                            className="rounded px-2 py-1 text-xs text-teal-600 hover:bg-teal-50"
                          >
                            Send
                          </button>
                        )}
                        <button
                          onClick={() => handleDelete(form.id, form.name)}
                          className="rounded px-2 py-1 text-xs text-red-500 hover:bg-red-50"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Assignments panel */}
      {sendingForm && (
        <FormAssignmentsPanel
          open={!!sendingForm}
          onClose={() => {
            setSendingForm(null);
            fetchForms();
          }}
          formId={sendingForm.id}
          formName={sendingForm.name}
        />
      )}
    </div>
  );
}
