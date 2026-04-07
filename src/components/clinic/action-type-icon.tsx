"use client";

import type { ActionType } from "@/lib/workflows/types";

interface ActionTypeIconProps {
  actionType: ActionType;
  size?: number;
  className?: string;
}

/**
 * SVG icon per action type. Matches sidebar icon style:
 * 20x20 viewBox, 1.5px stroke, rounded caps/joins.
 */
export function ActionTypeIcon({
  actionType,
  size = 20,
  className,
}: ActionTypeIconProps) {
  const svgProps = {
    width: size,
    height: size,
    viewBox: "0 0 20 20",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.5,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className,
  };

  switch (actionType) {
    // Form / document icon
    case "deliver_form":
      return (
        <svg {...svgProps}>
          <rect x="4" y="2" width="12" height="16" rx="2" />
          <line x1="7" y1="6" x2="13" y2="6" />
          <line x1="7" y1="9" x2="13" y2="9" />
          <line x1="7" y1="12" x2="10" y2="12" />
        </svg>
      );

    // SMS / message bubble icon
    case "send_reminder":
    case "send_sms":
      return (
        <svg {...svgProps}>
          <path d="M3 4h14a1 1 0 011 1v8a1 1 0 01-1 1H7l-4 3V5a1 1 0 011-1z" />
          <line x1="7" y1="8" x2="13" y2="8" />
          <line x1="7" y1="11" x2="11" y2="11" />
        </svg>
      );

    // Credit card icon
    case "capture_card":
      return (
        <svg {...svgProps}>
          <rect x="2" y="4" width="16" height="12" rx="2" />
          <line x1="2" y1="8" x2="18" y2="8" />
          <line x1="5" y1="12" x2="9" y2="12" />
        </svg>
      );

    // Contact / person with check icon
    case "verify_contact":
      return (
        <svg {...svgProps}>
          <circle cx="8" cy="7" r="3" />
          <path d="M3 17v-1a5 5 0 015-5h1" />
          <polyline points="13 13 15 15 19 11" />
        </svg>
      );

    // File / PDF icon
    case "send_file":
      return (
        <svg {...svgProps}>
          <path d="M13 2H6a2 2 0 00-2 2v12a2 2 0 002 2h8a2 2 0 002-2V5l-3-3z" />
          <polyline points="13 2 13 5 16 5" />
          <line x1="7" y1="10" x2="13" y2="10" />
          <line x1="7" y1="13" x2="11" y2="13" />
        </svg>
      );

    // Rebooking / calendar with arrow icon
    case "send_rebooking_nudge":
      return (
        <svg {...svgProps}>
          <rect x="3" y="4" width="14" height="13" rx="2" />
          <line x1="3" y1="8" x2="17" y2="8" />
          <line x1="7" y1="2" x2="7" y2="5" />
          <line x1="13" y1="2" x2="13" y2="5" />
          <polyline points="9 12 11 14 13 12" />
        </svg>
      );

    // Default: generic action icon
    default:
      return (
        <svg {...svgProps}>
          <circle cx="10" cy="10" r="7" />
          <line x1="10" y1="7" x2="10" y2="13" />
          <line x1="7" y1="10" x2="13" y2="10" />
        </svg>
      );
  }
}
