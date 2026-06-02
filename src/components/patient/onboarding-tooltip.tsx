"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

interface OnboardingTooltipProps {
  copy: string;
  show: boolean;
  children: React.ReactNode;
}

/**
 * Renders an inline tooltip below the page's persistent header by injecting
 * itself via a portal into the `<header>` element's parent. Each phase wraps
 * its content with this; the tooltip floats just below the header, above all
 * step content.
 */
export function OnboardingTooltip({ copy, show, children }: OnboardingTooltipProps) {
  const [dismissed, setDismissed] = useState(false);
  const [target, setTarget] = useState<HTMLElement | null>(null);

  // Reset dismissed state whenever the active copy changes (i.e., new phase).
  // Done during render (not an effect) per React's "adjust state during render"
  // guidance — avoids a cascading re-render.
  const [prevCopy, setPrevCopy] = useState(copy);
  if (copy !== prevCopy) {
    setPrevCopy(copy);
    setDismissed(false);
  }

  useEffect(() => {
    if (!show || dismissed) {
      // Detaching from the DOM slot is an external-system sync, not derived
      // state — clearing the target here is intentional.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTarget(null);
      return;
    }
    // Find the persistent header and place the tooltip immediately after it
    // by mounting the banner into a slot below the header.
    const header = document.querySelector('[data-onboarding-tooltip-slot]') as HTMLElement | null;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTarget(header);
  }, [show, dismissed]);

  return (
    <>
      {children}
      {show && !dismissed && target &&
        createPortal(
          <div
            role="tooltip"
            className="mb-4 flex items-start gap-2 rounded-xl bg-white border border-teal-200 px-3 py-2.5 text-teal-700 shadow-sm"
          >
            <p className="flex-1 text-xs leading-relaxed">{copy}</p>
            <button
              type="button"
              onClick={() => setDismissed(true)}
              aria-label="Dismiss tip"
              className="mt-0.5 flex-shrink-0 text-teal-500 opacity-70 hover:opacity-100 transition-opacity"
            >
              <X size={14} />
            </button>
          </div>,
          target
        )}
    </>
  );
}
