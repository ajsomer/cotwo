"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { postJson } from "@/lib/api-client";
import { useOrg } from "@/hooks/useOrg";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ConfirmModal } from "@/components/ui/modal";
import { FormAssignmentsPanel } from "./form-assignments-panel";
import { FilesPanel } from "./files-panel";
import { useClinicStore, getClinicStore } from "@/stores/clinic-store";
import type { FormRow } from "@/stores/clinic-store";
import type { FormStatus } from "@/lib/types/domain";
import { formatDayMonthYear } from "@/lib/runsheet/format";

type TabKey = "forms" | "files";

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
  const forms = useClinicStore((s) => s.forms);
  const loading = !useClinicStore((s) => s.formsLoaded);

  // Fetch-if-empty
  useEffect(() => {
    if (!org) return;
    if (!getClinicStore().formsLoaded) {
      void getClinicStore().refreshForms(org.id);
    }
  }, [org]);
  const [sendingForm, setSendingForm] = useState<FormRow | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>("forms");
  const [copiedFormId, setCopiedFormId] = useState<string | null>(null);
  const [deletingForm, setDeletingForm] = useState<{
    id: string;
    name: string;
  } | null>(null);

  const copyStandaloneLink = async (form: FormRow) => {
    const url = `${window.location.origin}/f/${form.public_token}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedFormId(form.id);
      setTimeout(() => setCopiedFormId((id) => (id === form.id ? null : id)), 2000);
    } catch {
      window.prompt("Copy this link:", url);
    }
  };

  const refetchForms = () => {
    if (org) getClinicStore().refreshForms(org.id);
  };

  const handleDelete = async (formId: string) => {
    setDeletingForm(null);

    const res = await fetch(`/api/forms?id=${formId}`, { method: "DELETE" });

    if (!res.ok) {
      const data = await res.json();
      alert(data.error ?? "Failed to delete form");
      return;
    }

    refetchForms();
  };

  const handleNew = async () => {
    if (!org) return;

    const result = await postJson<{ form: { id: string } }>("/api/forms", {
      org_id: org.id,
      name: "Untitled Form",
    });

    if (result.ok) {
      router.push(`/forms/${result.data.form.id}`);
    }
  };

  const formatDate = (dateStr: string) => {
    return formatDayMonthYear(dateStr);
  };

  if (!org) {
    return (
      <div className="p-6 text-sm text-gray-500">No organisation found.</div>
    );
  }

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-800">
          Forms & Files
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          Build and manage patient forms and files
        </p>
      </div>

      {/* Tab bar */}
      <div className="mb-5 flex gap-1 border-b border-gray-200">
        {(["forms", "files"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab
                ? "border-teal-500 text-teal-600"
                : "border-transparent text-gray-500 hover:text-gray-800"
            }`}
          >
            {tab === "forms" ? "Forms" : "Files"}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === "files" ? (
        <FilesPanel />
      ) : (
        <>
          <div className="mb-4 flex items-center justify-between">
            <p className="text-sm font-medium text-gray-800">Form builder</p>
            <Button onClick={handleNew} size="sm">
              + New form
            </Button>
          </div>
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
                            {form.status !== "archived" && (
                              <button
                                onClick={() => copyStandaloneLink(form)}
                                title={
                                  form.status === "draft"
                                    ? "Publish the form before sharing — the link won't resolve until then."
                                    : "Copy the standalone form link"
                                }
                                className="rounded px-2 py-1 text-xs text-teal-600 hover:bg-teal-50"
                              >
                                {copiedFormId === form.id ? "Copied!" : "Copy link"}
                              </button>
                            )}
                            {form.status === "published" && (
                              <button
                                onClick={() => setSendingForm(form)}
                                className="rounded px-2 py-1 text-xs text-teal-600 hover:bg-teal-50"
                              >
                                Send
                              </button>
                            )}
                            <button
                              onClick={() =>
                                setDeletingForm({ id: form.id, name: form.name })
                              }
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
                refetchForms();
              }}
              formId={sendingForm.id}
              formName={sendingForm.name}
            />
          )}

          <ConfirmModal
            open={!!deletingForm}
            title={`Delete "${deletingForm?.name}"?`}
            message="This cannot be undone."
            confirmLabel="Delete"
            destructive
            onConfirm={() => deletingForm && handleDelete(deletingForm.id)}
            onCancel={() => setDeletingForm(null)}
          />
        </>
      )}
    </div>
  );
}
