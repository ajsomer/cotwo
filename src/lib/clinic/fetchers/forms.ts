import { cache } from "react";
import { db } from "@/lib/db";
import {
  forms as formsT,
  formAssignments,
  files as filesT,
} from "@/lib/db/schema";
import { and, eq, inArray, isNull, desc } from "drizzle-orm";
import type { FormRow, FileRow } from "@/stores/clinic-store";

export const fetchForms = cache(async (orgId: string): Promise<FormRow[]> => {
  const forms = await db
    .select({
      id: formsT.id,
      name: formsT.name,
      description: formsT.description,
      status: formsT.status,
      schema: formsT.schema,
      public_token: formsT.publicToken,
      created_at: formsT.createdAt,
      updated_at: formsT.updatedAt,
    })
    .from(formsT)
    .where(and(eq(formsT.orgId, orgId), eq(formsT.isPlatformDemo, false)))
    .orderBy(desc(formsT.updatedAt));

  const formIds = forms.map((f) => f.id);
  let assignmentCounts: Record<string, { total: number; completed: number }> = {};

  if (formIds.length > 0) {
    const assignments = await db
      .select({ form_id: formAssignments.formId, status: formAssignments.status })
      .from(formAssignments)
      .where(inArray(formAssignments.formId, formIds));

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

  return forms.map((f) => ({
    ...f,
    assignment_counts: assignmentCounts[f.id] ?? { total: 0, completed: 0 },
  })) as FormRow[];
});

export const fetchFiles = cache(async (orgId: string): Promise<FileRow[]> => {
  const files = await db
    .select({
      id: filesT.id,
      name: filesT.name,
      description: filesT.description,
      storage_path: filesT.storagePath,
      file_size_bytes: filesT.fileSizeBytes,
      mime_type: filesT.mimeType,
      uploaded_by: filesT.uploadedBy,
      created_at: filesT.createdAt,
    })
    .from(filesT)
    .where(and(eq(filesT.orgId, orgId), isNull(filesT.archivedAt)))
    .orderBy(desc(filesT.createdAt));

  return files as FileRow[];
});
