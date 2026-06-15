import "server-only";
import crypto from "crypto";

/**
 * Twilio-specific glue for the call-pop test trigger. Kept isolated from the
 * config service and patient match so the provider details live in one place.
 *
 * We deliberately do NOT pull in the `twilio` SDK for one function — request
 * validation is a small, well-documented HMAC, reproduced here.
 */

/** The inbound voice-webhook params we care about. */
export interface TwilioVoiceParams {
  callSid: string;
  from: string;
  to: string;
  callStatus: string;
  direction: string;
}

/**
 * Validate the `X-Twilio-Signature` header.
 *
 * Twilio signs: the EXACT request URL, plus (for form-encoded POSTs) every POST
 * param appended as `key+value` in alphabetical key order, HMAC-SHA1'd with the
 * account Auth Token, base64-encoded. For GET, the params are already in the URL
 * and the body contribution is empty.
 *
 * Critical: `url` must be the exact public URL Twilio called — pass the stored
 * `webhook_url`, never one reconstructed from the incoming request (host/proto
 * can differ behind Railway's proxy and the signature won't match).
 *
 * Pass `params` = the parsed form body for POST, or `{}` for GET.
 */
export function validateTwilioSignature(
  authToken: string,
  signatureHeader: string | null,
  url: string,
  params: Record<string, string>
): boolean {
  if (!signatureHeader) return false;

  const data =
    url +
    Object.keys(params)
      .sort()
      .reduce((acc, key) => acc + key + params[key], "");

  const expected = crypto
    .createHmac("sha1", authToken)
    .update(Buffer.from(data, "utf-8"))
    .digest("base64");

  // Constant-time compare; guard against length mismatch (timingSafeEqual throws).
  const a = Buffer.from(expected);
  const b = Buffer.from(signatureHeader);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Read the params we use out of a Twilio request's form/query map. */
export function readVoiceParams(
  values: Record<string, string>
): TwilioVoiceParams {
  return {
    callSid: values.CallSid ?? "",
    from: values.From ?? "",
    to: values.To ?? "",
    callStatus: values.CallStatus ?? "",
    direction: values.Direction ?? "",
  };
}

/**
 * TwiML that KEEPS THE CALL ALIVE so the popped card stays up until the caller
 * hangs up. `<Hangup/>` (or letting the TwiML simply end) would terminate the
 * call immediately and fire the completed callback, closing the card the instant
 * it opened. A long `<Pause>` holds the line; the card closes from the separate
 * status callback when the caller actually hangs up.
 */
export function keepAliveTwiml(message = "Coviu test received."): string {
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<Response><Say>${escapeXml(message)}</Say><Pause length="120"/></Response>`
  );
}

/** Minimal empty TwiML (used when we just need a valid 200 voice response). */
export function emptyTwiml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?><Response/>`;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
