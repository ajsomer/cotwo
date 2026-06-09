import "server-only";
import crypto from "crypto";
import type { PmsCredentials } from "./adapter";

/**
 * Opaque credential encryption for PMS connections.
 *
 * The generic layer stores credentials as an encrypted blob on
 * `pms_connections.credentials_encrypted` and never inspects the plaintext —
 * only the adapter does (§4). AES-256-GCM with a random IV per blob.
 *
 * Key source: `PMS_ENCRYPTION_KEY` (32-byte value, hex or base64). In dev,
 * if unset, we derive a stable key from another server secret so the prototype
 * runs without extra setup — that fallback is NOT used when the env var is set.
 */

const MAGIC = "pmsv1"; // version tag so we can rotate the scheme later

function loadKey(): Buffer {
  const raw = process.env.PMS_ENCRYPTION_KEY;
  if (raw) {
    // Accept hex (64 chars) or base64; normalise to 32 bytes.
    const buf =
      raw.length === 64 && /^[0-9a-fA-F]+$/.test(raw)
        ? Buffer.from(raw, "hex")
        : Buffer.from(raw, "base64");
    if (buf.length === 32) return buf;
    // Otherwise hash it down to 32 bytes deterministically.
    return crypto.createHash("sha256").update(raw).digest();
  }
  // Dev fallback: derive from an existing server secret. Prototype only.
  const seed =
    process.env.CRON_SECRET ||
    process.env.NEON_AUTH_COOKIE_SECRET ||
    process.env.DATABASE_URL ||
    "coviu-pms-dev-fallback";
  return crypto.createHash("sha256").update(`pms:${seed}`).digest();
}

/** Encrypt a credentials object to a self-describing string blob. */
export function encryptCredentials(creds: PmsCredentials): string {
  const key = loadKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const plaintext = Buffer.from(JSON.stringify(creds), "utf8");
  const enc = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    MAGIC,
    iv.toString("base64"),
    tag.toString("base64"),
    enc.toString("base64"),
  ].join(".");
}

/** Decrypt a blob produced by encryptCredentials. Throws on tamper/version. */
export function decryptCredentials(blob: string): PmsCredentials {
  const parts = blob.split(".");
  if (parts.length !== 4 || parts[0] !== MAGIC) {
    throw new Error("Unrecognised PMS credentials blob");
  }
  const [, ivB64, tagB64, encB64] = parts;
  const key = loadKey();
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(ivB64, "base64")
  );
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  const dec = Buffer.concat([
    decipher.update(Buffer.from(encB64, "base64")),
    decipher.final(),
  ]);
  return JSON.parse(dec.toString("utf8")) as PmsCredentials;
}
