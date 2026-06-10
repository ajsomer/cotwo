import { auth } from "@/lib/auth/neon-auth";
import type { Location, Organisation, UserRole } from "@/lib/types/domain";
import { db } from "@/lib/db";
import {
  staffAssignments,
  locations as locationsT,
  patients as patientsT,
  formSubmissions,
  forms as formsT,
  appointments as appointmentsT,
  sessions as sessionsT,
  appointmentTypes as appointmentTypesT,
  workflowTemplates as workflowTemplatesT,
  outcomePathways as outcomePathwaysT,
  files as filesT,
  formAssignments,
  organisations as organisationsT,
} from "@/lib/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";

/**
 * Roles allowed to perform practice-manager-level configuration (PMS
 * connections, mappings, type imports, setup flows).
 *
 * `clinic_owner` must always ride along with `practice_manager` here — the
 * owner is a practising clinician who also holds every PM permission. Any
 * new "PM-only" check should use this set rather than re-declaring it.
 */
export const PM_ROLES: ReadonlySet<UserRole> = new Set<UserRole>([
  "practice_manager",
  "clinic_owner",
]);

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
 * Resolve the caller's user id from the Neon Auth session.
 *
 * `auth.getSession()` reads the signed session cookie and verifies it locally
 * (cached for sessionDataTtl), only hitting the Neon Auth server when the cache
 * is cold — so this stays fast on the hot path. The returned `session.user.id`
 * is the Neon Auth user id, which the app uses directly as `public.users.id`
 * (see neon-auth.ts identity contract). That id is all the gates below consume.
 *
 * This is the single identity-resolution point for every staff gate; keep all
 * of them routed through it so the auth path stays consistent. Returns null
 * when there is no active session.
 */
export async function getAuthenticatedUserId(): Promise<string | null> {
  const { data } = await auth.getSession();
  return data?.user?.id ?? null;
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

// ---------------------------------------------------------------------------
// Prototype staff-scope cache.
//
// Staff location/org membership is checked by many API routes during one page
// load. The auth cookie already gives us the user id locally; this cache avoids
// re-querying staff_assignments for the same user on each adjacent request.
//
// Trade-off: assignment changes can take up to this TTL to affect a warm server
// process. Acceptable for the prototype; production should invalidate this on
// staff-assignment writes or use an access-version/session-revocation model.
// ---------------------------------------------------------------------------
const STAFF_SCOPE_TTL_MS = 5 * 60 * 1000;

interface StaffAccessScope {
  locationRoles: Map<string, UserRole>;
  orgIds: Set<string>;
}

const staffScopeCache = new Map<
  string,
  { expiresAt: number; scope: StaffAccessScope }
>();

async function getUserAccessScope(userId: string): Promise<StaffAccessScope> {
  const cached = staffScopeCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) return cached.scope;

  const assignments = await db
    .select({
      location_id: staffAssignments.locationId,
      role: staffAssignments.role,
      org_id: locationsT.orgId,
    })
    .from(staffAssignments)
    .innerJoin(locationsT, eq(locationsT.id, staffAssignments.locationId))
    .where(eq(staffAssignments.userId, userId));

  const locationRoles = new Map<string, UserRole>();
  const orgIds = new Set<string>();

  for (const assignment of assignments) {
    locationRoles.set(assignment.location_id, assignment.role as UserRole);
    if (assignment.org_id) orgIds.add(assignment.org_id);
  }

  const scope = { locationRoles, orgIds };
  staffScopeCache.set(userId, {
    scope,
    expiresAt: Date.now() + STAFF_SCOPE_TTL_MS,
  });
  return scope;
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

  const scope = await getUserAccessScope(userId);
  const role = scope.locationRoles.get(locationId);
  if (!role) return { ok: false, status: 403 };

  return { ok: true, userId, role };
}

/**
 * Verifies the cookie-bound auth user is staff at the same org as the patient.
 *
 * Returns { ok: true, userId, orgId } on success.
 * Returns { ok: false, status: 401 } if no auth user.
 * Returns { ok: false, status: 404 } if the patient doesn't exist or the user
 * is not a staff member at the patient's org. 404 (not 403) is intentional —
 * we don't leak patient existence to unauthorised callers.
 */
export async function assertStaffCanAccessPatient(
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
  const [patientRows, orgIds] = await Promise.all([
    db.select({ org_id: patientsT.orgId }).from(patientsT).where(eq(patientsT.id, patientId)).limit(1),
    fetchUserOrgIds(userId),
  ]);

  const patient = patientRows[0];
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
  submissionId: string,
): Promise<StaffAccessResult> {
  const userId = await getAuthenticatedUserId();
  if (!userId) return { ok: false, status: 401 };

  const [submission] = await db
    .select({ org_id: formsT.orgId })
    .from(formSubmissions)
    .innerJoin(formsT, eq(formsT.id, formSubmissions.formId))
    .where(eq(formSubmissions.id, submissionId))
    .limit(1);

  if (!submission) return { ok: false, status: 404 };

  const orgId = submission.org_id;
  if (!orgId) return { ok: false, status: 404 };

  const userOrgIds = await fetchUserOrgIds(userId);
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
async function fetchUserOrgIds(userId: string): Promise<Set<string>> {
  const scope = await getUserAccessScope(userId);
  return scope.orgIds;
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
  orgId: string,
): Promise<StaffAccessResult> {
  const userId = await getAuthenticatedUserId();
  if (!userId) return { ok: false, status: 401 };

  const orgIds = await fetchUserOrgIds(userId);
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
// Maps the legacy `table` string used by the resource gates to its Drizzle
// table + id/org columns. Every resource here is org-scoped via `org_id`.
const RESOURCE_TABLES: Record<
  string,
  { table: PgTable; id: PgColumn; org: PgColumn }
> = {
  forms: { table: formsT, id: formsT.id, org: formsT.orgId },
  workflow_templates: { table: workflowTemplatesT, id: workflowTemplatesT.id, org: workflowTemplatesT.orgId },
  appointment_types: { table: appointmentTypesT, id: appointmentTypesT.id, org: appointmentTypesT.orgId },
  files: { table: filesT, id: filesT.id, org: filesT.orgId },
  outcome_pathways: { table: outcomePathwaysT, id: outcomePathwaysT.id, org: outcomePathwaysT.orgId },
};

async function requireStaffCanAccessResource(
  table: string,
  resourceId: string,
): Promise<StaffAccessResult> {
  const userId = await getAuthenticatedUserId();
  if (!userId) return { ok: false, status: 401 };

  const mapping = RESOURCE_TABLES[table];
  if (!mapping) return { ok: false, status: 404 };

  const [row] = await db
    .select({ org_id: mapping.org })
    .from(mapping.table)
    .where(eq(mapping.id, resourceId))
    .limit(1);

  const orgId = (row as { org_id: string } | undefined)?.org_id;
  if (!orgId) return { ok: false, status: 404 };

  const orgIds = await fetchUserOrgIds(userId);
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
// Org-scoped tables addressable by the `assertIdsBelongToOrg` helper.
const ORG_SCOPED_TABLES: Record<
  string,
  { table: PgTable; id: PgColumn; org: PgColumn }
> = {
  patients: { table: patientsT, id: patientsT.id, org: patientsT.orgId },
  appointments: { table: appointmentsT, id: appointmentsT.id, org: appointmentsT.orgId },
  forms: { table: formsT, id: formsT.id, org: formsT.orgId },
};

export async function assertIdsBelongToOrg(
  table: string,
  ids: string[],
  orgId: string,
): Promise<boolean> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return true;

  const mapping = ORG_SCOPED_TABLES[table];
  if (!mapping) return false;

  try {
    const data = await db
      .select({ id: mapping.id })
      .from(mapping.table)
      .where(and(eq(mapping.org, orgId), inArray(mapping.id, unique)));
    return data.length === unique.length;
  } catch {
    return false;
  }
}

/** True iff the patient belongs to `orgId`. */
export function assertPatientInOrg(
  patientId: string,
  orgId: string,
): Promise<boolean> {
  return assertIdsBelongToOrg("patients", [patientId], orgId);
}

/** True iff the appointment belongs to `orgId`. */
export function assertAppointmentInOrg(
  appointmentId: string,
  orgId: string,
): Promise<boolean> {
  return assertIdsBelongToOrg(
    "appointments",
    [appointmentId],
    orgId,
  );
}

/** True iff every form id belongs to `orgId`. */
export function assertFormsInOrg(
  formIds: string[],
  orgId: string,
): Promise<boolean> {
  return assertIdsBelongToOrg("forms", formIds, orgId);
}

/** True iff every staff_assignment id is attached to `locationId`. */
export async function assertStaffAssignmentsInLocation(
  staffAssignmentIds: string[],
  locationId: string,
): Promise<boolean> {
  const unique = [...new Set(staffAssignmentIds.filter(Boolean))];
  if (unique.length === 0) return true;

  try {
    const data = await db
      .select({ id: staffAssignments.id })
      .from(staffAssignments)
      .where(
        and(
          eq(staffAssignments.locationId, locationId),
          inArray(staffAssignments.id, unique)
        )
      );
    return data.length === unique.length;
  } catch {
    return false;
  }
}

/** Verify staff access to a form, anchored on `forms.org_id`. */
export function requireStaffCanAccessForm(
  formId: string,
): Promise<StaffAccessResult> {
  return requireStaffCanAccessResource("forms", formId);
}

/** Verify staff access to a workflow template, anchored on `workflow_templates.org_id`. */
export function requireStaffCanAccessWorkflowTemplate(
  templateId: string,
): Promise<StaffAccessResult> {
  return requireStaffCanAccessResource(
    "workflow_templates",
    templateId,
  );
}

/** Verify staff access to an appointment type, anchored on `appointment_types.org_id`. */
export function requireStaffCanAccessAppointmentType(
  appointmentTypeId: string,
): Promise<StaffAccessResult> {
  return requireStaffCanAccessResource(
    "appointment_types",
    appointmentTypeId,
  );
}

/** Verify staff access to an uploaded file, anchored on `files.org_id`. */
export function requireStaffCanAccessFile(
  fileId: string,
): Promise<StaffAccessResult> {
  return requireStaffCanAccessResource("files", fileId);
}

/** Verify staff access to an outcome pathway, anchored on `outcome_pathways.org_id`. */
export function requireStaffCanAccessOutcomePathway(
  pathwayId: string,
): Promise<StaffAccessResult> {
  return requireStaffCanAccessResource(
    "outcome_pathways",
    pathwayId,
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
  appointmentId: string,
): Promise<
  | { ok: true; userId: string; orgId: string; locationId: string }
  | { ok: false; status: 401 | 404 }
> {
  const userId = await getAuthenticatedUserId();
  if (!userId) return { ok: false, status: 401 };

  const [appt] = await db
    .select({ org_id: appointmentsT.orgId, location_id: appointmentsT.locationId })
    .from(appointmentsT)
    .where(eq(appointmentsT.id, appointmentId))
    .limit(1);

  if (!appt?.org_id) return { ok: false, status: 404 };

  const orgIds = await fetchUserOrgIds(userId);
  if (!orgIds.has(appt.org_id)) return { ok: false, status: 404 };

  return {
    ok: true,
    userId,
    orgId: appt.org_id,
    locationId: appt.location_id,
  };
}

// ---------------------------------------------------------------------------
// Location-anchored resource gates (403 family).
//
// Unlike the org-anchored `requireStaffCanAccess*` gates above (which return
// 404 on non-membership to avoid existence leaks), these resolve a resource's
// `location_id` and run the standard location gate, so non-membership is a
// 403. Used by the PMS push routes, whose clients distinguish "resource gone"
// (404) from "not your location" (403). Both return the resolved `locationId`
// so callers don't re-query it.
// ---------------------------------------------------------------------------

export type StaffLocationResourceAccess =
  | { ok: true; userId: string; role: UserRole; locationId: string }
  | { ok: false; status: 401 | 403 | 404 };

/** Resolve a session's location, then require staff access to it. */
export async function requireStaffSessionLocationAccess(
  sessionId: string,
): Promise<StaffLocationResourceAccess> {
  const [session] = await db
    .select({ location_id: sessionsT.locationId })
    .from(sessionsT)
    .where(eq(sessionsT.id, sessionId))
    .limit(1);
  if (!session) return { ok: false, status: 404 };

  const access = await requireStaffLocationAccess(session.location_id);
  if (!access.ok) return access;
  return { ...access, locationId: session.location_id };
}

/**
 * Resolve an appointment's location, then require staff access to it.
 * Location-anchored sibling of `requireStaffCanAccessAppointment` (which is
 * org-anchored and 404-on-denial) — pick by the status semantics you need.
 */
export async function requireStaffAppointmentLocationAccess(
  appointmentId: string,
): Promise<StaffLocationResourceAccess> {
  const [appt] = await db
    .select({ location_id: appointmentsT.locationId })
    .from(appointmentsT)
    .where(eq(appointmentsT.id, appointmentId))
    .limit(1);
  if (!appt) return { ok: false, status: 404 };

  const access = await requireStaffLocationAccess(appt.location_id);
  if (!access.ok) return access;
  return { ...access, locationId: appt.location_id };
}

/**
 * Verify staff access to a form assignment, resolved via its form's org.
 */
export async function requireStaffCanAccessFormAssignment(
  assignmentId: string,
): Promise<StaffAccessResult> {
  const userId = await getAuthenticatedUserId();
  if (!userId) return { ok: false, status: 401 };

  const [assignment] = await db
    .select({ org_id: formsT.orgId })
    .from(formAssignments)
    .innerJoin(formsT, eq(formsT.id, formAssignments.formId))
    .where(eq(formAssignments.id, assignmentId))
    .limit(1);

  if (!assignment) return { ok: false, status: 404 };
  const orgId = assignment.org_id;
  if (!orgId) return { ok: false, status: 404 };

  const orgIds = await fetchUserOrgIds(userId);
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
  const [assignment] = await db
    .select({
      location_id: staffAssignments.locationId,
      org_id: locationsT.orgId,
    })
    .from(staffAssignments)
    .innerJoin(locationsT, eq(locationsT.id, staffAssignments.locationId))
    .where(eq(staffAssignments.userId, userId))
    .limit(1);

  if (!assignment) return null;
  const orgId = assignment.org_id;
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
  const rows = await db
    .select({
      role: staffAssignments.role,
      loc_id: locationsT.id,
      loc_org_id: locationsT.orgId,
      loc_name: locationsT.name,
      loc_address: locationsT.address,
      loc_timezone: locationsT.timezone,
      loc_qr_token: locationsT.qrToken,
      loc_stripe_account_id: locationsT.stripeAccountId,
      org_id: organisationsT.id,
      org_name: organisationsT.name,
      org_slug: organisationsT.slug,
      org_tier: organisationsT.tier,
      org_logo_url: organisationsT.logoUrl,
      org_stripe_routing: organisationsT.stripeRouting,
      org_timezone: organisationsT.timezone,
    })
    .from(staffAssignments)
    .innerJoin(locationsT, eq(locationsT.id, staffAssignments.locationId))
    .innerJoin(organisationsT, eq(organisationsT.id, locationsT.orgId))
    .where(eq(staffAssignments.userId, userId));

  const assignments: StaffAssignmentData[] = rows.map((sa) => {
    return {
      userId,
      fullName,
      role: sa.role as UserRole,
      location: {
        id: sa.loc_id,
        org_id: sa.loc_org_id,
        name: sa.loc_name,
        address: sa.loc_address,
        timezone: sa.loc_timezone,
        qr_token: sa.loc_qr_token as string,
        stripe_account_id: sa.loc_stripe_account_id,
      },
      org: {
        id: sa.org_id,
        name: sa.org_name,
        slug: sa.org_slug,
        tier: sa.org_tier as Organisation["tier"],
        logo_url: sa.org_logo_url,
        stripe_routing: sa.org_stripe_routing as Organisation["stripe_routing"],
        timezone: sa.org_timezone,
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
