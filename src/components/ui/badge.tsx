import type { ReactNode } from "react";

type BadgeVariant = "red" | "amber" | "amber-soft" | "teal" | "teal-muted" | "blue" | "blue-muted" | "gray" | "gray-muted" | "faded" | "green";

const variantStyles: Record<BadgeVariant, string> = {
  red: "bg-red-500/15 text-red-700",
  amber: "bg-amber-500/15 text-amber-700",
  "amber-soft": "bg-amber-500/8 text-amber-600/80",
  teal: "bg-teal-500/15 text-teal-700",
  "teal-muted": "bg-teal-500/8 text-teal-600/70",
  blue: "bg-blue-500/15 text-blue-700",
  "blue-muted": "bg-blue-500/8 text-blue-600/70",
  green: "bg-green-500/15 text-green-700",
  gray: "bg-gray-200 text-gray-600",
  "gray-muted": "bg-gray-100 text-gray-500",
  faded: "bg-gray-100 text-gray-400",
};

interface BadgeProps {
  variant: BadgeVariant;
  children: ReactNode;
  className?: string;
  dot?: boolean;
  dotColor?: string;
}

export function Badge({
  variant,
  children,
  className = "",
  dot,
  dotColor,
}: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium leading-none ${variantStyles[variant]} ${className}`}
    >
      {dot && (
        <span
          className={`h-1.5 w-1.5 rounded-full ${dotColor ?? variantStyles[variant].split(" ")[0]}`}
        />
      )}
      {children}
    </span>
  );
}
