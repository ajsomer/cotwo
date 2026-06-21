"use client";

import { useState, useCallback } from "react";
import type { RunsheetView } from "@/components/clinic/runsheet/runsheet-view-toggle";

const STORAGE_KEY = "coviu:runsheet-view";
const DEFAULT_VIEW: RunsheetView = "provider";
const VALID: RunsheetView[] = ["provider", "list", "calendar"];

// Day/Week is a sub-mode within the Calendar view, persisted separately so
// switching away from and back to Calendar restores the last grain.
export type CalendarMode = "day" | "week";
const CAL_MODE_KEY = "coviu:runsheet-calendar-mode";
const DEFAULT_CAL_MODE: CalendarMode = "day";
const VALID_CAL_MODES: CalendarMode[] = ["day", "week"];

function readStored<T extends string>(
  key: string,
  valid: T[],
  fallback: T
): T {
  if (typeof window === "undefined") return fallback;
  try {
    const stored = window.localStorage.getItem(key);
    if (stored && valid.includes(stored as T)) return stored as T;
  } catch {
    // localStorage unavailable (private mode) — stick with default.
  }
  return fallback;
}

/**
 * Persists the run sheet view mode (Group by provider / Appointment list /
 * Calendar) in localStorage so the choice sticks across sessions. The shell is
 * a client component rendered after auth, so reading storage in the lazy
 * initializer is safe.
 */
export function useRunsheetView(): [RunsheetView, (view: RunsheetView) => void] {
  const [view, setView] = useState<RunsheetView>(() =>
    readStored(STORAGE_KEY, VALID, DEFAULT_VIEW)
  );

  const update = useCallback((next: RunsheetView) => {
    setView(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Ignore write failures — view still works in-memory for the session.
    }
  }, []);

  return [view, update];
}

/** Persisted Day/Week grain for the Calendar view. */
export function useCalendarMode(): [CalendarMode, (mode: CalendarMode) => void] {
  const [mode, setMode] = useState<CalendarMode>(() =>
    readStored(CAL_MODE_KEY, VALID_CAL_MODES, DEFAULT_CAL_MODE)
  );

  const update = useCallback((next: CalendarMode) => {
    setMode(next);
    try {
      window.localStorage.setItem(CAL_MODE_KEY, next);
    } catch {
      // Ignore write failures.
    }
  }, []);

  return [mode, update];
}
