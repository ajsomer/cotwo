import "server-only";
import { db } from "@/lib/db";
import {
  appointmentTypes,
  forms as formsT,
  pmsAppointmentTypeLinks,
  pmsConnections,
  pmsPractitionerLinks,
  locations as locationsT,
  rooms as roomsT,
} from "@/lib/db/schema";
import { buildRegistrationFormSchema } from "./seeded-registration-form";
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

  // Seed a PMS-scoped "Patient Registration" write-back form so the clinic has
  // a working write-back form immediately (plan §7a). Generic over the
  // adapter's catalogue; idempotent (skipped if one already exists for this
  // org + provider).
  await ensureRegistrationForm(orgId, args.provider);

  return { ok: true };
}

async function ensureRegistrationForm(
  orgId: string,
  provider: string
): Promise<void> {
  const meta = getStaticMetadata(provider);
  if (!meta) return;

  const existing = await db
    .select({ id: formsT.id })
    .from(formsT)
    .where(
      and(
        eq(formsT.orgId, orgId),
        eq(formsT.pmsProvider, provider as "cliniko")
      )
    )
    .limit(1);
  if (existing.length > 0) return;

  await db.insert(formsT).values({
    orgId,
    name: "Patient Registration",
    description: "Write-back registration form, generated from your PMS fields.",
    status: "draft",
    pmsProvider: provider as typeof formsT.$inferInsert.pmsProvider,
    schema: buildRegistrationFormSchema(meta.fieldCatalogue),
  });
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
  // Practitioners (the appointment-book columns) → Coviu rooms. A synced
  // appointment lands the patient in its practitioner's room (§025).
  practitioners: Array<{
    externalId: string;
    displayName: string;
    roomId: string | null;
  }>;
  businesses: Array<{ externalId: string; name: string; locationId: string | null }>;
  rooms: Array<{ id: string; name: string }>;
}

/**
 * Pull live PMS resources and join them against current Coviu mappings, so the
 * Integrations page can render mapping pickers. Provider-agnostic — uses only
 * the adapter's list* methods. Appointment types are managed in Workflows, not
 * here, so this surface covers only practitioners→rooms and business→location.
 */
export async function getMappingData(
  connection: PmsConnectionRow
): Promise<MappingData> {
  const adapter = adapterForConnection(connection);
  if (!adapter) throw new Error("Connection is not sync-active.");

  const [pmsPractitioners, pmsBusinesses] = await Promise.all([
    adapter.listPractitioners(),
    adapter.listBusinesses(),
  ]);

  const [practitionerLinks, rooms, locRow] = await Promise.all([
    db
      .select()
      .from(pmsPractitionerLinks)
      .where(eq(pmsPractitionerLinks.connectionId, connection.id)),
    db
      .select({ id: roomsT.id, name: roomsT.name })
      .from(roomsT)
      .where(eq(roomsT.locationId, connection.locationId)),
    db
      .select({ id: locationsT.id, pmsExternalId: locationsT.pmsExternalId })
      .from(locationsT)
      .where(eq(locationsT.id, connection.locationId)),
  ]);

  const practLinkByExt = new Map(
    practitionerLinks.map((l) => [l.pmsExternalId, l])
  );
  const thisLocation = locRow[0];

  return {
    connectionId: connection.id,
    practitioners: pmsPractitioners.map((p) => ({
      externalId: p.externalId,
      displayName: p.displayName,
      roomId: practLinkByExt.get(p.externalId)?.roomId ?? null,
    })),
    businesses: pmsBusinesses.map((b) => ({
      externalId: b.externalId,
      name: b.name,
      locationId:
        thisLocation?.pmsExternalId === b.externalId ? thisLocation.id : null,
    })),
    rooms,
  };
}

// ─────────────────────── Mapping write surfaces ───────────────────────

/**
 * Confirm / configure an appointment type. Creates the org-scoped Coviu type if
 * needed (so the type link can reference it), upserts the connection-scoped
 * link with confirmed_modality / room / sync_enabled, and ensures a
 * pre-workflow link exists when telehealth+enabled (so add_to_runsheet fires).
 */
/**
 * Confirm a PMS-imported appointment type's modality + sync toggle, keyed on the
 * Coviu appointment type id (what the Workflows type editor knows). Updates the
 * type's existing PMS link. Room is NOT set here — it comes from the
 * practitioner→room mapping (§025). Returns ok:false if the type has no PMS link
 * (i.e. it isn't a PMS-imported type).
 */
export async function confirmAppointmentTypeSync(args: {
  appointmentTypeId: string;
  confirmedModality: "telehealth" | "in_person" | null;
  syncEnabled: boolean;
}): Promise<{ ok: boolean; detail?: string }> {
  const result = await db
    .update(pmsAppointmentTypeLinks)
    .set({
      confirmedModality: args.confirmedModality,
      syncEnabled: args.syncEnabled,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(pmsAppointmentTypeLinks.appointmentTypeId, args.appointmentTypeId))
    .returning({ id: pmsAppointmentTypeLinks.id });

  if (result.length === 0) {
    return { ok: false, detail: "This appointment type isn't linked to a PMS." };
  }
  return { ok: true };
}

/**
 * Pull ALL appointment types from the connection's PMS and make sure each one
 * exists as a Coviu appointment_type + a connection-scoped link, so the
 * Workflows view can attach pre-appointment workflows to every real type.
 *
 * Types are imported UNCONFIRMED (modality stays the schema default; the link's
 * confirmed_modality / room / sync_enabled are left untouched). A type only
 * reaches the run sheet once confirmed in Settings → Integrations (§5). This
 * is the "refresh appointment types" action behind the Workflows button.
 */
export async function importAppointmentTypes(
  connection: PmsConnectionRow
): Promise<{ ok: boolean; imported: number; total: number; detail?: string }> {
  const adapter = adapterForConnection(connection);
  if (!adapter) return { ok: false, imported: 0, total: 0, detail: "Connection is not sync-active." };
  const orgId = await orgForLocation(connection.locationId);
  if (!orgId) return { ok: false, imported: 0, total: 0, detail: "Location has no org." };

  let pmsTypes;
  try {
    pmsTypes = await adapter.listAppointmentTypes();
  } catch (e) {
    return { ok: false, imported: 0, total: 0, detail: (e as Error).message };
  }

  // Existing links for this connection → skip re-creating the Coviu type.
  const existingLinks = await db
    .select({
      pmsExternalId: pmsAppointmentTypeLinks.pmsExternalId,
      appointmentTypeId: pmsAppointmentTypeLinks.appointmentTypeId,
    })
    .from(pmsAppointmentTypeLinks)
    .where(eq(pmsAppointmentTypeLinks.connectionId, connection.id));
  const linkedExternalIds = new Set(existingLinks.map((l) => l.pmsExternalId));

  let imported = 0;
  for (const t of pmsTypes) {
    if (t.archived) continue;
    if (linkedExternalIds.has(t.externalId)) continue;

    // Create the org-scoped Coviu type. Insert as in_person so an unconfirmed
    // import never silently becomes telehealth (§5); real modality is confirmed
    // on the link in Settings.
    const [created] = await db
      .insert(appointmentTypes)
      .values({
        orgId,
        name: t.name,
        modality: "in_person",
        durationMinutes: t.durationMinutes ?? 30,
        source: "pms",
        pmsProvider: connection.provider as "cliniko",
      })
      .returning({ id: appointmentTypes.id });

    await db.insert(pmsAppointmentTypeLinks).values({
      connectionId: connection.id,
      appointmentTypeId: created.id,
      pmsExternalId: t.externalId,
      // confirmed_modality NULL, sync_enabled false until confirmed.
    });
    imported++;
  }

  return { ok: true, imported, total: pmsTypes.length };
}

/** Map a PMS practitioner (appointment-book column) → a Coviu room (§025). */
export async function savePractitionerMapping(args: {
  connectionId: string;
  externalId: string;
  roomId: string | null;
}): Promise<void> {
  if (!args.roomId) {
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
      roomId: args.roomId,
      pmsExternalId: args.externalId,
    })
    .onConflictDoUpdate({
      target: [
        pmsPractitionerLinks.connectionId,
        pmsPractitionerLinks.pmsExternalId,
      ],
      set: { roomId: args.roomId },
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
