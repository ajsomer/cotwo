"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * Context for opening the patient slide-over from anywhere in the run sheet
 * subtree (patient name links, and the telephony call-pop).
 *
 *  - openPatient(patientId)      → open a known patient's card
 *  - openUnknownCaller(number)   → open the generic "unknown caller" panel
 *  - closePatient()              → close whatever is open (call-ended)
 *
 * `openUnknownCaller`/`closePatient` are optional on the value so existing
 * consumers that only need `openPatient` are unaffected; the run-sheet shell
 * wires all three.
 */
interface PatientSlideOverContextValue {
  openPatient: (patientId: string) => void;
  openUnknownCaller: (number: string) => void;
  closePatient: () => void;
}

const PatientSlideOverContext = createContext<PatientSlideOverContextValue>({
  openPatient: () => {},
  openUnknownCaller: () => {},
  closePatient: () => {},
});

export function usePatientSlideOver() {
  return useContext(PatientSlideOverContext);
}

interface PatientSlideOverProviderProps {
  children: ReactNode;
  onOpenPatient: (patientId: string) => void;
  onOpenUnknownCaller?: (number: string) => void;
  onClose?: () => void;
}

export function PatientSlideOverProvider({
  children,
  onOpenPatient,
  onOpenUnknownCaller,
  onClose,
}: PatientSlideOverProviderProps) {
  return (
    <PatientSlideOverContext
      value={{
        openPatient: onOpenPatient,
        openUnknownCaller: onOpenUnknownCaller ?? (() => {}),
        closePatient: onClose ?? (() => {}),
      }}
    >
      {children}
    </PatientSlideOverContext>
  );
}
