/**
 * Skeleton — reusable pulse placeholder for loading states.
 *
 * Prevents layout shift by reserving the exact space that real content
 * will occupy. Uses CSS animate-pulse for the shimmer effect.
 *
 * Usage:
 *   <Skeleton className="h-4 w-32" />                    — inline text
 *   <Skeleton className="h-[72px] rounded-2xl" />        — card
 *   <Skeleton className="w-12 h-12 rounded-xl" />        — icon
 *   <Skeleton className="h-16 w-48 rounded-xl" />        — hero block
 *
 * Compose multiple for complex layouts:
 *   <SkeletonGroup className="flex flex-col gap-2">
 *     <Skeleton className="h-4 w-3/4" />
 *     <Skeleton className="h-4 w-1/2" />
 *   </SkeletonGroup>
 */

type SkeletonProps = {
  className?: string
  /** Override inline width */
  width?: string | number
  /** Override inline height */
  height?: string | number
}

export default function Skeleton({ className, width, height }: SkeletonProps) {
  return (
    <div
      className={`animate-pulse rounded-lg bg-white/[0.06] ${className ?? ''}`}
      style={{ width, height }}
    />
  )
}

/** Wrapper for grouping skeletons — just a div with optional className. */
export function SkeletonGroup({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={className}>{children}</div>
}
