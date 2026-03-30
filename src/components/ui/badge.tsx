import type { ReactNode } from "react";

type BadgeVariant = "red" | "amber" | "teal" | "blue" | "gray" | "faded";

const variantStyles: Record<BadgeVariant, string> = {
  red: "bg-red-500/10 text-red-500",
  amber: "bg-amber-500/10 text-amber-500",
  teal: "bg-teal-500/10 text-teal-500",
  blue: "bg-blue-500/10 text-blue-500",
  gray: "bg-gray-200 text-gray-500",
  faded: "bg-gray-100 text-gray-500 opacity-60",
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
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${variantStyles[variant]} ${className}`}
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
