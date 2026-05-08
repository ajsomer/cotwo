"use client";

import { useEffect } from "react";
import { useClinicStore } from "@/stores/clinic-store";
import type { OnboardingState } from "@/stores/clinic-store";

interface OnboardingHydratorProps {
  state: OnboardingState;
}

export function OnboardingHydrator({ state }: OnboardingHydratorProps) {
  useEffect(() => {
    useClinicStore.getState().setOnboarding(state);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}
