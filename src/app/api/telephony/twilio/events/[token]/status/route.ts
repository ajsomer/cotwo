import { NextRequest, NextResponse } from "next/server";
import { resolveByPathToken } from "@/lib/telephony/config-service";
import { validateTwilioSignature, readVoiceParams } from "@/lib/telephony/twilio";
import { broadcastCallEnded } from "@/lib/realtime/broadcast";

/**
 * Twilio call STATUS callback for the call-pop test trigger. Fires when the call
 * completes; we close the popped card (matched by CallSid).
 *
 * This is an async status callback, NOT a voice instruction request — it returns
 * a fast empty 2xx, never TwiML. Validated against the stored status-callback URL.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const config = await resolveByPathToken(token);
  if (!config) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const values: Record<string, string> = {};
  const form = await request.formData();
  for (const [k, v] of form.entries()) values[k] = String(v);

  const signature = request.headers.get("x-twilio-signature");
  if (
    !validateTwilioSignature(
      config.authToken,
      signature,
      config.statusCallbackUrl,
      values
    )
  ) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 403 });
  }

  const { callSid, callStatus } = readVoiceParams(values);
  // Only act on terminal states; ignore in-progress status pings.
  if (callStatus === "completed" || callStatus === "busy" || callStatus === "no-answer" || callStatus === "failed" || callStatus === "canceled") {
    await broadcastCallEnded(config.locationId, { callId: callSid });
    console.warn(`[telephony] call_ended token=…${token.slice(-6)} status=${callStatus}`);
  }

  return new NextResponse(null, { status: 204 });
}
