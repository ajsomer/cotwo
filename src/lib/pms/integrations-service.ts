import "server-only";
import { db } from "@/lib/db";
import {
  appointmentTypes,
  pmsAppointmentTypeLinks,
  pmsConnections,
  pmsPractitionerLinks,
  locations as locationsT,
  rooms as roomsT,
  staffAssignments,
  users as usersT,
  typeWorkflowLinks,
} from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import type {
  PmsCapabilities,
  PmsCredentialField,
  PmsCredentials,
  PmsFieldCatalogueEntry,
} from "./adapter";
import { encryptCredentials } from "./credentials";
import { getFactory, getStaticMetadata } from "./registry";
import {
  type PmsConnectionRow,
  adapterForConnection,
  getConnectionForLocation,
  isSyncActive,
  orgForLocation,
} from "./connection";

/** What the Integrations page needs to render, provider-agnostically. */
export interface IntegrationStatus {
  hasConnection: boolean;
  syncActive: boolean;
  provider: string | null;
  providerLabel: string | null;
  status: string | null;
  lastSyncedAt: string | null;
  lastSyncError: string | null;
  capabilities: PmsCapabilities | null;
  fieldCatalogue: PmsFieldCatalogueEntry[];
  credentialFields: PmsCredentialField[];
}

export async function getIntegrationStatus(
  locationId: string
): Promise<IntegrationStatus> {
  const connection = await getConnectionForLocation(locationId);
  const provider = connection?.provider ?? null;
  const meta = provider ? getStaticMetadata(provider) : null;
  const factory = provider ? getFactory(provider) : null;

  return {
    hasConnection: Boolean(connection),
    syncActive: isSyncActive(connection),
    provider,
    providerLabel: factory?.displayName ?? null,
    status: connection?.status ?? null,
    lastSyncedAt: connection?.lastSyncedAt ?? null,
    lastSyncError: connection?.lastSyncError ?? null,
    capabilities: meta?.capabilities ?? null,
    fieldCatalogue: meta?.fieldCatalogue ?? [],
    credentialFields: meta?.credentialFields ?? [],
  };
}

/**
 * Connect (or re-credential) a location's PMS. Verifies the credentials with a
 * cheap authenticated call before persisting. Returns the verify result.
 */
export async function connectPms(args: {
  locationId: string;
  provider: string;
  credentials: PmsCredentials;
}): Promise<{ ok: boolean; detail?: string }> {
  const factory = getFactory(args.provider);
  if (!factory) return { ok: false, detail: "Unknown provider." };

  const orgId = await orgForLocation(args.locationId);
  if (!orgId) return { ok: false, detail: "Location has no org." };

  // Verify before storing — build a throwaway adapter from the raw creds.
  const probe = factory.create({
    connectionId: "probe",
    credentials: args.credentials,
  });
  const verified = await probe.verify();
  if (!verified.ok) return verified;

  const encrypted = encryptCredentials(args.credentials);

  await db
    .insert(pmsConnections)
    .values({
      orgId,
      locationId: args.locationId,
      provider: args.provider as typeof pmsConnections.$inferInsert.provider,
      status: "connected",
      credentialsEncrypted: encrypted,
    })
    .onConflictDoUpdate({
      target: pmsConnections.locationId,
      set: {
        provider: args.provider as typeof pmsConnections.$inferInsert.provider,
        status: "connected",
        credentialsEncrypted: encrypted,
        lastSyncError: null,
        updatedAt: new Date().toISOString(),
      },
    });

  return { ok: true };
}

/** Disconnect: clear credentials but keep the marker row + mappings. */
export async function disconnectPms(locationId: string): Promise<void> {
  await db
    .update(pmsConnections)
    .set({
      credentialsEncrypted: null,
      status: "skipped",
      updatedAt: new Date().toISOString(),
    })
    .where(eq(pmsConnections.locationId, locationId));
}

// ─────────────────────── Mapping read surfaces ───────────────────────

export interface MappingData {
  connectionId: string;
  appointmentTypes: Array<{
    externalId: string;
    name: string;
    durationMinutes: number | null;
    // current mapping (if any)
    appointmentTypeId: string | null;
    confirmedModality: "telehealth" | "in_person" | null;
    roomId: string | null;
    syncEnabled: boolean;
    hasWorkflowLink: boolean;
  }>;
  practitioners: Array<{
    externalId: string;
    displayName: string;
    staffAssignmentId: string | null;
  }>;
  businesses: Array<{ externalId: string; name: string; locationId: string | null }>;
  rooms: Array<{ id: string; name: string }>;
  clinicians: Array<{ staffAssignmentId: string; name: string }>;
}

/**
 * Pull live PMS resources and join them against current Coviu mappings, so the
 * Integrations page can render mapping pickers. Provider-agnostic — uses only
 * the adapter's list* methods.
 */
export async function getMappingData(
  connection: PmsConnectionRow
): Promise<MappingData> {
  const adapter = adapterForConnection(connection);
  if (!adapter) throw new Error("Connection is not sync-active.");
  const orgId = await orgForLocation(connection.locationId);
  if (!orgId) throw new Error("Location has no org.");

  const [pmsTypes, pmsPractitioners, pmsBusinesses] = await Promise.all([
    adapter.listAppointmentTypes(),
    adapter.listPractitioners(),
    adapter.listBusinesses(),
  ]);

  const [typeLinks, practitionerLinks, rooms, cliniciansRows, workflowLinks, locRow] =
    await Promise.all([
      db
        .select()
        .from(pmsAppointmentTypeLinks)
        .where(eq(pmsAppointmentTypeLinks.connectionId, connection.id)),
      db
        .select()
        .from(pmsPractitionerLinks)
        .where(eq(pmsPractitionerLinks.connectionId, connection.id)),
      db
        .select({ id: roomsT.id, name: roomsT.name })
        .from(roomsT)
        .where(eq(roomsT.locationId, connection.locationId)),
      db
        .select({
          staffAssignmentId: staffAssignments.id,
          name: usersT.fullName,
        })
        .from(staffAssignments)
        .innerJoin(usersT, eq(usersT.id, staffAssignments.userId))
        .where(eq(staffAssignments.locationId, connection.locationId)),
      db
        .select({ appointmentTypeId: typeWorkflowLinks.appointmentTypeId })
        .from(typeWorkflowLinks)
        .where(eq(typeWorkflowLinks.direction, "pre_appointment")),
      db
        .select({ id: locationsT.id, pmsExternalId: locationsT.pmsExternalId })
        .from(locationsT)
        .where(eq(locationsT.id, connection.locationId)),
    ]);

  const typeLinkByExt = new Map(typeLinks.map((l) => [l.pmsExternalId, l]));
  const practLinkByExt = new Map(
    practitionerLinks.map((l) => [l.pmsExternalId, l])
  );
  const workflowLinkedTypes = new Set(
    workflowLinks.map((w) => w.appointmentTypeId)
  );
  const thisLocation = locRow[0];

  return {
    connectionId: connection.id,
    appointmentTypes: pmsTypes.map((t) => {
      const link = typeLinkByExt.get(t.externalId);
      return {
        externalId: t.externalId,
        name: t.name,
        durationMinutes: t.durationMinutes,
        appointmentTypeId: link?.appointmentTypeId ?? null,
        confirmedModality: link?.confirmedModality ?? null,
        roomId: link?.roomId ?? null,
        syncEnabled: link?.syncEnabled ?? false,
        hasWorkflowLink: link?.appointmentTypeId
          ? workflowLinkedTypes.has(link.appointmentTypeId)
          : false,
      };
    }),
    practitioners: pmsPractitioners.map((p) => ({
      externalId: p.externalId,
      displayName: p.displayName,
      staffAssignmentId:
        practLinkByExt.get(p.externalId)?.staffAssignmentId ?? null,
    })),
    businesses: pmsBusinesses.map((b) => ({
      externalId: b.externalId,
      name: b.name,
      locationId:
        thisLocation?.pmsExternalId === b.externalId ? thisLocation.id : null,
    })),
    rooms,
    clinicians: cliniciansRows,
  };
}

// ─────────────────────── Mapping write surfaces ───────────────────────

/**
 * Confirm / configure an appointment type. Creates the org-scoped Coviu type if
 * needed (so the type link can reference it), upserts the connection-scoped
 * link with confirmed_modality / room / sync_enabled, and ensures a
 * pre-workflow link exists when telehealth+enabled (so add_to_runsheet fires).
 */
export async function saveAppointmentTypeMapping(args: {
  connectionId: string;
  locationId: string;
  externalId: string;
  externalName: string;
  durationMinutes: number | null;
  confirmedModality: "telehealth" | "in_person" | null;
  roomId: string | null;
  syncEnabled: boolean;
}): Promise<{ ok: boolean; detail?: string }> {
  const orgId = await orgForLocation(args.locationId);
  if (!orgId) return { ok: false, detail: "Location has no org." };

  // Resolve or create the Coviu appointment type backing this PMS type.
  const [existingLink] = await db
    .select({ appointmentTypeId: pmsAppointmentTypeLinks.appointmentTypeId })
    .from(pmsAppointmentTypeLinks)
    .where(
      and(
        eq(pmsAppointmentTypeLinks.connectionId, args.connectionId),
        eq(pmsAppointmentTypeLinks.pmsExternalId, args.externalId)
      )
    )
    .limit(1);

  let appointmentTypeId = existingLink?.appointmentTypeId;
  if (!appointmentTypeId) {
    const [created] = await db
      .insert(appointmentTypes)
      .values({
        orgId,
        name: args.externalName,
        // Insert as in_person by default so an unconfirmed import never silently
        // becomes telehealth (plan §5). Confirmed modality lives on the link.
        modality: args.confirmedModality ?? "in_person",
        durationMinutes: args.durationMinutes ?? 30,
        source: "pms",
        pmsProvider: "cliniko",
      })
      .returning({ id: appointmentTypes.id });
    appointmentTypeId = created.id;
  }

  await db
    .insert(pmsAppointmentTypeLinks)
    .values({
      connectionId: args.connectionId,
      appointmentTypeId,
      pmsExternalId: args.externalId,
      confirmedModality: args.confirmedModality,
      roomId: args.roomId,
      syncEnabled: args.syncEnabled,
    })
    .onConflictDoUpdate({
      target: [
        pmsAppointmentTypeLinks.connectionId,
        pmsAppointmentTypeLinks.pmsExternalId,
      ],
      set: {
        confirmedModality: args.confirmedModality,
        roomId: args.roomId,
        syncEnabled: args.syncEnabled,
        updatedAt: new Date().toISOString(),
      },
    });

  return { ok: true };
}

export async function savePractitionerMapping(args: {
  connectionId: string;
  externalId: string;
  staffAssignmentId: string | null;
}): Promise<void> {
  if (!args.staffAssignmentId) {
    // Unmap.
    await db
      .delete(pmsPractitionerLinks)
      .where(
        and(
          eq(pmsPractitionerLinks.connectionId, args.connectionId),
          eq(pmsPractitionerLinks.pmsExternalId, args.externalId)
        )
      );
    return;
  }
  await db
    .insert(pmsPractitionerLinks)
    .values({
      connectionId: args.connectionId,
      staffAssignmentId: args.staffAssignmentId,
      pmsExternalId: args.externalId,
    })
    .onConflictDoUpdate({
      target: [
        pmsPractitionerLinks.connectionId,
        pmsPractitionerLinks.pmsExternalId,
      ],
      set: { staffAssignmentId: args.staffAssignmentId },
    });
}

export async function saveBusinessMapping(args: {
  locationId: string;
  externalId: string | null;
}): Promise<void> {
  await db
    .update(locationsT)
    .set({ pmsExternalId: args.externalId, updatedAt: new Date().toISOString() })
    .where(eq(locationsT.id, args.locationId));
}
