import { createServiceClient } from '@/lib/supabase/service';
import { FormFillClient } from '@/components/patient/form-fill-client';

export default async function FormFillPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const supabase = createServiceClient();

  // Resolve assignment by token
  const { data: assignment } = await supabase
    .from('form_assignments')
    .select('id, form_id, patient_id, schema_snapshot, status')
    .eq('token', token)
    .single();

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
  const { data: form } = await supabase
    .from('forms')
    .select('name, org_id')
    .eq('id', assignment.form_id)
    .single();

  // Get patient name
  const { data: patient } = await supabase
    .from('patients')
    .select('first_name')
    .eq('id', assignment.patient_id)
    .single();

  // Get org branding
  let org: { name: string; logo_url: string | null } | null = null;
  if (form?.org_id) {
    const { data: orgData } = await supabase
      .from('organisations')
      .select('name, logo_url')
      .eq('id', form.org_id)
      .single();
    org = orgData;
  }

  // Mark as opened (forward-only)
  if (assignment.status === 'pending' || assignment.status === 'sent') {
    await supabase
      .from('form_assignments')
      .update({ status: 'opened', opened_at: new Date().toISOString() })
      .eq('id', assignment.id);
  }

  return (
    <FormFillClient
      token={token}
      formName={form?.name ?? 'Form'}
      schema={assignment.schema_snapshot}
      patientFirstName={patient?.first_name ?? null}
      org={org}
    />
  );
}
