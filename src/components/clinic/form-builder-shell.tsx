"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { SurveyCreatorComponent, SurveyCreator } from "survey-creator-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FormFillClient } from "@/components/patient/form-fill-client";
import { useOrg } from "@/hooks/useOrg";
import type { FormStatus } from "@/lib/supabase/types";
import { coviuTheme } from "@/lib/survey/theme";

import "survey-core/survey-core.min.css";
import "survey-creator-core/survey-creator-core.min.css";

interface FormBuilderShellProps {
  formId: string;
}

const STATUS_BADGE: Record<
  FormStatus,
  { label: string; variant: "teal" | "gray" | "amber" }
> = {
  draft: { label: "Draft", variant: "gray" },
  published: { label: "Published", variant: "teal" },
  archived: { label: "Archived", variant: "amber" },
};

export function FormBuilderShell({ formId }: FormBuilderShellProps) {
  const router = useRouter();
  const { org } = useOrg();
  const [name, setName] = useState("");
  const nameRef = useRef(name);
  const [status, setStatus] = useState<FormStatus>("draft");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creator, setCreator] = useState<SurveyCreator | null>(null);
  const [previewing, setPreviewing] = useState(false);

  // Fetch form and initialize creator
  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/forms/${formId}`);
        if (!res.ok) {
          setError("Form not found");
          setLoading(false);
          return;
        }

        const { form } = await res.json();
        setName(form.name);
        nameRef.current = form.name;
        setStatus(form.status);

        const c = new SurveyCreator({
          showLogicTab: false,
          showTranslationTab: false,
          showEmbeddedSurveyTab: false,
          showJSONEditorTab: process.env.NODE_ENV === "development",
          showPreviewTab: false,
          questionTypes: [
            "text",
            "comment",
            "radiogroup",
            "checkbox",
            "dropdown",
            "boolean",
            "rating",
            "matrix",
            "html",
            "panel",
            "file",
            "signaturepad",
            "paneldynamic",
            "multipletext",
            "tagbox",
            "ranking",
          ],
        });

        // Apply Coviu theme to the preview
        c.theme = coviuTheme;

        // Load existing schema
        const schema = form.schema;
        if (schema && Object.keys(schema).length > 0) {
          c.JSON = schema;
        }

        setCreator(c);
        setLoading(false);
      } catch {
        setError("Failed to load form");
        setLoading(false);
      }
    }

    load();
  }, [formId]);

  const handleSave = useCallback(async () => {
    if (!creator) return;
    setSaving(true);
    setError(null);

    try {
      const res = await fetch("/api/forms", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: formId,
          name: nameRef.current,
          schema: creator.JSON,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? "Failed to save");
      }
    } catch {
      setError("Failed to save");
    } finally {
      setSaving(false);
    }
  }, [creator, formId]);

  const handlePublish = useCallback(async () => {
    if (!creator) return;
    setSaving(true);
    setError(null);

    try {
      const res = await fetch("/api/forms", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: formId,
          name: nameRef.current,
          schema: creator.JSON,
          status: "published",
        }),
      });

      if (res.ok) {
        setStatus("published");
      } else {
        const data = await res.json();
        setError(data.error ?? "Failed to publish");
      }
    } catch {
      setError("Failed to publish");
    } finally {
      setSaving(false);
    }
  }, [creator, formId]);

  if (loading) {
    return (
      <div className="p-6">
        <div className="mb-6 h-10 w-64 animate-pulse rounded-lg bg-gray-200" />
        <div className="h-[600px] animate-pulse rounded-xl border border-gray-200 bg-white" />
      </div>
    );
  }

  if (error && !creator) {
    return (
      <div className="p-6">
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
          {error}
        </div>
      </div>
    );
  }

  const badge = STATUS_BADGE[status];

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
        <div className="flex items-center gap-3">
          <Link
            href="/forms"
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            &larr; Forms
          </Link>
          <span className="text-gray-300">/</span>
          <input
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              nameRef.current = e.target.value;
            }}
            className="border-0 bg-transparent text-lg font-semibold text-gray-800 outline-none focus:ring-0"
            placeholder="Form name"
          />
          <Badge variant={badge.variant}>{badge.label}</Badge>
        </div>
        <div className="flex items-center gap-2">
          {error && (
            <span className="text-xs text-red-500">{error}</span>
          )}
          <Button
            onClick={() => setPreviewing(true)}
            variant="ghost"
            size="sm"
          >
            <svg
              className="mr-1 h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
              />
            </svg>
            Preview
          </Button>
          <Button
            onClick={handleSave}
            disabled={saving}
            variant="secondary"
          >
            {saving ? "Saving..." : "Save"}
          </Button>
          {status === "draft" && (
            <Button onClick={handlePublish} disabled={saving}>
              Publish
            </Button>
          )}
        </div>
      </div>

      {/* Creator */}
      <div className="flex-1 overflow-hidden">
        {creator && <SurveyCreatorComponent creator={creator} />}
      </div>

      {/* Preview overlay */}
      {previewing && creator && (
        <div className="fixed inset-0 z-50 flex flex-col bg-gray-50">
          {/* Preview header */}
          <div className="flex items-center justify-between border-b border-gray-200 bg-white px-6 py-3">
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium text-gray-800">
                Preview
              </span>
              <span className="text-xs text-gray-400">
                This is how patients will see your form
              </span>
            </div>
            <Button
              onClick={() => setPreviewing(false)}
              variant="secondary"
              size="sm"
            >
              Close preview
            </Button>
          </div>

          {/* Preview body — renders our custom patient form */}
          <div className="flex-1 overflow-y-auto px-4 py-6">
            <FormFillClient
              token="__preview__"
              formName={nameRef.current}
              schema={creator.JSON}
              patientFirstName="Preview"
              org={
                org
                  ? { name: org.name, logo_url: org.logo_url }
                  : { name: "Your Clinic", logo_url: null }
              }
            />
          </div>
        </div>
      )}
    </div>
  );
}
