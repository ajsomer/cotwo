import { RoomContainerSkeleton } from "@/components/clinic/room-container-skeleton";
import { SkeletonLine, SkeletonBadge } from "@/components/ui/skeleton";

export default function RunSheetLoading() {
  return (
    <div className="p-6 space-y-4 max-w-7xl mx-auto">
      {/* Header skeleton */}
      <div>
        <SkeletonLine className="w-40 h-7" />
        <div className="flex items-center gap-2 mt-2">
          <SkeletonLine className="w-48" />
          <SkeletonLine className="w-32" />
        </div>
      </div>

      {/* Summary bar skeleton */}
      <div className="bg-white rounded-xl border border-gray-200 px-4 py-3 flex items-center gap-4">
        <SkeletonBadge className="w-12" />
        <SkeletonBadge className="w-12" />
        <SkeletonBadge className="w-12" />
        <SkeletonBadge className="w-12" />
      </div>

      {/* Room skeletons */}
      <div className="space-y-3">
        <RoomContainerSkeleton />
        <RoomContainerSkeleton />
        <RoomContainerSkeleton />
      </div>
    </div>
  );
}
