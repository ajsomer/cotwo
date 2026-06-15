import { NextRequest, NextResponse } from "next/server";
import {
  resolveByPathToken,
  touchLastEvent,
} from "@/lib/telephony/config-service";
import {
  validateTwilioSignature,
  readVoiceParams,
  keepAliveTwiml,
} from "@/lib/telephony/twilio";
import { matchCaller } from "@/lib/telephony/patient-match";
import { broadcastIncomingCall } from "@/lib/realtime/broadcast";

/**
 * Twilio inbound VOICE webhook for the call-pop test trigger.
 *   parse → resolve config (by path token) → verify signature → match → broadcast → TwiML
 *
 * The `<token>` path segment is the primary config locator (a Twilio account may
 * back several demo locations, so AccountSid alone is insufficient). Twilio may
 * call this as GET or POST per the number's config — accept both.
 *
 * Returns TwiML that keeps the call alive (a long <Pause>) so the popped card
 * stays up until the caller hangs up; the card is closed by the SEPARATE status
 * callback (./status), never from here.
 *
 * PII discipline: log only non-identifying metadata (token tail, match kind) —
 * never the caller number or patient ids.
 */

const twimlResponse = (xml: string) =>
  new NextResponse(xml, {
    status: 200,
    headers: { "Content-Type": "text/xml" },
  });

async function handle(
  request: NextRequest,
  token: string
): Promise<NextResponse> {
  const config = await resolveByPathToken(token);
  if (!config) {
    // Unknown / disabled token — say nothing useful, return a bare 404.
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Collect params from form body (POST) or query string (GET) for both
  // signature validation (needs ALL params) and our own reads.
  const values: Record<string, string> = {};
  if (request.method === "POST") {
    const form = await request.formData();
    for (const [k, v] of form.entries()) values[k] = String(v);
  } else {
    request.nextUrl.searchParams.forEach((v, k) => {
      values[k] = v;
    });
  }

  // Validate against the STORED exact webhook URL — not a proxy-reconstructed
  // one. For GET the signed params live in the URL, so the body map is empty.
  const signature = request.headers.get("x-twilio-signature");
  const sigParams = request.method === "POST" ? values : {};
  if (!validateTwilioSignature(config.authToken, signature, config.webhookUrl, sigParams)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 403 });
  }

  const params = readVoiceParams(values);
  void touchLastEvent(config.locationId);

  const match = await matchCaller(config.orgId, params.from);
  await broadcastIncomingCall(config.locationId, {
    userId: config.demoUserId,
    callId: params.callSid,
    match,
  });

  console.warn(
    `[telephony] incoming_call token=…${token.slice(-6)} match=${match.kind}`
  );

  return twimlResponse(keepAliveTwiml());
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  return handle(request, token);
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  return handle(request, token);
}
