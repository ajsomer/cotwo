"use client";

import dynamic from "next/dynamic";

const FormBuilderShell = dynamic(
  () =>
    import("./form-builder-shell").then((m) => ({
      default: m.FormBuilderShell,
    })),
  {
    ssr: false,
    loading: () => (
      <div className="p-6">
        <div className="mb-6 h-10 w-64 animate-pulse rounded-lg bg-gray-200" />
        <div className="h-[600px] animate-pulse rounded-xl border border-gray-200 bg-white" />
      </div>
    ),
  }
);

interface FormBuilderWrapperProps {
  formId: string;
}

export function FormBuilderWrapper({ formId }: FormBuilderWrapperProps) {
  return <FormBuilderShell formId={formId} />;
}
