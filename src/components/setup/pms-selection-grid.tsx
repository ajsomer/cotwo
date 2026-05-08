"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { CheckCircle2, Loader2, X } from "lucide-react";

type PmsProvider = "cliniko" | "halaxy" | "nookal" | "power_diary" | "gentu";

interface PmsOption {
  id: PmsProvider;
  name: string;
  description: string;
  comingSoon: boolean;
}

const PMS_OPTIONS: PmsOption[] = [
  { id: "gentu", name: "Gentu", description: "Australian allied health PMS", comingSoon: false },
  { id: "cliniko", name: "Cliniko", description: "Practice management software", comingSoon: true },
  { id: "halaxy", name: "Halaxy", description: "Healthcare practice management", comingSoon: true },
  { id: "nookal", name: "Nookal", description: "Allied health practice software", comingSoon: true },
  { id: "power_diary", name: "Power Diary", description: "Practice management system", comingSoon: true },
];

export function PmsSelectionGrid() {
  const router = useRouter();
  const [connecting, setConnecting] = useState<PmsProvider | null>(null);
  const [connected, setConnected] = useState<PmsProvider | null>(null);
  const [comingSoonModal, setComingSoonModal] = useState<PmsProvider | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSelect(provider: PmsOption) {
    if (provider.comingSoon) {
      setComingSoonModal(provider.id);
      return;
    }

    // Gentu
    setConnecting(provider.id);
    setError(null);

    const res = await fetch("/api/setup/pms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: provider.id, skipped: false }),
    });

    setConnecting(null);

    if (!res.ok) {
      setError("Connection failed. Try again or choose a different PMS.");
      return;
    }

    setConnected(provider.id);
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
    await fetch("/api/setup/pms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: null, skipped: true }),
    });
    window.location.href = "/setup/rooms";
  }

  async function handleContinueWithoutPms() {
    setComingSoonModal(null);
    setSubmitting(true);
    await fetch("/api/setup/pms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: null, skipped: true }),
    });
    window.location.href = "/setup/rooms";
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-gray-800">Connect your PMS</h1>
        <p className="mt-1 text-sm text-gray-500">
          Connecting your practice management system imports your appointment types, forms, and rooms automatically.
        </p>
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}

      <div className="grid grid-cols-1 gap-3">
        {PMS_OPTIONS.map((option) => {
          const isConnecting = connecting === option.id;
          const isConnected = connected === option.id;

          return (
            <button
              key={option.id}
              type="button"
              onClick={() => handleSelect(option)}
              disabled={!!connecting || !!connected || submitting}
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
            Connected to Gentu — appointment types, forms, and rooms imported.
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

      {/* Coming soon modal */}
      {comingSoonModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-xl">
            <div className="flex items-start justify-between mb-3">
              <h2 className="text-base font-semibold text-gray-800">Integration coming soon</h2>
              <button
                type="button"
                onClick={() => setComingSoonModal(null)}
                className="text-gray-400 hover:text-gray-600"
              >
                <X size={18} />
              </button>
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
          </div>
        </div>
      )}
    </div>
  );
}
