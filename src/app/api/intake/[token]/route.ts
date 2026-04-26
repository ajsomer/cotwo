import { NextRequest, NextResponse } from 'next/server';
import { resolveJourney } from '@/lib/intake/resolve-journey';

/**
 * GET /api/intake/[token]
 * Returns the full IntakeJourneyContext (org, location, appointment, journey).
 * No auth required — token-based access.
 *
 * Existing callers that only read `data.journey` continue to work; the
 * additional top-level keys (`org`, `location`, `appointment`) are ignored
 * by them and consumed by the embedded-intake-journey wrapper.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const context = await resolveJourney(token);

  if (!context) {
    return NextResponse.json({ error: 'Journey not found' }, { status: 404 });
  }

  return NextResponse.json(context);
}
