import type { PmsFieldCatalogueEntry } from "../adapter";
import type { GentuPatient, GentuPatientPatch } from "./types";

/**
 * STATIC Gentu field catalogue (plan §6). Patient-field targets ONLY.
 *
 * writeForms is FALSE (plan §6c): neither the Bookings nor Healthcare API has a
 * structured form/note write target — Healthcare "notes" are read-only
 * attachment categories. So the catalogue exposes NO `form_answer` entries; the
 * form body rides the attachment path (intake PDF) instead. Every target here
 * is written via the Bookings PATCH /patients/{id} endpoint.
 *
 * Gentu's write shape is NOT a flat param map (unlike Nookal). Names go into
 * the `extension` array, phone/email into a contact tuple, address into an
 * address-array element. So instead of key→paramName we expose:
 *  - applyToPatch(key, value, patch): mutate a GentuPatientPatch fragment
 *  - readCurrentValue(key, patient): pull the current value for the fill-blanks
 *    check (read shape differs from write shape — §4 / §6a of the API reference)
 *
 * Scope: the registration subset (name, DOB, contact, address). The typed
 * identifier union (Medicare/DVA/concession/health-fund) is DEFERRED — strict
 * per-type shapes, no canonical home yet, formats unverified (plan §2 item 8).
 *
 * ⚠️ Contact WRITE rules (verified from the Bookings spec, §6a): `system` is
 * email|phone ONLY (no fax), and only the tuples email/home, phone/mobile,
 * phone/work, phone/home are accepted. We only emit phone/mobile + email/home
 * here; never offer fax as a writable field.
 *
 * ⚠️ Name WRITES use the extension mode (firstname/middlename), never
 * name.given — the two are mutually exclusive per request and mixing them 400s.
 */

export const GENTU_PREFIX = "gentu:";

type GentuFieldKey =
  | "gentu:patient.first_name"
  | "gentu:patient.last_name"
  | "gentu:patient.date_of_birth"
  | "gentu:patient.email"
  | "gentu:patient.mobile"
  | "gentu:patient.address_line"
  | "gentu:patient.city"
  | "gentu:patient.state"
  | "gentu:patient.postcode";

export const GENTU_FIELD_CATALOGUE: PmsFieldCatalogueEntry[] = [
  { key: "gentu:patient.first_name", group: "Patient", label: "First name", valueType: "text", writeMode: "patient_field" },
  { key: "gentu:patient.last_name", group: "Patient", label: "Last name", valueType: "text", writeMode: "patient_field" },
  { key: "gentu:patient.date_of_birth", group: "Patient", label: "Date of birth", valueType: "date", writeMode: "patient_field" },
  { key: "gentu:patient.email", group: "Patient", label: "Email", valueType: "text", writeMode: "patient_field" },
  { key: "gentu:patient.mobile", group: "Patient", label: "Mobile", valueType: "phone", writeMode: "patient_field" },
  { key: "gentu:patient.address_line", group: "Patient", label: "Address", valueType: "text", writeMode: "patient_field" },
  { key: "gentu:patient.city", group: "Patient", label: "City / suburb", valueType: "text", writeMode: "patient_field" },
  { key: "gentu:patient.state", group: "Patient", label: "State", valueType: "text", writeMode: "patient_field" },
  { key: "gentu:patient.postcode", group: "Patient", label: "Postcode", valueType: "text", writeMode: "patient_field" },
];

/** The patient-field targets the seeded "Patient Registration" form uses. */
export const GENTU_REGISTRATION_FIELDS: string[] = GENTU_FIELD_CATALOGUE.map(
  (e) => e.key
);

export function catalogueEntry(key: string): PmsFieldCatalogueEntry | undefined {
  return GENTU_FIELD_CATALOGUE.find((e) => e.key === key);
}

const KNOWN_KEYS = new Set<string>(GENTU_FIELD_CATALOGUE.map((e) => e.key));
export function isKnownKey(key: string): key is GentuFieldKey {
  return KNOWN_KEYS.has(key);
}

/**
 * Mutate `patch` to set the field identified by `key` to `value`. Builds the
 * extension/contact/address sub-shapes the Bookings PATCH expects. Returns
 * false for an unknown key (caller reports a mapping failure).
 *
 * Note: each call writing into `contact`/`address` appends one element. The
 * orchestrator only ever fills BLANK fields, so we don't have to merge with
 * existing PMS values here — Gentu PATCH-merges the array against current state.
 */
export function applyToPatch(
  key: string,
  value: string,
  patch: GentuPatientPatch
): boolean {
  switch (key) {
    case "gentu:patient.first_name":
      (patch.extension ??= []).push({ system: "firstname", valueString: value });
      return true;
    case "gentu:patient.last_name":
      (patch.name ??= {}).family = value;
      return true;
    case "gentu:patient.date_of_birth":
      patch.birthDate = value;
      return true;
    case "gentu:patient.email":
      (patch.contact ??= []).push({ system: "email", use: "home", rank: 1, value });
      return true;
    case "gentu:patient.mobile":
      (patch.contact ??= []).push({ system: "phone", use: "mobile", rank: 1, value });
      return true;
    case "gentu:patient.address_line":
      upsertAddress(patch, (a) => (a.line = [value]));
      return true;
    case "gentu:patient.city":
      upsertAddress(patch, (a) => (a.city = value));
      return true;
    case "gentu:patient.state":
      upsertAddress(patch, (a) => (a.state = value));
      return true;
    case "gentu:patient.postcode":
      upsertAddress(patch, (a) => (a.postalCode = value));
      return true;
    default:
      return false;
  }
}

type PatchAddress = NonNullable<GentuPatientPatch["address"]>[number];

/** Get-or-create the single home/postal address element and apply `set`. */
function upsertAddress(patch: GentuPatientPatch, set: (a: PatchAddress) => void): void {
  const arr = (patch.address ??= [{ use: "home", type: "postal" }]);
  set(arr[0]);
}

/**
 * Read the CURRENT value of `key` from a fetched patient, for the fill-blanks
 * check. Returns "" / undefined when blank. Read shape differs from write shape
 * (names in extension OR name.given; contacts as a rank-ordered array).
 */
export function readCurrentValue(key: string, p: GentuPatient): unknown {
  switch (key) {
    case "gentu:patient.first_name": {
      const ext = p.extension?.find((e) => e.system === "firstname")?.valueString;
      if (ext) return ext;
      return (p.name?.given ?? "").trim().split(/\s+/)[0] ?? "";
    }
    case "gentu:patient.last_name":
      return p.name?.family ?? "";
    case "gentu:patient.date_of_birth":
      return p.birthDate ?? "";
    case "gentu:patient.email":
      return firstContact(p, "email");
    case "gentu:patient.mobile":
      // MOBILE specifically — the phone/mobile tuple, not any phone. An existing
      // home/work phone must NOT make the mobile field look non-blank and block
      // a legitimate mobile write (API reference §4; DoD).
      return firstContact(p, "phone", "mobile");
    case "gentu:patient.address_line":
      return firstAddress(p)?.line?.filter(Boolean).join(" ") ?? "";
    case "gentu:patient.city":
      return firstAddress(p)?.city ?? "";
    case "gentu:patient.state":
      return firstAddress(p)?.state ?? "";
    case "gentu:patient.postcode":
      return firstAddress(p)?.postalCode ?? "";
    default:
      return undefined;
  }
}

function firstContact(
  p: GentuPatient,
  system: "email" | "phone",
  use?: "home" | "work" | "mobile"
): string {
  const c = (p.contact ?? [])
    .filter((x) => x.system === system && x.value && (!use || x.use === use))
    .sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity))[0];
  return c?.value ?? "";
}

function firstAddress(p: GentuPatient) {
  return p.address?.[0] ?? null;
}
