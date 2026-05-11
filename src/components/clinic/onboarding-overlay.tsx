"use client";

import { useState } from "react";
import { useClinicStore } from "@/stores/clinic-store";
import { Button } from "@/components/ui/button";
import { X, Loader2, ExternalLink } from "lucide-react";

export function OnboardingOverlay() {
  const stage = useClinicStore((s) => s.onboarding.stage);
  const onboardingLoaded = useClinicStore((s) => s.onboardingLoaded);
  const setOnboarding = useClinicStore((s) => s.setOnboarding);
  const [creating, setCreating] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Don't flash the first-run modal before /api/onboarding/state resolves —
  // a completed-onboarding user has stage !== 'not_started' but the default
  // store value is 'not_started' until the fetch lands.
  if (!onboardingLoaded) return null;
  if (stage !== "not_started") return null;

  function dismiss() {
    // Skip onboarding without creating a test session — mark past 'not_started'
    // so it doesn't reappear, but don't advance the full arc.
    setOnboarding({ stage: "test_session_sent", testSessionId: null });
  }

  async function handleStart() {
    setCreating(true);
    setError(null);

    const res = await fetch("/api/onboarding/test-session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });

    if (!res.ok) {
      setCreating(false);
      setError("Something went wrong. Please try again.");
      return;
    }

    const data = await res.json();
    setOnboarding({ stage: "test_session_sent", testSessionId: data.session_id });

    console.log(
      "%c[onboarding] Intake URL:",
      "color: teal; font-weight: bold",
      data.journey_url
    );

    // Open the patient journey in a new tab so the user can experience it side-by-side
    window.open(data.journey_url, "_blank", "noopener,noreferrer");

    setCreating(false);
    setBanner(
      "We've opened a test patient session in a new tab. Walk through it to see what your patients experience, then come back when you're in the waiting room."
    );
  }

  return (
    <>
      {banner && (
        <div className="flex items-start gap-3 bg-teal-500 px-4 py-3 text-sm text-white">
          <span className="flex-1">{banner}</span>
          <button type="button" onClick={() => setBanner(null)} aria-label="Dismiss">
            <X size={16} className="opacity-70 hover:opacity-100" />
          </button>
        </div>
      )}

      <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 px-4">
        <div className="relative w-full max-w-sm bg-white rounded-2xl p-8 shadow-xl">
          <button
            type="button"
            onClick={dismiss}
            aria-label="Close"
            className="absolute top-4 right-4 text-gray-400 hover:text-gray-600"
          >
            <X size={18} />
          </button>
          <h2 className="text-xl font-semibold text-gray-800 mb-2">
            Your clinic is ready.
          </h2>
          <p className="text-sm text-gray-500 mb-6">
            Let&apos;s create your first session so you can see what patients
            experience. We&apos;ll open the patient flow in a new tab so you
            can walk through it yourself — and then we&apos;ll start a real
            Coviu video call.
          </p>
          {error && (
            <p className="mb-3 text-xs text-red-500">{error}</p>
          )}
          <Button
            type="button"
            variant="primary"
            className="w-full"
            onClick={handleStart}
            disabled={creating}
          >
            {creating ? (
              <span className="flex items-center justify-center gap-2">
                <Loader2 size={16} className="animate-spin" />
                Creating session…
              </span>
            ) : (
              <span className="flex items-center justify-center gap-2">
                Open test session in new tab
                <ExternalLink size={14} />
              </span>
            )}
          </Button>
        </div>
      </div>
    </>
  );
}
