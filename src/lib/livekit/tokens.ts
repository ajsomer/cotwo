import { AccessToken } from "livekit-server-sdk";

export type LiveKitRole = "clinician" | "patient";

export interface GenerateAccessTokenParams {
  sessionId: string;
  identity: string;
  name: string;
  role: LiveKitRole;
}

export interface GeneratedAccessToken {
  token: string;
  url: string;
  roomName: string;
}

/**
 * Mint a short-lived LiveKit access token for a session.
 *
 * Room naming is deterministic: `session-{sessionId}`. One session, one room.
 * TTL is 1 hour — long enough for any realistic appointment, short enough
 * that a leaked token is low-blast-radius. No refresh: a reconnect after
 * expiry means fetching a fresh token.
 *
 * Clinicians get `canPublishData` for future control-channel use (chat,
 * clinical notes, etc). Patients do not.
 */
export async function generateAccessToken(
  params: GenerateAccessTokenParams
): Promise<GeneratedAccessToken> {
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  const url = process.env.NEXT_PUBLIC_LIVEKIT_URL;

  if (!apiKey || !apiSecret || !url) {
    throw new Error(
      "LiveKit environment is not configured. Expected LIVEKIT_API_KEY, LIVEKIT_API_SECRET, NEXT_PUBLIC_LIVEKIT_URL."
    );
  }

  const roomName = `session-${params.sessionId}`;

  const at = new AccessToken(apiKey, apiSecret, {
    identity: params.identity,
    name: params.name,
    ttl: "1h",
  });

  at.addGrant({
    roomJoin: true,
    room: roomName,
    canPublish: true,
    canSubscribe: true,
    canPublishData: params.role === "clinician",
  });

  const token = await at.toJwt();

  return { token, url, roomName };
}
