"use client";

import { Button } from "@/components/ui/button";

interface ChangeSummary {
  added: number;
  removed: number;
  retimed: number;
}

interface MidFlightWarningModalProps {
  open: boolean;
  inFlightCount: number;
  changeSummary: ChangeSummary;
  onConfirm: () => void;
  onCancel: () => void;
}

export function MidFlightWarningModal({
  open,
  inFlightCount,
  changeSummary,
  onConfirm,
  onCancel,
}: MidFlightWarningModalProps) {
  if (!open) return null;

  const changes: string[] = [];
  if (changeSummary.added > 0)
    changes.push(`${changeSummary.added} action${changeSummary.added > 1 ? "s" : ""} added`);
  if (changeSummary.removed > 0)
    changes.push(`${changeSummary.removed} action${changeSummary.removed > 1 ? "s" : ""} removed`);
  if (changeSummary.retimed > 0)
    changes.push(`${changeSummary.retimed} action${changeSummary.retimed > 1 ? "s" : ""} retimed`);

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/20"
        onClick={onCancel}
      />

      {/* Modal */}
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
        role="dialog"
        aria-modal="true"
        aria-labelledby="mid-flight-title"
      >
        <div className="w-full max-w-md rounded-xl border border-gray-200 bg-white shadow-xl">
          <div className="px-6 py-5">
            <h2
              id="mid-flight-title"
              className="text-lg font-semibold text-gray-800"
            >
              Update workflow?
            </h2>
            <div className="mt-3 space-y-2 text-sm text-gray-600">
              <p>
                {inFlightCount} patient{inFlightCount !== 1 ? "s are" : " is"}{" "}
                currently in this workflow.
              </p>
              {changes.length > 0 && (
                <ul className="list-disc pl-5 space-y-0.5">
                  {changes.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              )}
              <p className="text-gray-400">
                These changes will apply to in-flight appointments for any
                actions that haven&apos;t yet fired. Actions that have already
                fired will not be re-fired or undone.
              </p>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-gray-100 px-6 py-4">
            <Button variant="secondary" size="sm" onClick={onCancel}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" onClick={onConfirm}>
              Update workflow
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
