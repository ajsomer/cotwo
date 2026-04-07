export default function WorkflowsLoading() {
  return (
    <div className="flex h-full flex-col">
      {/* Header skeleton */}
      <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
        <div>
          <div className="h-7 w-32 animate-pulse rounded bg-gray-200" />
          <div className="mt-2 h-4 w-64 animate-pulse rounded bg-gray-200" />
        </div>
        <div className="h-9 w-56 animate-pulse rounded-lg bg-gray-200" />
      </div>

      {/* Split pane skeleton */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <div className="w-[280px] shrink-0 border-r border-gray-200 bg-gray-50/50 p-4 space-y-2">
          <div className="h-4 w-32 animate-pulse rounded bg-gray-200 mb-4" />
          {[1, 2, 3, 4, 5].map((i) => (
            <div
              key={i}
              className="h-14 animate-pulse rounded-lg bg-gray-200/50"
            />
          ))}
        </div>

        {/* Middle pane */}
        <div className="flex-1 p-6 space-y-4">
          <div className="h-7 w-48 animate-pulse rounded bg-gray-200" />
          <div className="h-4 w-32 animate-pulse rounded bg-gray-200" />
          <div className="mt-6 h-px bg-gray-200" />
          <div className="h-5 w-40 animate-pulse rounded bg-gray-200" />
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-16 animate-pulse rounded-xl border border-gray-200 bg-white"
            />
          ))}
        </div>
      </div>
    </div>
  );
}
