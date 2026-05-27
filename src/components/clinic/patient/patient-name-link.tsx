"use client";

import { usePatientSlideOver } from "./patient-slide-over-context";
import type { ReactNode } from "react";

interface PatientNameLinkProps {
  patientId: string;
  children: ReactNode;
  className?: string;
}

export function PatientNameLink({
  patientId,
  children,
  className = "",
}: PatientNameLinkProps) {
  const { openPatient } = usePatientSlideOver();

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        openPatient(patientId);
      }}
      className={`text-left font-semibold text-gray-800 truncate leading-none hover:underline hover:text-teal-600 transition-colors ${className}`}
    >
      {children}
    </button>
  );
}
