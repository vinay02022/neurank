import { Skeleton } from "@/components/ui/skeleton";

export default function VisibilityLoading() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-4 w-96" />
      </div>
      <Skeleton className="h-10 w-full max-w-3xl" />
      <div className="rounded-md border border-border/60">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 border-b border-border/60 p-3 last:border-b-0">
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="h-6 w-28" />
            <Skeleton className="h-4 w-12" />
            <Skeleton className="h-2 w-24 rounded-full" />
            <Skeleton className="h-4 w-10" />
            <Skeleton className="h-4 w-14" />
          </div>
        ))}
      </div>
    </div>
  );
}
