import { NextResponse } from "next/server";

export async function POST() {
  // TODO: Verify Stripe webhook signature and handle events
  return NextResponse.json({ received: true });
}
