import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { getOutstandingJourneysForPatient } from '@/lib/intake/outstanding';
import { resolveEntryTokenScope } from '@/lib/patient/entry-token';
import { assertPatientInOrg } from '@/lib/auth/staff-access';

/**
 * POST /api/patient/outstanding-intake
 * Body: { token, patientId }
 * Returns: OutstandingCheck
 *
 * Patient-facing. Called from the arrival flow after identity confirmation.
 * The org is derived from the entry token (not caller-supplied), and the
 * patient must belong to that org — otherwise this would leak journey tokens
 * for an arbitrary patient in an arbitrary org.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { token, patientId } = body as { token?: string; patientId?: string };

    if (!token || !patientId) {
      return NextResponse.json(
        { error: 'token and patientId required' },
        { status: 400 }
      );
    }

    const service = createServiceClient();
    const scope = await resolveEntryTokenScope(service, token);
    if (!scope) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 404 });
    }

    if (!(await assertPatientInOrg(service, patientId, scope.orgId))) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const result = await getOutstandingJourneysForPatient(patientId, scope.orgId);
    return NextResponse.json(result);
  } catch (err) {
    console.error('[outstanding-intake] Error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
