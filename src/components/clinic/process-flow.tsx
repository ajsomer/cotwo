"use client";

import { useState } from "react";
import { SlideOver } from "@/components/ui/slide-over";
import { ProcessFlowPayment } from "./process-flow-payment";
import { ProcessFlowOutcome } from "./process-flow-outcome";
import { ProcessFlowDone } from "./process-flow-done";
import { useOrg } from "@/hooks/useOrg";
import type { EnrichedSession } from "@/lib/supabase/types";

interface ProcessFlowProps {
  session: EnrichedSession;
  onComplete: () => void;
  onClose: () => void;
  isBulk: boolean;
  timezone: string;
}

type ProcessStep = "payment" | "outcome" | "done";

export function ProcessFlow({
  session,
  onComplete,
  onClose,
  isBulk,
}: ProcessFlowProps) {
  const { org } = useOrg();
  const isComplete = org?.tier === "complete";
  const [currentStep, setCurrentStep] = useState<ProcessStep>("payment");

  const steps: ProcessStep[] = isComplete
    ? ["payment", "outcome", "done"]
    : ["payment", "done"];

  const stepIndex = steps.indexOf(currentStep);

  function advanceStep() {
    const nextIndex = stepIndex + 1;
    if (nextIndex < steps.length) {
      setCurrentStep(steps[nextIndex]);
    }
  }

  return (
    <SlideOver open={true} onClose={onClose} title="Process session">
      {/* Step indicator */}
      <div className="px-5 py-4 border-b border-gray-200">
        <div className="flex items-center gap-3">
          {steps.map((step, i) => (
            <div key={step} className="flex items-center gap-2">
              <div
                className={`h-6 w-6 rounded-full flex items-center justify-center text-xs font-medium ${
                  i < stepIndex
                    ? "bg-green-500 text-white"
                    : i === stepIndex
                      ? "bg-teal-500 text-white"
                      : "bg-gray-200 text-gray-500"
                }`}
              >
                {i < stepIndex ? (
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  i + 1
                )}
              </div>
              <span
                className={`text-xs font-medium capitalize ${
                  i === stepIndex ? "text-gray-800" : "text-gray-500"
                }`}
              >
                {step}
              </span>
              {i < steps.length - 1 && (
                <div className="w-8 h-px bg-gray-200" />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Step content */}
      {currentStep === "payment" && (
        <ProcessFlowPayment
          session={session}
          onNext={advanceStep}
        />
      )}
      {currentStep === "outcome" && (
        <ProcessFlowOutcome
          session={session}
          onNext={advanceStep}
        />
      )}
      {currentStep === "done" && (
        <ProcessFlowDone
          session={session}
          onComplete={onComplete}
          onClose={onClose}
          isBulk={isBulk}
        />
      )}
    </SlideOver>
  );
}
