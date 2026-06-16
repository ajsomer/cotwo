import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { payments as paymentsT, sessions as sessionsT } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { broadcastSessionChange } from "@/lib/realtime/broadcast";

/**
 * Tyro Health Checkout webhook receiver.
 *
 * Tyro calls the per-invoice webhook URLs we register on the charge (see
 * src/lib/payments/tyro.ts) with events `invoiceCompleted` / `invoiceCancelled`.
 * We match the payment row by transactionId (stored as payments.provider_txn_id)
 * and flip its status, then broadcast so the run sheet refetches.
 *
 * The event is encoded in the query string (?event=...&transactionId=...) — Tyro
 * registers GET webhooks in the sample — but we accept POST bodies too for
 * robustness. No signature scheme is documented for Checkout webhooks; treat the
 * transactionId match as the guard and re-verify against Tyro if spoofing is a
 * concern in production.
 */
async function handle(event: string | null, transactionId: string | null) {
  if (!transactionId) {
    return NextResponse.json({ error: "missing transactionId" }, { status: 400 });
  }

  const status =
    event === "invoiceCompleted"
      ? ("completed" as const)
      : event === "invoiceCancelled"
        ? ("failed" as const)
        : null;

  if (!status) {
    // Unknown event — acknowledge so Tyro doesn't retry, but do nothing.
    return NextResponse.json({ received: true, ignored: event });
  }

  const [updated] = await db
    .update(paymentsT)
    .set({ status })
    .where(eq(paymentsT.providerTxnId, transactionId))
    .returning({ session_id: paymentsT.sessionId });

  if (updated?.session_id) {
    const [session] = await db
      .select({ location_id: sessionsT.locationId })
      .from(sessionsT)
      .where(eq(sessionsT.id, updated.session_id));
    if (session?.location_id) {
      await broadcastSessionChange(session.location_id, "session_updated", {
        session_id: updated.session_id,
      });
    }
  }

  return NextResponse.json({ received: true });
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  return handle(searchParams.get("event"), searchParams.get("transactionId"));
}

export async function POST(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  let body: Record<string, unknown> = {};
  try {
    body = await request.json();
  } catch {
    /* event may be in query only */
  }
  const event =
    searchParams.get("event") ?? (body.event as string | undefined) ?? null;
  const transactionId =
    searchParams.get("transactionId") ??
    (body.transactionId as string | undefined) ??
    null;
  return handle(event, transactionId);
}
