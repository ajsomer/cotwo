import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { forms as formsT, organisations } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

/**
 * GET /api/forms/standalone/[public_token]
 *
 * Patient-facing endpoint. Resolves a form by its public token and gates on
 * publish status — every standalone form gets a locked identity page injected
 * by the patient runtime, so eligibility = `status = 'published'`.
 *
 * Response shapes:
 *   200 — `{ form: {...}, org: {...} }` when published.
 *   404 — `{ available: false, reason: 'draft'|'archived'|'unavailable', org: {...} }`
 *         when the form exists but isn't shareable. Branding included so the
 *         patient page can render an informative "not available" screen. The
 *         `unavailable` reason is currently unused but reserved for future
 *         broken-state cases the page should treat as neutrally hidden.
 *   404 — empty body when the token doesn't match a form.
 *
 * The two 404 shapes are distinguishable by an observer who already has a
 * candidate token, which is an accepted trade-off (see spec). Token entropy
 * is 122 bits so enumeration is infeasible.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ public_token: string }> },
) {
  const { public_token } = await params;

  if (!public_token) {
    return NextResponse.json({}, { status: 404 });
  }

  const [form] = await db
    .select({
      id: formsT.id,
      name: formsT.name,
      description: formsT.description,
      schema: formsT.schema,
      status: formsT.status,
      org_id: formsT.orgId,
    })
    .from(formsT)
    .where(eq(formsT.publicToken, public_token));

  if (!form) {
    return NextResponse.json({}, { status: 404 });
  }

  const [org] = await db
    .select({ name: organisations.name, logo_url: organisations.logoUrl })
    .from(organisations)
    .where(eq(organisations.id, form.org_id));

  const orgPayload = org
    ? { name: org.name as string, logo_url: org.logo_url as string | null }
    : null;

  if (form.status === "draft") {
    return NextResponse.json(
      { available: false, reason: "draft", org: orgPayload },
      { status: 404 },
    );
  }

  if (form.status === "archived") {
    return NextResponse.json(
      { available: false, reason: "archived", org: orgPayload },
      { status: 404 },
    );
  }

  if (form.status !== "published") {
    // Reserved neutral reason for any future status that should be treated as
    // hidden. Not currently triggered by `forms.status`'s CHECK constraint.
    console.warn(
      `[standalone-forms] Form ${form.id} returned unavailable: unknown status=${form.status}`,
    );
    return NextResponse.json(
      { available: false, reason: "unavailable", org: orgPayload },
      { status: 404 },
    );
  }

  return NextResponse.json({
    form: {
      id: form.id,
      name: form.name,
      description: form.description,
      schema: form.schema,
      org_id: form.org_id,
    },
    org: orgPayload,
  });
}
