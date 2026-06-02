/**
 * Canonical phone-number normalisation for the platform.
 *
 * Phone number is the patient identity key (OTP-verified), so the SAME number
 * must produce the SAME stored string regardless of where it was entered —
 * the readiness "add patient" form, the patient OTP entry flow, the run-sheet
 * "+ Add session" panel, PMS sync, or seed data. Previously each entry point
 * stored/compared the raw user input, so "+61412345678", "0412 345 678" and
 * "0412345678" were treated as three different people.
 *
 * The canonical form is E.164 (e.g. "+61412345678"). Use `normalisePhone` at
 * EVERY write and EVERY equality comparison against `phone_number` columns.
 *
 * This targets Australian numbers (the platform's market) but accepts any
 * already-E.164 international number as-is.
 */

/**
 * Normalise a phone number to E.164. Returns null if the input can't be a
 * valid number (too short / empty). Callers that require a number should treat
 * null as a validation error; callers normalising an optional value can keep
 * null/empty as-is.
 */
export function normalisePhone(input: string | null | undefined): string | null {
  if (!input) return null;

  // Strip spaces, dashes, parens, dots — keep a leading + and digits.
  const cleaned = input.replace(/[\s\-().]/g, "");
  const digits = cleaned.replace(/[^\d+]/g, "");

  if (digits.startsWith("+")) {
    // Fix a redundant AU trunk 0 after the country code: +610XXXXXXXXX (a
    // common mistake when a "+61" prefix is concatenated with a 0-led number)
    // → +61XXXXXXXXX.
    if (/^\+610\d{9}$/.test(digits)) {
      return "+61" + digits.slice(4);
    }
    // Already international. Keep if it has enough digits to be plausible.
    const numeric = digits.slice(1);
    return numeric.length >= 8 ? digits : null;
  }

  // Australian with country code, no + : 61XXXXXXXXX → +61XXXXXXXXX
  if (digits.startsWith("61") && digits.length === 11) {
    return "+" + digits;
  }

  // Doubled trunk prefix or "00" international prefix on an AU number, e.g.
  // "00450336880" → treat as 0450336880.
  if (digits.startsWith("00") && digits.length === 11) {
    return "+61" + digits.slice(2);
  }

  // Australian national format: 0XXXXXXXXX → +61XXXXXXXXX
  if (digits.startsWith("0") && digits.length === 10) {
    return "+61" + digits.slice(1);
  }

  // Australian subscriber number with NO leading 0 (e.g. a mobile typed as
  // "459408001" or "412345678"). 9 digits, first digit is a valid AU national
  // prefix (2 landline, 4 mobile, 5 mobile/satellite, 7 landline, 8 landline).
  // Coerce to +61 so "045940..." and "45940..." map to the same number.
  if (/^[24578]\d{8}$/.test(digits)) {
    return "+61" + digits;
  }

  // Anything else with enough digits — assume it's already country-coded.
  if (digits.length >= 10) {
    return "+" + digits;
  }

  return null;
}

/**
 * Like `normalisePhone` but returns the original trimmed string if it can't be
 * normalised, never null. Use only for display/storage paths that must not
 * reject input (e.g. preserving an oddly-formatted historical value).
 */
export function normalisePhoneLoose(input: string | null | undefined): string {
  if (!input) return "";
  return normalisePhone(input) ?? input.trim();
}
