"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useLocation } from "@/hooks/useLocation";
import { usePmsConnection } from "@/hooks/usePmsConnection";
import type { IntegrationStatusDTO, MappingDataDTO } from "./types";
import { ConnectForm } from "./connect-form";
import { PractitionerMappings } from "./practitioner-mappings";
import { BusinessMappings } from "./business-mappings";

export function IntegrationsSettingsShell() {
  const { selectedLocation } = useLocation();
  const locationId = selectedLocation?.id ?? null;
  // This management page keeps its own detailed fetch, but pushes changes to the
  // shared context so the rest of the app updates without re-polling.
  const { refresh: refreshPmsContext } = usePmsConnection();

  const [status, setStatus] = useState<IntegrationStatusDTO | null>(null);
  const [mappings, setMappings] = useState<MappingDataDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [mappingError, setMappingError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  // Imperative reloads (after sync/connect/disconnect/save) — safe to call
  // outside effects from event handlers.
  const loadStatus = useCallback(async () => {
    if (!locationId) return;
    const res = await fetch(`/api/pms/connection?locationId=${locationId}`);
    const data = res.ok ? ((await res.json()) as IntegrationStatusDTO) : null;
    setStatus(data);
    setLoading(false);
    // Keep the shared context in sync after connect/disconnect/subdomain edits.
    refreshPmsContext();
  }, [locationId, refreshPmsContext]);

  const loadMappings = useCallback(async () => {
    if (!locationId) return;
    const res = await fetch(`/api/pms/mappings?locationId=${locationId}`);
    if (res.ok) {
      setMappings((await res.json()) as MappingDataDTO);
      setMappingError(null);
    } else {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      setMappingError(err.error ?? "Couldn't load mappings from the PMS.");
      setMappings(null);
    }
  }, [locationId]);

  // Fetch status on mount / location change. The async work + setState live
  // inside the promise continuation (not a synchronous effect-body call), with
  // a cancellation guard so a stale location switch can't clobber newer state.
  useEffect(() => {
    let cancelled = false;
    if (!locationId) return;
    (async () => {
      const res = await fetch(`/api/pms/connection?locationId=${locationId}`);
      const data = res.ok ? ((await res.json()) as IntegrationStatusDTO) : null;
      if (cancelled) return;
      setStatus(data);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [locationId]);

  useEffect(() => {
    let cancelled = false;
    if (!status?.syncActive) return;
    (async () => {
      const res = await fetch(`/api/pms/mappings?locationId=${locationId}`);
      if (cancelled) return;
      if (res.ok) {
        setMappings((await res.json()) as MappingDataDTO);
        setMappingError(null);
      } else {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        if (cancelled) return;
        setMappingError(err.error ?? "Couldn't load mappings from the PMS.");
        setMappings(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [status?.syncActive, locationId]);

  const handleSyncNow = useCallback(async () => {
    if (!locationId) return;
    setSyncing(true);
    setSyncMessage(null);
    const res = await fetch("/api/pms/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ locationId }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      appointmentsUpserted?: number;
      sessionsScheduled?: number;
      skippedNonTelehealth?: number;
      error?: string;
    };
    if (res.ok && data.ok) {
      setSyncMessage(
        `Synced. ${data.appointmentsUpserted ?? 0} appointment(s) updated, ${data.sessionsScheduled ?? 0} scheduled to the run sheet, ${data.skippedNonTelehealth ?? 0} skipped.`
      );
    } else {
      setSyncMessage(data.error ?? "Sync failed.");
    }
    setSyncing(false);
    void loadStatus();
  }, [locationId, loadStatus]);

  const handleDisconnect = useCallback(async () => {
    if (!locationId) return;
    if (!confirm("Disconnect this PMS? Mappings are kept; syncing stops.")) return;
    await fetch(`/api/pms/connection?locationId=${locationId}`, {
      method: "DELETE",
    });
    void loadStatus();
  }, [locationId, loadStatus]);

  if (!locationId) {
    return (
      <div className="p-6">
        <Header />
        <p className="text-sm text-gray-500 mt-4">
          Select a location to manage its integration.
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="p-6">
        <Header />
        <p className="text-sm text-gray-500 mt-4">Loading…</p>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-3xl">
      <Header />

      {!status?.syncActive ? (
        <div className="mt-6">
          <ConnectForm
            locationId={locationId}
            provider={status?.provider ?? null}
            providerLabel={status?.providerLabel ?? null}
            credentialFields={status?.credentialFields ?? []}
            onConnected={loadStatus}
          />
        </div>
      ) : (
        <>
          {/* Connection status card */}
          <div className="mt-6 rounded-xl border border-gray-200 bg-white p-5">
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-semibold text-gray-800">
                    {status.providerLabel}
                  </h2>
                  <Badge variant="teal">Connected</Badge>
                </div>
                <p className="text-sm text-gray-500 mt-1">
                  {status.lastSyncedAt
                    ? `Last synced ${new Date(status.lastSyncedAt).toLocaleString()}`
                    : "Not synced yet"}
                </p>
                {status.lastSyncError && (
                  <p className="text-sm text-red-500 mt-1">
                    Last sync error: {status.lastSyncError}
                  </p>
                )}
              </div>
              <div className="flex gap-2">
                <Button onClick={handleSyncNow} disabled={syncing}>
                  {syncing ? "Syncing…" : "Sync now"}
                </Button>
                <Button variant="secondary" onClick={handleDisconnect}>
                  Disconnect
                </Button>
              </div>
            </div>
            {syncMessage && (
              <p className="text-sm text-gray-600 mt-3">{syncMessage}</p>
            )}

            {/* Account subdomain — used to build "Open in {PMS}" patient links.
                Auto-detected on connect; editable here if it's wrong/missing. */}
            <div className="mt-4 border-t border-gray-100 pt-3">
              <SubdomainEditor
                locationId={locationId}
                provider={status.providerLabel ?? "PMS"}
                initial={status.accountSubdomain}
                onSaved={loadStatus}
              />
            </div>
          </div>

          {mappingError && (
            <p className="text-sm text-red-500 mt-4">{mappingError}</p>
          )}

          {mappings && (
            <div className="mt-6 space-y-8">
              <BusinessMappings
                locationId={locationId}
                data={mappings}
                onSaved={loadMappings}
              />
              <PractitionerMappings
                locationId={locationId}
                data={mappings}
                onSaved={loadMappings}
              />
              <p className="text-xs text-gray-400">
                Appointment types and their pre-appointment workflows are managed
                in the Workflows section.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Header() {
  return (
    <>
      <h1 className="text-2xl font-semibold text-gray-800">Integrations</h1>
      <p className="text-sm text-gray-500 mt-1">
        Connect your practice management system and map its data to Coviu.
      </p>
    </>
  );
}

function SubdomainEditor({
  locationId,
  provider,
  initial,
  onSaved,
}: {
  locationId: string;
  provider: string;
  initial: string | null;
  onSaved: () => void;
}) {
  const [value, setValue] = useState(initial ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const save = async () => {
    setSaving(true);
    setSaved(false);
    await fetch("/api/pms/connection", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ locationId, accountSubdomain: value.trim() || null }),
    });
    setSaving(false);
    setSaved(true);
    onSaved();
  };

  return (
    <div>
      <label className="block text-xs font-medium text-gray-800 mb-1">
        {provider} account subdomain
      </label>
      <p className="text-xs text-gray-500 mb-2">
        Used for &ldquo;Open in {provider}&rdquo; patient links. It&apos;s the
        first part of your {provider} web address — e.g. for{" "}
        <code>coviu-test.au5.cliniko.com</code> the subdomain is{" "}
        <code>coviu-test</code>.
      </p>
      <div className="flex items-center gap-2">
        <input
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setSaved(false);
          }}
          placeholder="coviu-test"
          className="w-48 rounded-lg border border-gray-200 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
        />
        <Button
          variant="secondary"
          onClick={save}
          disabled={saving || value.trim() === (initial ?? "")}
        >
          {saving ? "Saving…" : "Save"}
        </Button>
        {saved && <span className="text-xs text-green-600">Saved</span>}
      </div>
    </div>
  );
}
