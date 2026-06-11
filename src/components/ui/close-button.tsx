"use client";

/** X icon button for dismissing panels and modals. */
export function CloseButton({
  onClick,
  className = "p-1 text-gray-500 hover:text-gray-800 transition-colors rounded",
  iconClassName = "h-5 w-5",
  "aria-label": ariaLabel = "Close",
}: {
  onClick: () => void;
  className?: string;
  iconClassName?: string;
  "aria-label"?: string;
}) {
  return (
    <button type="button" onClick={onClick} className={className} aria-label={ariaLabel}>
      <svg
        className={iconClassName}
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M6 18L18 6M6 6l12 12"
        />
      </svg>
    </button>
  );
}
