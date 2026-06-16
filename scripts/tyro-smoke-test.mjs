#!/usr/bin/env node
/**
 * Tyro Health Checkout — staging smoke test (throwaway).
 *
 * Validates: credentials, base URL, geo-IP, and the simple-charge request shape.
 * Creates ONE unpaid invoice in the staging account and prints the returned
 * paymentRequestUrl. Charges nothing — payment only happens if a human opens
 * that URL and enters a test card.
 *
 * Run: node scripts/tyro-smoke-test.mjs [providerNumber]
 *   - Optionally pass a valid provider number for your test business as argv[2];
 *     otherwise falls back to the docs' example (likely invalid under your key,
 *     which still proves creds/host/geo-IP work).
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Minimal .env.local loader (avoids adding a dependency).
function loadEnv() {
  const env = {};
  try {
    const raw = readFileSync(join(__dirname, "..", ".env.local"), "utf8");
    for (const line of raw.split("\n")) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    /* ignore */
  }
  return env;
}

const env = loadEnv();
const API_KEY = env.TYRO_API_KEY;
// Tolerate the current typo'd var name (TYPO_APP_ID) and the correct one.
const APP_ID = env.TYRO_APP_ID || env.TYPO_APP_ID;

if (!API_KEY || !APP_ID) {
  console.error("Missing TYRO_API_KEY or TYRO_APP_ID/TYPO_APP_ID in .env.local");
  process.exit(1);
}

const BASE_URL = "https://stg-api-au.medipass.io/v3";
const APP_VER = "coviu-proto/0.1";

// Docs example provider number (belongs to Tyro's test business — may be
// invalid under your key). Override via argv.
const providerNumber = process.argv[2] || "7392152T";

// Simple-charge invoice: one non-claimable $1.00 line, payment link requested.
// refId is unique per run so we don't collide patient records on re-run.
//
// IMPORTANT: use the FLAT shape (top-level providerNumber + flat patient object).
// The nested form (provider:{providerNumber}, patient.identity:{}) is for the
// PHI/HICAPS claim variant and returns 400 errorCode 13001 "could not determine
// location". providerNumber carries the location identifier (e.g. T01LHM0B).
const refId = `coviu-smoke-${Date.now()}`;
const body = {
  invoiceReference: `SMOKE-${Date.now()}`,
  patient: {
    refId,
    firstName: "Smoke",
    lastName: "Test",
    mobile: "0411111111",
    dobString: "1990-01-01",
  },
  providerNumber,
  processingRequest: { paymentLink: true },
  nonClaimableItems: [
    {
      serviceDateString: "2026-06-16",
      reference: "01",
      displayName: "Telehealth consultation (smoke test)",
      chargeAmount: "1.00",
      isTaxable: false,
    },
  ],
};

console.log(`POST ${BASE_URL}/transactions/invoices`);
console.log(`x-appid: ${APP_ID.slice(0, 4)}…  (len ${APP_ID.length})`);
console.log(`provider.providerNumber: ${providerNumber}`);
console.log("body:", JSON.stringify(body, null, 2));
console.log("—".repeat(50));

const res = await fetch(`${BASE_URL}/transactions/invoices`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${API_KEY}`,
    "x-appid": APP_ID,
    "x-appver": APP_VER,
    "Content-Type": "application/json",
  },
  body: JSON.stringify(body),
});

const text = await res.text();
let json;
try {
  json = JSON.parse(text);
} catch {
  /* non-JSON */
}

console.log(`HTTP ${res.status} ${res.statusText}`);
console.log("response headers:", JSON.stringify(Object.fromEntries(res.headers), null, 2));
console.log("RAW BODY:", text);
if (json) {
  // Print the fields that matter for the smoke test, not the whole payload.
  const summary = {
    status: json.status,
    transactionId: json.transactionId,
    paymentRequestUrl: json.paymentRequestUrl,
    amountChargedString: json.amountChargedString,
    error: json.error || json.message || json.errors,
  };
  console.log(JSON.stringify(summary, null, 2));
  if (json.paymentRequestUrl) {
    console.log("\n✅ paymentRequestUrl returned — open it to complete a test payment.");
  }
} else {
  console.log(text.slice(0, 2000));
}
