import { SkeletonLine, SkeletonBadge, SkeletonRow } from "@/components/ui/skeleton";

export function RoomContainerSkeleton() {
  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="h-4 w-4 animate-pulse rounded bg-gray-200" />
        <SkeletonLine className="w-32" />
        <div className="flex-1" />
        <SkeletonBadge />
        <SkeletonBadge />
      </div>
      <div className="border-t border-gray-200">
        <SkeletonRow />
        <SkeletonRow />
      </div>
    </div>
  );
}
