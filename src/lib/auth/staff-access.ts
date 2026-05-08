import { createClient as createServerClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Location, Organisation, UserRole } from "@/lib/supabase/types";

export interface StaffAssignmentData {
  location: Location;
  org: Organisation;
  role: UserRole;
  userId: string;
  fullName: string;
}

export type StaffAccessResult =
  | { ok: true; userId: string; orgId: string }
  | { ok: false; status: 401 | 404 };

/**
 * First gate on staff-only API routes: must be called before any
 * service-role lookup of the resource. Returns the auth user or 401.
 *
 * Calling service-role lookups before this returns lets unauthenticated
 * callers distinguish valid resource IDs (401, "exists, please log in")
 * from invalid ones (404, "not found"). That's an existence-leak. Always
 * gate the cookie check first, then resolve the resource.
 */
export async function requireAuthenticatedUser(): Promise<
  | { ok: true; userId: string }
  | { ok: false; status: 401 }
> {
  const ssr = await createServerClient();
  const {
    data: { user },
  } = await ssr.auth.getUser();
  if (!user) return { ok: false, status: 401 };
  return { ok: true, userId: user.id };
}

/**
 * Verifies the cookie-bound auth user is staff at the same org as the patient.
 *
 * Returns { ok: true, userId, orgId } on success.
 * Returns { ok: false, status: 401 } if no auth user.
 * Returns { ok: false, status: 404 } if the patient doesn't exist or the user
 * is not a staff member at the patient's org. 404 (not 403) is intentional —
 * we don't leak patient existence to unauthorised callers.
 *
 * `serviceClient` is used for the patient + staff_assignments lookups so the
 * checks see all rows regardless of RLS (which is staff-scoped via auth.uid()
 * and would otherwise be empty for service-role bypass paths). The auth check
 * itself uses an SSR client bound to the request cookies.
 */
export async function assertStaffCanAccessPatient(
  serviceClient: SupabaseClient,
  patientId: string,
): Promise<StaffAccessResult> {
  const ssr = await createServerClient();
  const {
    data: { user },
  } = await ssr.auth.getUser();

  if (!user) return { ok: false, status: 401 };

  const { data: patient } = await serviceClient
    .from("patients")
    .select("org_id")
    .eq("id", patientId)
    .single();

  if (!patient) return { ok: false, status: 404 };

  const { data: assignments } = await serviceClient
    .from("staff_assignments")
    .select("location_id, locations!inner(org_id)")
    .eq("user_id", user.id);

  const orgIds = new Set(
    (assignments ?? [])
      .map((a) => {
        const loc = a.locations as { org_id: string } | { org_id: string }[] | null;
        if (Array.isArray(loc)) return loc[0]?.org_id;
        return loc?.org_id;
      })
      .filter((id): id is string => !!id),
  );

  if (!orgIds.has(patient.org_id)) {
    return { ok: false, status: 404 };
  }

  return { ok: true, userId: user.id, orgId: patient.org_id };
}

/**
 * Resolve all clinic assignments for a user, ordered deterministically.
 *
 * Used by the (clinic) layout AND by page-level server fetches that need to
 * pick the same "default location" the layout will pick (assignments[0]).
 * Without a stable order, Postgres can return rows in different orders per
 * query, which would let SSR hydrate sessions for one location while the
 * client provider selects another.
 *
 * Order: location.name asc, location.id asc as tiebreaker.
 */
export async function fetchUserClinicAssignments(
  userId: string,
  fullName: string,
): Promise<StaffAssignmentData[]> {
  const ssr = await createServerClient();

  const { data } = await ssr
    .from("staff_assignments")
    .select(
      `
      role,
      locations!inner (
        id,
        org_id,
        name,
        address,
        timezone,
        qr_token,
        stripe_account_id,
        organisations!inner (
          id,
          name,
          slug,
          tier,
          logo_url,
          stripe_routing,
          timezone
        )
      )
    `,
    )
    .eq("user_id", userId);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const assignments: StaffAssignmentData[] = (data ?? []).map((sa: any) => {
    const loc = sa.locations as Record<string, unknown>;
    const org = loc.organisations as Record<string, unknown>;
    return {
      userId,
      fullName,
      role: sa.role as UserRole,
      location: {
        id: loc.id as string,
        org_id: loc.org_id as string,
        name: loc.name as string,
        address: loc.address as string | null,
        timezone: loc.timezone as string,
        qr_token: loc.qr_token as string,
        stripe_account_id: loc.stripe_account_id as string | null,
      },
      org: {
        id: org.id as string,
        name: org.name as string,
        slug: org.slug as string,
        tier: org.tier as Organisation["tier"],
        logo_url: org.logo_url as string | null,
        stripe_routing: org.stripe_routing as Organisation["stripe_routing"],
        timezone: org.timezone as string,
      },
    };
  });

  // Deterministic ordering — see docstring.
  assignments.sort((a, b) => {
    const byName = a.location.name.localeCompare(b.location.name);
    if (byName !== 0) return byName;
    return a.location.id.localeCompare(b.location.id);
  });

  return assignments;
}
