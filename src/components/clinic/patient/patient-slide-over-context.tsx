"use client";

import { createContext, useContext, type ReactNode } from "react";

interface PatientSlideOverContextValue {
  openPatient: (patientId: string) => void;
}

const PatientSlideOverContext = createContext<PatientSlideOverContextValue>({
  openPatient: () => {},
});

export function usePatientSlideOver() {
  return useContext(PatientSlideOverContext);
}

interface PatientSlideOverProviderProps {
  children: ReactNode;
  onOpenPatient: (patientId: string) => void;
}

export function PatientSlideOverProvider({
  children,
  onOpenPatient,
}: PatientSlideOverProviderProps) {
  return (
    <PatientSlideOverContext value={{ openPatient: onOpenPatient }}>
      {children}
    </PatientSlideOverContext>
  );
}
