import { NextResponse, type NextRequest } from "next/server";

/**
 * Shared response/validation helpers for API route handlers.
 *
 * Canonical error vocabulary (converges the historical drift of
 * "Unauthorized" / "Unauthenticated" / "Forbidden"-with-401):
 *   401 → "Unauthenticated"  (no auth session)
 *   403 → "Forbidden"        (session exists, lacks access to the scope)
 *   404 → "Not found"        (resource gates that deliberately don't leak
 *                             existence — see staff-access.ts docstrings)
 *
 * Success response shapes are owned by each route and are NOT standardised
 * here — client components depend on them.
 */

const DENY_MESSAGES: Record<401 | 403 | 404, string> = {
  401: "Unauthenticated",
  403: "Forbidden",
  404: "Not found",
};

/**
 * Map a failed staff-access gate result (`{ ok: false, status }` from
 * `src/lib/auth/staff-access.ts`) to its canonical HTTP error response.
 *
 * `options.notFound` overrides the 404 message for routes whose copy is
 * deliberately specific (e.g. the patient routes' "Patient not found").
 */
export function denyResponse(
  result: { status: 401 | 403 | 404 },
  options?: { notFound?: string },
): NextResponse {
  const message =
    result.status === 404 && options?.notFound
      ? options.notFound
      : DENY_MESSAGES[result.status];
  return NextResponse.json({ error: message }, { status: result.status });
}

/** Canonical 401 for inline `getAuthenticatedUserId()` null-checks. */
export function unauthenticatedResponse(): NextResponse {
  return denyResponse({ status: 401 });
}

export type ParsedJsonBody<T> =
  | { ok: true; body: T }
  | { ok: false; response: NextResponse };

/**
 * Parse a JSON request body without letting a malformed payload escape as a
 * 500. Returns `{ ok: true, body }` or `{ ok: false, response }` carrying a
 * 400 "Invalid request body".
 *
 * The type parameter is a convenience cast, not validation — callers must
 * still check required fields/enums (see `isOneOf`).
 */
export async function parseJsonBody<T = Record<string, unknown>>(
  request: NextRequest | Request,
): Promise<ParsedJsonBody<T>> {
  try {
    const body = (await request.json()) as T;
    return { ok: true, body };
  } catch {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Invalid request body" },
        { status: 400 },
      ),
    };
  }
}

/**
 * Narrowing membership check for enum-shaped inputs (`modality`, `room_type`,
 * payment routing fields, ...). Use with `invalidEnumResponse` so a bad enum
 * value surfaces as a 400 with a clear message instead of a DB-level 500.
 */
export function isOneOf<T extends string>(
  value: unknown,
  options: readonly T[],
): value is T {
  return typeof value === "string" && (options as readonly string[]).includes(value);
}

/** 400 response naming the field and its allowed values. */
export function invalidEnumResponse(
  field: string,
  options: readonly string[],
): NextResponse {
  return NextResponse.json(
    { error: `${field} must be one of: ${options.join(", ")}` },
    { status: 400 },
  );
}
