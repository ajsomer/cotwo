import "server-only";
import crypto from "crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  telephonyTestConfig,
  locations,
  staffAssignments,
  users,
} from "@/lib/db/schema";
import { encryptCredentials, decryptCredentials } from "@/lib/pms/credentials";

/**
 * Service layer for the Twilio call-pop TEST config. Owns every read/write of
 * `telephony_test_config`, plus credential encryption and webhook-URL/token
 * derivation. Routes and the settings UI go through here — they never touch the
 * table or the auth-token plaintext directly.
 */

/** Shape returned to the settings UI. Never includes the auth token. */
export interface TelephonyConfigDTO {
  configured: boolean;
  twilioAccountSid: string | null;
  twilioPhoneNumber: string | null;
  demoUserId: string | null;
  webhookUrl: string | null;
  statusCallbackUrl: string | null;
  lastEventAt: string | null;
}

export interface ConnectTelephonyInput {
  locationId: string;
  twilioAccountSid: string;
  authToken: string;
  twilioPhoneNumber: string;
  demoUserId: string;
}

/** Public base URL of the deployed app (Railway). Twilio must reach it. */
function appBaseUrl(): string {
  const base =
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.APP_URL ??
    "http://localhost:3000";
  return base.replace(/\/$/, "");
}

/** The exact public URLs Twilio calls — stored verbatim for signature checks. */
export function webhookUrlFor(pathToken: string): string {
  return `${appBaseUrl()}/api/telephony/twilio/events/${pathToken}`;
}
export function statusCallbackUrlFor(pathToken: string): string {
  return `${webhookUrlFor(pathToken)}/status`;
}

function toDTO(
  row: typeof telephonyTestConfig.$inferSelect | undefined
): TelephonyConfigDTO {
  if (!row || row.status !== "configured") {
    return {
      configured: false,
      twilioAccountSid: null,
      twilioPhoneNumber: null,
      demoUserId: null,
      webhookUrl: null,
      statusCallbackUrl: null,
      lastEventAt: null,
    };
  }
  return {
    configured: true,
    twilioAccountSid: row.twilioAccountSid,
    twilioPhoneNumber: row.twilioPhoneNumber,
    demoUserId: row.demoUserId,
    webhookUrl: row.webhookUrl ?? webhookUrlFor(row.pathToken),
    statusCallbackUrl: statusCallbackUrlFor(row.pathToken),
    lastEventAt: row.lastEventAt,
  };
}

export async function getTelephonyConfig(
  locationId: string
): Promise<TelephonyConfigDTO> {
  const [row] = await db
    .select()
    .from(telephonyTestConfig)
    .where(eq(telephonyTestConfig.locationId, locationId));
  return toDTO(row);
}

/**
 * Connect (or re-credential) the location's Twilio test config. Resolves org
 * from the location, generates a stable path token on first connect (reused on
 * re-credential so the webhook URL doesn't change), encrypts the auth token,
 * and upserts. Returns the DTO + the URLs to paste into Twilio.
 */
export async function connectTelephony(
  input: ConnectTelephonyInput
): Promise<TelephonyConfigDTO> {
  const [loc] = await db
    .select({ orgId: locations.orgId })
    .from(locations)
    .where(eq(locations.id, input.locationId));
  if (!loc) throw new Error("Location not found");

  const [existing] = await db
    .select()
    .from(telephonyTestConfig)
    .where(eq(telephonyTestConfig.locationId, input.locationId));

  const pathToken = existing?.pathToken ?? crypto.randomBytes(24).toString("hex");
  const authTokenEncrypted = encryptCredentials({ authToken: input.authToken });
  const now = new Date().toISOString();

  const values = {
    orgId: loc.orgId,
    provider: "twilio",
    twilioAccountSid: input.twilioAccountSid,
    twilioPhoneNumber: input.twilioPhoneNumber,
    pathToken,
    webhookUrl: webhookUrlFor(pathToken),
    authTokenEncrypted,
    demoUserId: input.demoUserId,
    status: "configured",
    updatedAt: now,
  };

  if (existing) {
    await db
      .update(telephonyTestConfig)
      .set(values)
      .where(eq(telephonyTestConfig.id, existing.id));
  } else {
    await db
      .insert(telephonyTestConfig)
      .values({ locationId: input.locationId, ...values });
  }

  return getTelephonyConfig(input.locationId);
}

/** Turn the test trigger off and forget the credentials. */
export async function disconnectTelephony(locationId: string): Promise<void> {
  await db
    .update(telephonyTestConfig)
    .set({
      status: "off",
      authTokenEncrypted: null,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(telephonyTestConfig.locationId, locationId));
}

/**
 * Resolve a config by its path token (the PRIMARY webhook locator), returning
 * the fields the webhook route needs: org/location for matching/broadcast, the
 * decrypted auth token for signature validation, the demo target user, and the
 * stored exact webhook/status URLs. Null if unknown or turned off.
 */
export interface ResolvedWebhookConfig {
  locationId: string;
  orgId: string;
  demoUserId: string | null;
  twilioAccountSid: string | null;
  authToken: string;
  webhookUrl: string;
  statusCallbackUrl: string;
}

export async function resolveByPathToken(
  pathToken: string
): Promise<ResolvedWebhookConfig | null> {
  const [row] = await db
    .select()
    .from(telephonyTestConfig)
    .where(eq(telephonyTestConfig.pathToken, pathToken));
  if (!row || row.status !== "configured" || !row.authTokenEncrypted) {
    return null;
  }
  let authToken: string;
  try {
    authToken = decryptCredentials(row.authTokenEncrypted).authToken ?? "";
  } catch {
    return null;
  }
  if (!authToken) return null;

  return {
    locationId: row.locationId,
    orgId: row.orgId,
    demoUserId: row.demoUserId,
    twilioAccountSid: row.twilioAccountSid,
    authToken,
    webhookUrl: row.webhookUrl ?? webhookUrlFor(row.pathToken),
    statusCallbackUrl: statusCallbackUrlFor(row.pathToken),
  };
}

/** Staff at a location, for the demo-target-user picker in settings. */
export interface TelephonyStaffOption {
  userId: string;
  fullName: string;
}

export async function listLocationStaff(
  locationId: string
): Promise<TelephonyStaffOption[]> {
  const rows = await db
    .select({ userId: users.id, fullName: users.fullName })
    .from(staffAssignments)
    .innerJoin(users, eq(users.id, staffAssignments.userId))
    .where(eq(staffAssignments.locationId, locationId));
  return rows.map((r) => ({ userId: r.userId, fullName: r.fullName }));
}

/** Liveness ping — last time a webhook landed for this config. */
export async function touchLastEvent(locationId: string): Promise<void> {
  await db
    .update(telephonyTestConfig)
    .set({ lastEventAt: new Date().toISOString() })
    .where(eq(telephonyTestConfig.locationId, locationId));
}
