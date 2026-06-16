import "server-only";
import crypto from "crypto";

/**
 * AES-256-GCM encryption for payment provider secrets (e.g. a clinic's Tyro
 * API key). Mirrors the PMS credential scheme (src/lib/pms/credentials.ts) —
 * same key source and format so ops only manage one encryption key.
 *
 * Key source: PMS_ENCRYPTION_KEY (32-byte hex/base64). Dev fallback derives a
 * stable key from another server secret so the prototype runs without setup.
 */

const MAGIC = "payv1";

function loadKey(): Buffer {
  const raw = process.env.PMS_ENCRYPTION_KEY;
  if (raw) {
    const buf =
      raw.length === 64 && /^[0-9a-fA-F]+$/.test(raw)
        ? Buffer.from(raw, "hex")
        : Buffer.from(raw, "base64");
    if (buf.length === 32) return buf;
    return crypto.createHash("sha256").update(raw).digest();
  }
  const seed =
    process.env.CRON_SECRET ||
    process.env.NEON_AUTH_COOKIE_SECRET ||
    process.env.DATABASE_URL ||
    "coviu-pay-dev-fallback";
  return crypto.createHash("sha256").update(`pay:${seed}`).digest();
}

/** Encrypt a secret string to a self-describing blob. */
export function encryptSecret(plain: string): string {
  const key = loadKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(Buffer.from(plain, "utf8")), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [MAGIC, iv.toString("base64"), tag.toString("base64"), enc.toString("base64")].join(".");
}

/** Decrypt a blob from encryptSecret. Throws on tamper/version mismatch. */
export function decryptSecret(blob: string): string {
  const parts = blob.split(".");
  if (parts.length !== 4 || parts[0] !== MAGIC) {
    throw new Error("Unrecognised payment credentials blob");
  }
  const key = loadKey();
  const iv = Buffer.from(parts[1], "base64");
  const tag = Buffer.from(parts[2], "base64");
  const enc = Buffer.from(parts[3], "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
  return dec.toString("utf8");
}
