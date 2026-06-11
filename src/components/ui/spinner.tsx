/** Teal ring spinner. Size via className (default h-6 w-6). */
export function Spinner({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <div
      className={`animate-spin rounded-full border-2 border-teal-500 border-t-transparent ${className}`}
    />
  );
}
