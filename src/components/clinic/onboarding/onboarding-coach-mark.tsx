"use client";

import { postJson } from "@/lib/api-client";
import { useClinicStore } from "@/stores/clinic-store";

export function OnboardingCoachMark() {
  const { stage, testSessionId, coachMarkDismissed, hasSeenPatientJourney } = useClinicStore(
    (s) => s.onboarding
  );
  const onboardingLoaded = useClinicStore((s) => s.onboardingLoaded);
  const setOnboarding = useClinicStore((s) => s.setOnboarding);
  const sessions = useClinicStore((s) => s.sessions);

  function dismissWelcome() {
    setOnboarding({
      coachMarkDismissed: { ...coachMarkDismissed, call_completed: true },
      hasSeenPatientJourney: true,
    });
    void postJson("/api/onboarding/dismiss-welcome");
  }

  if (!onboardingLoaded) return null;
  if (!testSessionId) return null;
  if (stage === "not_started") return null;
  if (stage === "call_completed" && (coachMarkDismissed["call_completed"] || hasSeenPatientJourney)) {
    return null;
  }

  const testSession = sessions.find((s) => s.session_id === testSessionId);

  // Stage 1: SMS sent, session queued — nudge user to tap the SMS on their phone
  if (stage === "test_session_sent" && testSession?.status === "queued") {
    return (
      <div
        role="status"
        aria-live="polite"
        className="mx-4 mb-4 rounded-xl border border-teal-200 bg-teal-50 px-4 py-3 text-sm text-teal-800"
      >
        <span className="font-medium">Your test session is waiting.</span>{" "}
        Tap the SMS on your phone to begin the patient journey.
      </div>
    );
  }

  // Stage 2: Patient in waiting room — pulse the Admit button (signalled via this banner)
  if (stage === "test_session_sent" && testSession?.status === "waiting") {
    return (
      <div
        role="status"
        aria-live="polite"
        className="mx-4 mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"
      >
        <span className="font-medium">Your test patient is ready.</span>{" "}
        Click the <span className="font-medium">Admit</span> button on their session row to start the video call.
      </div>
    );
  }

  // Stage 4: Call completed — welcome message (suppressed once dismissed)
  if (stage === "call_completed" && !coachMarkDismissed["call_completed"] && !hasSeenPatientJourney) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="mx-4 mb-4 flex items-start gap-3 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800"
      >
        <span className="flex-1">
          <span className="font-medium">You just ran your first Coviu call.</span>{" "}
          You&apos;ve seen both sides of the platform. Welcome aboard.
        </span>
        <button
          type="button"
          onClick={dismissWelcome}
          className="flex-shrink-0 text-xs font-medium text-green-700 hover:text-green-900 underline"
        >
          Got it
        </button>
      </div>
    );
  }

  return null;
}
