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
 * Resolve the caller's user id from the cookie session, verified LOCALLY.
 *
 * `getClaims()` validates the JWT signature against the project's cached
 * signing key (JWKS for asymmetric keys, or the shared secret for legacy
 * HS256) — no per-call network round-trip to the Supabase Auth server, unlike
 * `getUser()`. The returned `sub` claim is the user id (`users.id =
 * auth.users.id`; see the auth model in CLAUDE.md), which is all the gates
 * below consume.
 *
 * This is the single identity-resolution point for every staff gate; keep all
 * of them routed through it so the auth path stays consistent (no mix of
 * network-verifying and local-verifying reads). Returns null when the cookie
 * is absent or the token fails local verification.
 *
 * Exported for the setup/onboarding/livekit routes that only need the user id
 * and previously called `getUser()` directly — route them here too so there's
 * no network-verifying read left anywhere.
 */
export async function getAuthenticatedUserId(): Promise<string | null> {
  const ssr = await createServerClient();
  const { data, error } = await ssr.auth.getClaims();
  const sub = data?.claims?.sub;
  if (error || !sub) return null;
  return sub;
}

// ---------------------------------------------------------------------------
// Patient access-decision cache.
//
// The contact card now opens via two routes (/summary + /history), each of
// which runs assertStaffCanAccessPatient. The auth half is already local
// (getClaims), but the org-membership query would otherwise run on both. Cache
// the ALLOW decision briefly so the second route — and quick reopens — reuse
// it. Decision-only (a resolved StaffAccessResult), per-server-instance, short
// TTL. Never cache the patient's data here.
//
// Only successful (ok:true) decisions are cached: a denial may be transient
// (a just-added assignment), and not caching it keeps the failure path honest.
// ---------------------------------------------------------------------------
const PATIENT_ACCESS_TTL_MS = 30_000;
const patientAccessCache = new Map<
  string,
  { expiresAt: number; result: StaffAccessResult }
>();

function getCachedPatientAccess(
  userId: string,
  patientId: string,
): StaffAccessResult | null {
  const entry = patientAccessCache.get(`${userId}:${patientId}`);
  if (entry && entry.expiresAt > Date.now()) return entry.result;
  return null;
}

function setCachedPatientAccess(
  userId: string,
  patientId: string,
  result: StaffAccessResult,
): void {
  if (!result.ok) return;
  patientAccessCache.set(`${userId}:${patientId}`, {
    result,
    expiresAt: Date.now() + PATIENT_ACCESS_TTL_MS,
  });
}

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
  const userId = await getAuthenticatedUserId();
  if (!userId) return { ok: false, status: 401 };
  return { ok: true, userId };
}

/**
 * Gate for location-scoped staff API routes: authenticates the caller, then
 * verifies a `staff_assignment` to the requested location. Returns the user +
 * assignment role on success, or a status code on failure.
 *
 * Always call this before any service-role read keyed on `locationId`.
 * Without it, anyone who can guess a location ID can read its data.
 *
 * 403 (not 404) is intentional: location IDs are scoped per-org and not
 * patient-sensitive, so leaking existence is acceptable. Patient-scoped routes
 * (see `assertStaffCanAccessPatient`) should keep returning 404 for the
 * existence-leak reason documented there.
 */
export async function requireStaffLocationAccess(
  locationId: string,
): Promise<
  | { ok: true; userId: string; role: UserRole }
  | { ok: false; status: 401 | 403 }
> {
  const userId = await getAuthenticatedUserId();
  if (!userId) return { ok: false, status: 401 };

  const ssr = await createServerClient();
  const { data: assignment } = await ssr
    .from("staff_assignments")
    .select("role")
    .eq("user_id", userId)
    .eq("location_id", locationId)
    .maybeSingle();

  if (!assignment) return { ok: false, status: 403 };

  return { ok: true, userId, role: assignment.role as UserRole };
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
  const userId = await getAuthenticatedUserId();
  if (!userId) return { ok: false, status: 401 };

  // Reuse a recent allow-decision so the split /summary + /history opens (and
  // quick reopens) don't each re-run the membership query. Decision-only,
  // per-instance, short TTL — never caches patient data.
  const cached = getCachedPatientAccess(userId, patientId);
  if (cached) return cached;

  // Patient-org and the user's org memberships are independent reads — run
  // them concurrently rather than chaining.
  const [patientRes, orgIds] = await Promise.all([
    serviceClient.from("patients").select("org_id").eq("id", patientId).single(),
    fetchUserOrgIds(serviceClient, userId),
  ]);

  const patient = patientRes.data;
  if (!patient) return { ok: false, status: 404 };

  if (!orgIds.has(patient.org_id)) {
    return { ok: false, status: 404 };
  }

  const result: StaffAccessResult = {
    ok: true,
    userId,
    orgId: patient.org_id,
  };
  setCachedPatientAccess(userId, patientId, result);
  return result;
}

/**
 * Verifies the cookie-bound auth user is staff at the same org as the form
 * that produced a submission. Anchors on `forms.org_id` (durable) rather than
 * `patients.org_id` — patients can be merged/edited, the form can't drift.
 *
 * Returns { ok: true, userId, orgId } on success.
 * Returns { ok: false, status: 401 } if no auth user.
 * Returns { ok: false, status: 404 } if the submission doesn't exist or the
 * user is not staff at the form's org. 404 (not 403) — same existence-leak
 * rationale as `assertStaffCanAccessPatient`.
 */
export async function assertStaffCanAccessSubmission(
  serviceClient: SupabaseClient,
  submissionId: string,
): Promise<StaffAccessResult> {
  const userId = await getAuthenticatedUserId();
  if (!userId) return { ok: false, status: 401 };

  const { data: submission } = await serviceClient
    .from("form_submissions")
    .select("form_id, forms!inner(org_id)")
    .eq("id", submissionId)
    .single();

  if (!submission) return { ok: false, status: 404 };

  const formOrg = submission.forms as
    | { org_id: string }
    | { org_id: string }[]
    | null;
  const orgId = Array.isArray(formOrg) ? formOrg[0]?.org_id : formOrg?.org_id;
  if (!orgId) return { ok: false, status: 404 };

  const userOrgIds = await fetchUserOrgIds(serviceClient, userId);
  if (!userOrgIds.has(orgId)) {
    return { ok: false, status: 404 };
  }

  return { ok: true, userId, orgId };
}

/**
 * Collect the set of org IDs the authenticated user is staff at, via their
 * `staff_assignments → locations.org_id`. Shared by the org/resource gates
 * below so the membership rule lives in one place.
 */
async function fetchUserOrgIds(
  serviceClient: SupabaseClient,
  userId: string,
): Promise<Set<string>> {
  const { data: assignments } = await serviceClient
    .from("staff_assignments")
    .select("locations!inner(org_id)")
    .eq("user_id", userId);

  return new Set(
    (assignments ?? [])
      .map((a) => {
        const loc = a.locations as
          | { org_id: string }
          | { org_id: string }[]
          | null;
        if (Array.isArray(loc)) return loc[0]?.org_id;
        return loc?.org_id;
      })
      .filter((id): id is string => !!id),
  );
}

/**
 * Gate for org-scoped staff API routes (forms, appointment-types,
 * outcome-pathways, workflows config). Authenticates the caller, then proves
 * the user is staff at the SPECIFIC `orgId` named in the request.
 *
 * The client-supplied `org_id` is *validated against* the user's assignments —
 * never trusted on its own. This is the fix for the unauthenticated cross-org
 * exposure on the service-role config routes.
 *
 * Do NOT replace this with a "current org" helper that picks `assignments[0]`:
 * multi-org users have several assignments, and authorization must check
 * membership of the org named in the request, not a default.
 *
 * Returns { ok: true, userId, orgId } on success.
 * 401 if no auth user. 404 (not 403) if the user is not staff at that org —
 * matching the existence-leak convention of `assertStaffCanAccess*`.
 */
export async function requireStaffOrgAccess(
  serviceClient: SupabaseClient,
  orgId: string,
): Promise<StaffAccessResult> {
  const userId = await getAuthenticatedUserId();
  if (!userId) return { ok: false, status: 401 };

  const orgIds = await fetchUserOrgIds(serviceClient, userId);
  if (!orgIds.has(orgId)) return { ok: false, status: 404 };

  return { ok: true, userId, orgId };
}

/**
 * Resource-scoped gate: resolves a resource's `org_id` from a parent table,
 * then verifies the authenticated user is staff at that org. The backbone of
 * the `requireStaffCanAccess*` family below.
 *
 * `table`/`idColumn` locate the resource; `orgColumn` is the column on that
 * table carrying the org. 404 on missing resource OR non-membership (no
 * existence leak).
 */
async function requireStaffCanAccessResource(
  serviceClient: SupabaseClient,
  table: string,
  resourceId: string,
  orgColumn: string,
): Promise<StaffAccessResult> {
  const userId = await getAuthenticatedUserId();
  if (!userId) return { ok: false, status: 401 };

  const { data: row } = await serviceClient
    .from(table)
    .select(orgColumn)
    .eq("id", resourceId)
    .single();

  const orgId = (row as Record<string, string> | null)?.[orgColumn];
  if (!orgId) return { ok: false, status: 404 };

  const orgIds = await fetchUserOrgIds(serviceClient, userId);
  if (!orgIds.has(orgId)) return { ok: false, status: 404 };

  return { ok: true, userId, orgId };
}

// ---------------------------------------------------------------------------
// Nested-foreign-key validators.
//
// The gates above prove the caller staffs the org/location named in the
// request. These confirm that a *nested* id supplied alongside it (a patient,
// appointment, form, staff assignment) actually belongs to that same scope —
// defence in depth against a crafted request that passes the top-level gate
// but injects a cross-org/cross-location child id with service-role privileges.
// They take the already-resolved scope, so they don't re-authenticate; call
// them only after the top-level gate has run.
// ---------------------------------------------------------------------------

/** True iff every id in `ids` exists in `table` with `org_id === orgId`. */
export async function assertIdsBelongToOrg(
  serviceClient: SupabaseClient,
  table: string,
  ids: string[],
  orgId: string,
): Promise<boolean> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return true;

  const { data, error } = await serviceClient
    .from(table)
    .select("id")
    .eq("org_id", orgId)
    .in("id", unique);

  if (error) return false;
  return (data?.length ?? 0) === unique.length;
}

/** True iff the patient belongs to `orgId`. */
export function assertPatientInOrg(
  serviceClient: SupabaseClient,
  patientId: string,
  orgId: string,
): Promise<boolean> {
  return assertIdsBelongToOrg(serviceClient, "patients", [patientId], orgId);
}

/** True iff the appointment belongs to `orgId`. */
export function assertAppointmentInOrg(
  serviceClient: SupabaseClient,
  appointmentId: string,
  orgId: string,
): Promise<boolean> {
  return assertIdsBelongToOrg(
    serviceClient,
    "appointments",
    [appointmentId],
    orgId,
  );
}

/** True iff every form id belongs to `orgId`. */
export function assertFormsInOrg(
  serviceClient: SupabaseClient,
  formIds: string[],
  orgId: string,
): Promise<boolean> {
  return assertIdsBelongToOrg(serviceClient, "forms", formIds, orgId);
}

/** True iff every staff_assignment id is attached to `locationId`. */
export async function assertStaffAssignmentsInLocation(
  serviceClient: SupabaseClient,
  staffAssignmentIds: string[],
  locationId: string,
): Promise<boolean> {
  const unique = [...new Set(staffAssignmentIds.filter(Boolean))];
  if (unique.length === 0) return true;

  const { data, error } = await serviceClient
    .from("staff_assignments")
    .select("id")
    .eq("location_id", locationId)
    .in("id", unique);

  if (error) return false;
  return (data?.length ?? 0) === unique.length;
}

/** Verify staff access to a form, anchored on `forms.org_id`. */
export function requireStaffCanAccessForm(
  serviceClient: SupabaseClient,
  formId: string,
): Promise<StaffAccessResult> {
  return requireStaffCanAccessResource(serviceClient, "forms", formId, "org_id");
}

/** Verify staff access to a workflow template, anchored on `workflow_templates.org_id`. */
export function requireStaffCanAccessWorkflowTemplate(
  serviceClient: SupabaseClient,
  templateId: string,
): Promise<StaffAccessResult> {
  return requireStaffCanAccessResource(
    serviceClient,
    "workflow_templates",
    templateId,
    "org_id",
  );
}

/** Verify staff access to an appointment type, anchored on `appointment_types.org_id`. */
export function requireStaffCanAccessAppointmentType(
  serviceClient: SupabaseClient,
  appointmentTypeId: string,
): Promise<StaffAccessResult> {
  return requireStaffCanAccessResource(
    serviceClient,
    "appointment_types",
    appointmentTypeId,
    "org_id",
  );
}

/** Verify staff access to an uploaded file, anchored on `files.org_id`. */
export function requireStaffCanAccessFile(
  serviceClient: SupabaseClient,
  fileId: string,
): Promise<StaffAccessResult> {
  return requireStaffCanAccessResource(serviceClient, "files", fileId, "org_id");
}

/** Verify staff access to an outcome pathway, anchored on `outcome_pathways.org_id`. */
export function requireStaffCanAccessOutcomePathway(
  serviceClient: SupabaseClient,
  pathwayId: string,
): Promise<StaffAccessResult> {
  return requireStaffCanAccessResource(
    serviceClient,
    "outcome_pathways",
    pathwayId,
    "org_id",
  );
}

/**
 * Verify staff access to an appointment. Appointments carry both `org_id` and
 * `location_id`; we anchor on `org_id` for the membership check and also return
 * the `location_id` so location-scoped readiness routes can use it.
 *
 * Returns { ok: true, userId, orgId, locationId } on success.
 */
export async function requireStaffCanAccessAppointment(
  serviceClient: SupabaseClient,
  appointmentId: string,
): Promise<
  | { ok: true; userId: string; orgId: string; locationId: string }
  | { ok: false; status: 401 | 404 }
> {
  const userId = await getAuthenticatedUserId();
  if (!userId) return { ok: false, status: 401 };

  const { data: appt } = await serviceClient
    .from("appointments")
    .select("org_id, location_id")
    .eq("id", appointmentId)
    .single();

  if (!appt?.org_id) return { ok: false, status: 404 };

  const orgIds = await fetchUserOrgIds(serviceClient, userId);
  if (!orgIds.has(appt.org_id)) return { ok: false, status: 404 };

  return {
    ok: true,
    userId,
    orgId: appt.org_id,
    locationId: appt.location_id,
  };
}

/**
 * Verify staff access to a form assignment, resolved via its form's org.
 */
export async function requireStaffCanAccessFormAssignment(
  serviceClient: SupabaseClient,
  assignmentId: string,
): Promise<StaffAccessResult> {
  const userId = await getAuthenticatedUserId();
  if (!userId) return { ok: false, status: 401 };

  const { data: assignment } = await serviceClient
    .from("form_assignments")
    .select("form_id, forms!inner(org_id)")
    .eq("id", assignmentId)
    .single();

  if (!assignment) return { ok: false, status: 404 };
  const formOrg = assignment.forms as
    | { org_id: string }
    | { org_id: string }[]
    | null;
  const orgId = Array.isArray(formOrg) ? formOrg[0]?.org_id : formOrg?.org_id;
  if (!orgId) return { ok: false, status: 404 };

  const orgIds = await fetchUserOrgIds(serviceClient, userId);
  if (!orgIds.has(orgId)) return { ok: false, status: 404 };

  return { ok: true, userId, orgId };
}

/**
 * Default-org resolution for genuinely default/setup flows where NO scope is
 * supplied (onboarding, "land somewhere sensible on first login"). Picks the
 * first assignment.
 *
 * ⚠️ This is NOT an authorization primitive. Multi-org/multi-location users
 * have several assignments; the `.limit(1)` "first wins" choice is ambiguous.
 * NEVER use this to authorize a request scoped to a specific org/location —
 * use `requireStaffOrgAccess` / `requireStaffLocationAccess` for that. Keep it
 * out of any write path that targets a caller-named scope.
 */
export async function resolveDefaultStaffOrg(
  userId: string,
): Promise<{ orgId: string; locationId: string } | null> {
  const ssr = await createServerClient();
  const { data: assignments } = await ssr
    .from("staff_assignments")
    .select("location_id, locations!inner(org_id)")
    .eq("user_id", userId)
    .limit(1);

  const assignment = assignments?.[0];
  if (!assignment) return null;
  const loc = assignment.locations as
    | { org_id: string }
    | { org_id: string }[]
    | null;
  const orgId = Array.isArray(loc) ? loc[0]?.org_id : loc?.org_id;
  if (!orgId) return null;

  return { orgId, locationId: assignment.location_id };
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
