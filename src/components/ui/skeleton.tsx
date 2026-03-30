interface SkeletonProps {
  className?: string;
}

export function SkeletonLine({ className = "" }: SkeletonProps) {
  return (
    <div
      className={`h-4 animate-pulse rounded bg-gray-200 ${className}`}
    />
  );
}

export function SkeletonBadge({ className = "" }: SkeletonProps) {
  return (
    <div
      className={`h-5 w-16 animate-pulse rounded-full bg-gray-200 ${className}`}
    />
  );
}

export function SkeletonRow({ className = "" }: SkeletonProps) {
  return (
    <div className={`flex items-center gap-4 p-3 ${className}`}>
      <SkeletonLine className="w-14" />
      <div className="flex-1 space-y-1.5">
        <SkeletonLine className="w-32" />
        <SkeletonLine className="w-24 h-3" />
      </div>
      <SkeletonBadge />
      <SkeletonBadge className="w-8" />
      <SkeletonLine className="w-16" />
    </div>
  );
}
