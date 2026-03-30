"use client";

import { useEffect, useRef } from "react";
import type { RunsheetSummary } from "@/lib/supabase/types";

/** Alternates the browser tab title when attention states exist. */
export function useTabNotifications(summary: RunsheetSummary) {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const originalTitle = useRef("Coviu");

  useEffect(() => {
    // Check reduced motion preference
    const prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;

    const attentionCount = summary.late + summary.waiting;

    if (attentionCount > 0 && !prefersReducedMotion) {
      let showAlert = true;

      const alertText =
        summary.late > 0
          ? `(!) ${summary.late} Late`
          : `(${summary.waiting}) Waiting`;

      intervalRef.current = setInterval(() => {
        document.title = showAlert ? alertText : originalTitle.current;
        showAlert = !showAlert;
      }, 2000);
    } else {
      document.title = originalTitle.current;
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
      document.title = originalTitle.current;
    };
  }, [summary.late, summary.waiting]);
}
