import { db } from '@/lib/db';
import {
  formAssignments,
  forms as formsT,
  patients as patientsT,
  organisations as organisationsT,
} from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { FormFillClient } from '@/components/patient/form-fill-client';

export default async function FormFillPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  // Resolve assignment by token
  const [assignment] = await db
    .select({
      id: formAssignments.id,
      form_id: formAssignments.formId,
      patient_id: formAssignments.patientId,
      schema_snapshot: formAssignments.schemaSnapshot,
      status: formAssignments.status,
    })
    .from(formAssignments)
    .where(eq(formAssignments.token, token))
    .limit(1);

  if (!assignment) {
    return (
      <div className="flex flex-col items-center py-12 text-center">
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-50">
          <span className="text-lg text-red-500">!</span>
        </div>
        <h1 className="text-xl font-semibold text-gray-800">Form not found</h1>
        <p className="mt-2 text-sm text-gray-500">
          This link has expired or is no longer valid. Please contact your clinic
          for a new link.
        </p>
      </div>
    );
  }

  if (assignment.status === 'completed') {
    return (
      <div className="flex flex-col items-center py-12 text-center">
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-teal-50">
          <svg className="h-6 w-6 text-teal-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
          </svg>
        </div>
        <h1 className="text-xl font-semibold text-gray-800">Already submitted</h1>
        <p className="mt-2 text-sm text-gray-500">
          This form has already been completed. No further action is needed.
        </p>
      </div>
    );
  }

  // Get form name
  const [form] = await db
    .select({ name: formsT.name, org_id: formsT.orgId })
    .from(formsT)
    .where(eq(formsT.id, assignment.form_id))
    .limit(1);

  // Get patient name
  const [patient] = await db
    .select({ first_name: patientsT.firstName })
    .from(patientsT)
    .where(eq(patientsT.id, assignment.patient_id))
    .limit(1);

  // Get org branding
  let org: { name: string; logo_url: string | null } | null = null;
  if (form?.org_id) {
    const [orgData] = await db
      .select({ name: organisationsT.name, logo_url: organisationsT.logoUrl })
      .from(organisationsT)
      .where(eq(organisationsT.id, form.org_id))
      .limit(1);
    org = orgData ?? null;
  }

  // Mark as opened (forward-only)
  if (assignment.status === 'pending' || assignment.status === 'sent') {
    await db
      .update(formAssignments)
      .set({ status: 'opened', openedAt: new Date().toISOString() })
      .where(eq(formAssignments.id, assignment.id));
  }

  return (
    <FormFillClient
      token={token}
      formName={form?.name ?? 'Form'}
      schema={assignment.schema_snapshot as Record<string, unknown>}
      patientFirstName={patient?.first_name ?? null}
      org={org}
    />
  );
}
