import { NextRequest, NextResponse } from 'next/server';
import { getOutstandingJourneysForPatient } from '@/lib/intake/outstanding';

/**
 * POST /api/patient/outstanding-intake
 * Body: { patientId, orgId }
 * Returns: OutstandingCheck
 *
 * Patient-facing. Called from the arrival flow after identity confirmation
 * to decide whether the patient should be routed through the intake UI
 * before reaching the waiting room.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { patientId, orgId } = body as { patientId?: string; orgId?: string };

    if (!patientId || !orgId) {
      return NextResponse.json(
        { error: 'patientId and orgId required' },
        { status: 400 }
      );
    }

    const result = await getOutstandingJourneysForPatient(patientId, orgId);
    return NextResponse.json(result);
  } catch (err) {
    console.error('[outstanding-intake] Error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
