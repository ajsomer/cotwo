"use client";

import { useEffect, useRef, type ReactNode } from "react";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  /** Accessible name for the dialog. */
  "aria-label": string;
  /** Panel chrome. Override where an existing modal has its own look. */
  panelClassName?: string;
  backdropClassName?: string;
  children: ReactNode;
}

/**
 * Centred dialog with the same Escape + focus behaviour as SlideOver:
 * the panel takes focus on open, Escape and backdrop clicks close.
 */
export function Modal({
  open,
  onClose,
  "aria-label": ariaLabel,
  panelClassName = "w-full max-w-md rounded-xl border border-gray-200 bg-white shadow-xl",
  backdropClassName = "bg-black/20",
  children,
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  // Focus trap: focus panel on open — unless something inside it already
  // claimed focus (e.g. an autoFocus input).
  useEffect(() => {
    if (open && !panelRef.current?.contains(document.activeElement)) {
      panelRef.current?.focus();
    }
  }, [open]);

  // Close on Escape
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    if (open) {
      document.addEventListener("keydown", handleKeyDown);
      return () => document.removeEventListener("keydown", handleKeyDown);
    }
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 z-40 ${backdropClassName}`}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Centring layer — pointer-events pass through to the backdrop */}
      <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-label={ariaLabel}
          tabIndex={-1}
          className={`pointer-events-auto ${panelClassName}`}
        >
          {children}
        </div>
      </div>
    </>
  );
}

interface ConfirmModalProps {
  open: boolean;
  title: string;
  /** Supporting copy under the title. */
  message?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Red confirm button for destructive actions. */
  destructive?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Confirmation dialog replacing window.confirm() for destructive actions. */
export function ConfirmModal({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = false,
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  return (
    <Modal open={open} onClose={onCancel} aria-label={title}>
      <div className="px-6 py-5">
        <h2 className="text-base font-semibold text-gray-800">{title}</h2>
        {message && <p className="mt-2 text-sm text-gray-500">{message}</p>}
      </div>
      <div className="flex justify-end gap-2 rounded-b-xl border-t border-gray-200 bg-gray-50 px-6 py-3">
        <button
          onClick={onCancel}
          disabled={busy}
          className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-800 transition-colors hover:bg-gray-50 disabled:opacity-50"
        >
          {cancelLabel}
        </button>
        <button
          onClick={onConfirm}
          disabled={busy}
          className={`rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors disabled:opacity-50 ${
            destructive
              ? "bg-red-500 hover:bg-red-600"
              : "bg-teal-500 hover:bg-teal-600"
          }`}
        >
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
