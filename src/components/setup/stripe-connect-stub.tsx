"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { CheckCircle2, Loader2 } from "lucide-react";

export function StripeConnectStub() {
  const [status, setStatus] = useState<"idle" | "connecting" | "connected">("idle");
  const [accountRef, setAccountRef] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [skipping, setSkipping] = useState(false);

  async function handleConnect() {
    setStatus("connecting");
    setError(null);

    const res = await fetch("/api/setup/payments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ skipped: false }),
    });

    if (!res.ok) {
      setStatus("idle");
      setError("Connection failed. Try again or skip.");
      return;
    }

    const data = await res.json();
    setAccountRef(data.stripe_account_id);
    setStatus("connected");
  }

  async function handleContinue() {
    window.location.href = "/runsheet";
  }

  async function handleSkip() {
    setSkipping(true);
    await fetch("/api/setup/payments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ skipped: true }),
    });
    window.location.href = "/runsheet";
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-gray-800">Accept payments from patients</h1>
        <p className="mt-1 text-sm text-gray-500">
          Connect Stripe to take payments from patients during check-in and after sessions. You can set this up now or skip and configure it later in Settings.
        </p>
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}

      {status === "connected" ? (
        <div className="space-y-4">
          <div className="flex items-center gap-2.5 rounded-xl border border-green-200 bg-green-50 px-4 py-3">
            <CheckCircle2 size={18} className="text-green-500 flex-shrink-0" />
            <div>
              <p className="text-sm font-medium text-green-800">Connected</p>
              <p className="text-xs text-green-700 font-mono mt-0.5">{accountRef}</p>
            </div>
          </div>
          <Button type="button" variant="primary" className="w-full" onClick={handleContinue}>
            Continue
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <Button
            type="button"
            variant="primary"
            className="w-full"
            onClick={handleConnect}
            disabled={status === "connecting" || skipping}
          >
            {status === "connecting" ? (
              <span className="flex items-center gap-2">
                <Loader2 size={16} className="animate-spin" />
                Connecting to Stripe…
              </span>
            ) : (
              "Connect with Stripe"
            )}
          </Button>
          <button
            type="button"
            onClick={handleSkip}
            disabled={status === "connecting" || skipping}
            className="w-full text-sm text-gray-500 hover:text-gray-700 transition-colors disabled:opacity-50"
          >
            Skip for now
          </button>
        </div>
      )}
    </div>
  );
}
