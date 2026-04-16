import { cache } from "react";
import { createServiceClient } from "@/lib/supabase/service";
import type { FormRow, FileRow } from "@/stores/clinic-store";

export const fetchForms = cache(async (orgId: string): Promise<FormRow[]> => {
  const supabase = createServiceClient();

  const { data: forms, error } = await supabase
    .from("forms")
    .select("id, name, description, status, schema, created_at, updated_at")
    .eq("org_id", orgId)
    .order("updated_at", { ascending: false });

  if (error) {
    console.error("fetchForms error:", error);
    return [];
  }

  const formIds = (forms ?? []).map((f) => f.id);
  let assignmentCounts: Record<string, { total: number; completed: number }> = {};

  if (formIds.length > 0) {
    const { data: assignments } = await supabase
      .from("form_assignments")
      .select("form_id, status")
      .in("form_id", formIds);

    if (assignments) {
      assignmentCounts = assignments.reduce(
        (acc, a) => {
          if (!acc[a.form_id]) acc[a.form_id] = { total: 0, completed: 0 };
          acc[a.form_id].total++;
          if (a.status === "completed") acc[a.form_id].completed++;
          return acc;
        },
        {} as Record<string, { total: number; completed: number }>
      );
    }
  }

  return (forms ?? []).map((f) => ({
    ...f,
    assignment_counts: assignmentCounts[f.id] ?? { total: 0, completed: 0 },
  })) as FormRow[];
});

export const fetchFiles = cache(async (orgId: string): Promise<FileRow[]> => {
  const supabase = createServiceClient();

  const { data: files, error } = await supabase
    .from("files")
    .select("id, name, description, storage_path, file_size_bytes, mime_type, uploaded_by, created_at")
    .eq("org_id", orgId)
    .is("archived_at", null)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("fetchFiles error:", error);
    return [];
  }

  return (files ?? []) as FileRow[];
});
