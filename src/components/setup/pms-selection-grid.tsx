"use client";

import { useEffect, useState } from "react";
import { getJson, postJson } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { CloseButton } from "@/components/ui/close-button";
import { CheckCircle2, Loader2 } from "lucide-react";
import { TextInput } from "@/components/ui/input";

type PmsProvider = "cliniko" | "halaxy" | "nookal" | "power_diary" | "gentu";

interface PmsOption {
  id: PmsProvider;
  name: string;
  description: string;
  comingSoon: boolean;
}

const PMS_OPTIONS: PmsOption[] = [
  { id: "cliniko", name: "Cliniko", description: "Practice management software", comingSoon: false },
  { id: "nookal", name: "Nookal", description: "Allied health practice software", comingSoon: false },
  { id: "gentu", name: "Gentu", description: "Australian specialist & allied health PMS", comingSoon: false },
  { id: "halaxy", name: "Halaxy", description: "Healthcare practice management", comingSoon: true },
  { id: "power_diary", name: "Power Diary", description: "Practice management system", comingSoon: true },
];

/** Connect metadata for one registry-backed provider (from /api/pms/providers). */
interface ProviderConnectMeta {
  provider: string;
  label: string;
  credentialFields: Array<{
    key: string;
    label: string;
    inputType: "text" | "password";
    placeholder?: string;
    helpText?: string;
  }>;
}

export function PmsSelectionGrid() {
  const [connecting, setConnecting] = useState<PmsProvider | null>(null);
  const [connected, setConnected] = useState<PmsProvider | null>(null);
  const [comingSoonModal, setComingSoonModal] = useState<PmsProvider | null>(null);
  /** Which registry-backed provider's connect modal is open. */
  const [connectModal, setConnectModal] = useState<ProviderConnectMeta | null>(null);
  const [credentialValues, setCredentialValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Providers with a real adapter (and their credential fields). The registry
  // is server-only, so this comes from /api/pms/providers. A tile is
  // connectable-with-credentials when its id appears here.
  const [providerMeta, setProviderMeta] = useState<ProviderConnectMeta[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = await getJson<{ providers?: ProviderConnectMeta[] }>(
        "/api/pms/providers"
      );
      if (!cancelled) {
        setProviderMeta(result.ok ? (result.data?.providers ?? []) : []);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSelect(provider: PmsOption) {
    if (provider.comingSoon) {
      setComingSoonModal(provider.id);
      return;
    }

    // Real credential connect — EVERY registry-backed provider (including
    // Gentu, which used to have a demo-simulation branch here; plan §1a.1) opens
    // the credential modal driven by /api/pms/providers metadata. If the
    // metadata fetch failed, error out rather than connecting blind.
    const meta = providerMeta?.find((p) => p.provider === provider.id);
    if (meta) {
      setError(null);
      setCredentialValues({});
      setConnectModal(meta);
    } else {
      setError(
        `Couldn't load ${provider.name} connection details — refresh and try again.`
      );
    }
  }

  async function handleConnectCredentials() {
    if (!connectModal) return;
    const provider = connectModal.provider as PmsProvider;
    setConnecting(provider);
    setError(null);
    const credentials = Object.fromEntries(
      connectModal.credentialFields.map((f) => [
        f.key,
        (credentialValues[f.key] ?? "").trim(),
      ])
    );
    const res = await fetch("/api/setup/pms/connect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider, credentials }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      detail?: string;
      error?: string;
    };
    setConnecting(null);
    if (res.ok && data.ok) {
      setConnectModal(null);
      setConnected(provider);
    } else {
      setError(
        data.detail ??
          data.error ??
          `Couldn't connect to ${connectModal.label}.`
      );
    }
  }

  async function handleContinue() {
    setSubmitting(true);
    // Hard navigation so the server can re-evaluate setup state and route us
    // through the rest of the chain (rooms → payments → runsheet) without
    // getting trapped in client-side routing.
    window.location.href = "/setup/rooms";
  }

  async function handleSkip() {
    setSubmitting(true);
    await postJson("/api/setup/pms", { provider: null, skipped: true });
    window.location.href = "/setup/rooms";
  }

  async function handleContinueWithoutPms() {
    setComingSoonModal(null);
    setSubmitting(true);
    await postJson("/api/setup/pms", { provider: null, skipped: true });
    window.location.href = "/setup/rooms";
  }

  const connectedMeta = providerMeta?.find((p) => p.provider === connected);
  const missingCredentials =
    !connectModal ||
    connectModal.credentialFields.some(
      (f) => !(credentialValues[f.key] ?? "").trim()
    );

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-gray-800">Connect your PMS</h1>
        <p className="mt-1 text-sm text-gray-500">
          Connecting your practice management system imports your appointment types, forms, and rooms automatically.
        </p>
      </div>

      {error && !connectModal && <p className="text-sm text-red-500">{error}</p>}

      <div className="grid grid-cols-1 gap-3">
        {PMS_OPTIONS.map((option) => {
          const isConnecting = connecting === option.id;
          const isConnected = connected === option.id;

          return (
            <button
              key={option.id}
              type="button"
              onClick={() => handleSelect(option)}
              disabled={!!connecting || !!connected || submitting || providerMeta === null}
              className={`flex items-center justify-between w-full px-4 py-3 rounded-xl border text-left transition-colors ${
                isConnected
                  ? "border-green-500 bg-green-50"
                  : option.comingSoon
                  ? "border-gray-200 bg-gray-50 opacity-60"
                  : "border-gray-200 bg-white hover:border-teal-500 hover:bg-teal-50"
              } disabled:cursor-not-allowed`}
            >
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-gray-800">{option.name}</span>
                  {option.comingSoon && (
                    <span className="text-xs font-medium text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">
                      Coming soon
                    </span>
                  )}
                </div>
                <p className="text-xs text-gray-500 mt-0.5">{option.description}</p>
              </div>
              <div className="ml-3 flex-shrink-0">
                {isConnecting && <Loader2 size={18} className="text-teal-500 animate-spin" />}
                {isConnected && <CheckCircle2 size={18} className="text-green-500" />}
              </div>
            </button>
          );
        })}
      </div>

      {connected ? (
        <div className="space-y-3">
          <p className="text-sm text-green-700 font-medium">
            {connectedMeta
              ? `Connected to ${connectedMeta.label}. Next, confirm your appointment types and rooms in Settings → Integrations.`
              : "Connected. Next, confirm your appointment types and rooms in Settings → Integrations."}
          </p>
          <Button
            type="button"
            variant="primary"
            className="w-full"
            onClick={handleContinue}
            disabled={submitting}
          >
            {submitting ? "Continuing..." : "Continue"}
          </Button>
        </div>
      ) : (
        <button
          type="button"
          onClick={handleSkip}
          disabled={!!connecting || submitting}
          className="w-full text-sm text-gray-500 hover:text-gray-700 transition-colors disabled:opacity-50"
        >
          Skip for now
        </button>
      )}

      {/* Credential connect modal (registry-backed providers) */}
      {connectModal && (
        <Modal
          open
          onClose={() => setConnectModal(null)}
          aria-label={`Connect ${connectModal.label}`}
          panelClassName="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl"
          backdropClassName="bg-black/40"
        >
            <div className="flex items-start justify-between mb-3">
              <h2 className="text-base font-semibold text-gray-800">
                Connect {connectModal.label}
              </h2>
              <CloseButton
                onClick={() => setConnectModal(null)}
                className="text-gray-400 hover:text-gray-600"
                iconClassName="h-[18px] w-[18px]"
              />
            </div>
            <p className="text-sm text-gray-500 mb-3">
              Enter your {connectModal.label} credentials. We verify them before
              saving and store them encrypted.
            </p>
            <div className="space-y-3">
              {connectModal.credentialFields.map((f) => (
                <div key={f.key}>
                  <label className="block text-xs font-medium text-gray-800 mb-1">
                    {f.label}
                  </label>
                  <TextInput
                    type={f.inputType}
                    placeholder={f.placeholder}
                    value={credentialValues[f.key] ?? ""}
                    onChange={(e) =>
                      setCredentialValues((v) => ({ ...v, [f.key]: e.target.value }))
                    }
                  />
                  {f.helpText && (
                    <p className="text-xs text-gray-500 mt-1">{f.helpText}</p>
                  )}
                </div>
              ))}
            </div>
            {error && <p className="text-sm text-red-500 mt-2">{error}</p>}
            <div className="flex gap-3 mt-5">
              <Button
                type="button"
                variant="secondary"
                className="flex-1"
                onClick={() => setConnectModal(null)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="primary"
                className="flex-1"
                onClick={handleConnectCredentials}
                disabled={connecting === connectModal.provider || missingCredentials}
              >
                {connecting === connectModal.provider ? "Verifying…" : "Connect"}
              </Button>
            </div>
        </Modal>
      )}

      {/* Coming soon modal */}
      {comingSoonModal && (
        <Modal
          open
          onClose={() => setComingSoonModal(null)}
          aria-label="Integration coming soon"
          panelClassName="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl"
          backdropClassName="bg-black/40"
        >
            <div className="flex items-start justify-between mb-3">
              <h2 className="text-base font-semibold text-gray-800">Integration coming soon</h2>
              <CloseButton
                onClick={() => setComingSoonModal(null)}
                className="text-gray-400 hover:text-gray-600"
                iconClassName="h-[18px] w-[18px]"
              />
            </div>
            <p className="text-sm text-gray-500 mb-5">
              This integration is coming soon. We&apos;ll let you know when it&apos;s ready. You can continue setting up your clinic and connect your PMS later in Settings.
            </p>
            <div className="flex gap-3">
              <Button
                type="button"
                variant="secondary"
                className="flex-1"
                onClick={() => setComingSoonModal(null)}
              >
                Choose a different PMS
              </Button>
              <Button
                type="button"
                variant="primary"
                className="flex-1"
                onClick={handleContinueWithoutPms}
              >
                Continue without PMS
              </Button>
            </div>
        </Modal>
      )}
    </div>
  );
}
