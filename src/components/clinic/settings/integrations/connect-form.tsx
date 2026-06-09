"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { IntegrationStatusDTO } from "./types";

interface ConnectFormProps {
  locationId: string;
  credentialFields: IntegrationStatusDTO["credentialFields"];
  onConnected: () => void;
}

/**
 * Provider-agnostic connect form. Renders whatever credential fields the active
 * adapter declares. Cliniko's default provider is used if none configured yet.
 */
export function ConnectForm({
  locationId,
  credentialFields,
  onConnected,
}: ConnectFormProps) {
  const fields =
    credentialFields.length > 0
      ? credentialFields
      : [
          {
            key: "api_key",
            label: "Cliniko API key",
            inputType: "password" as const,
            placeholder: "…-au1",
            helpText: "Cliniko → My Info → Manage API keys.",
          },
        ];

  const [values, setValues] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConnect = async () => {
    setSubmitting(true);
    setError(null);
    const res = await fetch("/api/pms/connection", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        locationId,
        provider: "cliniko",
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
      <h2 className="text-base font-semibold text-gray-800">Connect Cliniko</h2>
      <p className="text-sm text-gray-500 mt-1">
        Paste your Cliniko API key. We verify it before saving and store it
        encrypted. The region is read from the key — no extra config.
      </p>
      <div className="mt-4 space-y-4">
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
