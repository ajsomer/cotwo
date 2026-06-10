"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import type { IntegrationStatusDTO } from "./types";

/** Connect metadata for one registry-backed provider (from /api/pms/providers). */
interface ProviderConnectMeta {
  provider: string;
  label: string;
  credentialFields: IntegrationStatusDTO["credentialFields"];
}

interface ConnectFormProps {
  locationId: string;
  /** The location's stored provider (may be a credential-less marker). */
  provider: string | null;
  /** Human label, e.g. "Cliniko" / "Nookal". */
  providerLabel: string | null;
  credentialFields: IntegrationStatusDTO["credentialFields"];
  onConnected: () => void;
}

/**
 * Provider-agnostic connect form. Renders whatever credential fields the
 * chosen adapter declares and posts the chosen provider — NEVER a hardcoded
 * one. Because the form only shows when the connection isn't sync-active, it
 * offers a provider picker: clinics that skipped setup land here with a
 * defaulted marker provider and need a way to choose their real PMS.
 */
export function ConnectForm({
  locationId,
  provider,
  providerLabel,
  credentialFields,
  onConnected,
}: ConnectFormProps) {
  // Connectable providers from the server-only registry (via the API).
  const [providerMeta, setProviderMeta] = useState<ProviderConnectMeta[] | null>(
    null
  );
  const [selectedProvider, setSelectedProvider] = useState<string | null>(
    provider
  );

  const [values, setValues] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/pms/providers");
        const data = res.ok
          ? ((await res.json()) as { providers?: ProviderConnectMeta[] })
          : null;
        if (cancelled) return;
        const list = data?.providers ?? [];
        setProviderMeta(list);
        // Default to the stored provider when it's connectable; otherwise (a
        // marker provider with no adapter) fall back to the first real one.
        setSelectedProvider((current) =>
          list.some((p) => p.provider === current)
            ? current
            : list[0]?.provider ?? current
        );
      } catch {
        if (!cancelled) setProviderMeta([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedMeta =
    providerMeta?.find((p) => p.provider === selectedProvider) ?? null;
  // Fetched metadata wins; the DTO's fields/label cover the stored provider
  // while the fetch is in flight.
  const fields =
    selectedMeta?.credentialFields ??
    (selectedProvider === provider ? credentialFields : []);
  const label =
    selectedMeta?.label ??
    (selectedProvider === provider ? providerLabel ?? "your PMS" : "your PMS");

  const handleConnect = async () => {
    if (!selectedProvider) {
      setError("No PMS provider selected for this location.");
      return;
    }
    setSubmitting(true);
    setError(null);
    const res = await fetch("/api/pms/connection", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        locationId,
        provider: selectedProvider,
        credentials: values,
      }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      detail?: string;
      error?: string;
    };
    if (res.ok && data.ok) {
      onConnected();
    } else {
      setError(data.detail ?? data.error ?? "Couldn't connect. Check the key.");
    }
    setSubmitting(false);
  };

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      <h2 className="text-base font-semibold text-gray-800">
        Connect {label}
      </h2>
      <p className="text-sm text-gray-500 mt-1">
        Enter your {label} credentials. We verify them before saving and store
        them encrypted.
      </p>
      <div className="mt-4 space-y-4">
        {providerMeta && providerMeta.length > 0 && (
          <div>
            <label className="block text-xs font-medium text-gray-800 mb-1">
              Practice management system
            </label>
            <select
              value={selectedProvider ?? ""}
              onChange={(e) => {
                setSelectedProvider(e.target.value);
                setValues({});
                setError(null);
              }}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
            >
              {providerMeta.map((p) => (
                <option key={p.provider} value={p.provider}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
        )}
        {fields.map((f) => (
          <div key={f.key}>
            <label className="block text-xs font-medium text-gray-800 mb-1">
              {f.label}
            </label>
            <input
              type={f.inputType}
              placeholder={f.placeholder}
              value={values[f.key] ?? ""}
              onChange={(e) =>
                setValues((v) => ({ ...v, [f.key]: e.target.value }))
              }
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
            {f.helpText && (
              <p className="text-xs text-gray-500 mt-1">{f.helpText}</p>
            )}
          </div>
        ))}
      </div>
      {error && <p className="text-sm text-red-500 mt-3">{error}</p>}
      <div className="mt-4">
        <Button onClick={handleConnect} disabled={submitting}>
          {submitting ? "Verifying…" : "Connect"}
        </Button>
      </div>
    </div>
  );
}
