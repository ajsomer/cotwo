"use client";

import { useState, useCallback } from "react";
import type { ReadinessView } from "@/components/clinic/readiness/readiness-view-toggle";

const STORAGE_KEY = "coviu:tasks-view";
const DEFAULT_VIEW: ReadinessView = "status";

const VALID: ReadinessView[] = ["status", "list", "kanban"];

function readStoredView(): ReadinessView {
  if (typeof window === "undefined") return DEFAULT_VIEW;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored && VALID.includes(stored as ReadinessView)) {
      return stored as ReadinessView;
    }
  } catch {
    // localStorage unavailable (private mode) — stick with default.
  }
  return DEFAULT_VIEW;
}

/**
 * Persists the tasks dashboard view mode (Group by status / Task list /
 * Kanban) in localStorage so the choice sticks across sessions. The shell is
 * a client component rendered after auth, so reading storage in the lazy
 * initializer is safe (no SSR/client hydration text to mismatch).
 */
export function useReadinessView(): [ReadinessView, (view: ReadinessView) => void] {
  const [view, setView] = useState<ReadinessView>(readStoredView);

  const update = useCallback((next: ReadinessView) => {
    setView(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Ignore write failures — view still works in-memory for the session.
    }
  }, []);

  return [view, update];
}
