/** Teal check inside a teal-50 disc — the standard success marker. */
export function CheckCircle({
  className = "flex h-12 w-12 items-center justify-center rounded-full bg-teal-50",
  iconClassName = "h-6 w-6 text-teal-500",
}: {
  className?: string;
  iconClassName?: string;
}) {
  return (
    <div className={className}>
      <svg
        className={iconClassName}
        fill="none"
        viewBox="0 0 24 24"
        strokeWidth={2}
        stroke="currentColor"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M4.5 12.75l6 6 9-13.5"
        />
      </svg>
    </div>
  );
}
