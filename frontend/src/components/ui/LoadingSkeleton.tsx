import React from 'react'
import { cn } from '../../utils/cn'

export const Skeleton: React.FC<{ className?: string }> = ({ className }) => (
  <div className={cn('animate-pulse rounded-md bg-[#EAF0FF]/50 border border-[#DCE5FA]/30', className)} />
)

export const TableSkeleton: React.FC<{ rows?: number; cols?: number }> = ({ rows = 5, cols = 5 }) => (
  <div className="w-full space-y-3 p-4">
    <div className="flex gap-4 border-b border-[#E7E8EC] pb-3">
      {Array.from({ length: cols }).map((_, i) => (
        <Skeleton key={i} className="h-4 flex-1" />
      ))}
    </div>
    {Array.from({ length: rows }).map((_, i) => (
      <div key={i} className="flex gap-4 py-2 border-b border-[#E7E8EC]/60">
        {Array.from({ length: cols }).map((_, j) => (
          <Skeleton key={j} className="h-4 flex-1" />
        ))}
      </div>
    ))}
  </div>
)

export const CardSkeleton: React.FC = () => (
  <div className="p-5 rounded-xl border border-[#E7E8EC] bg-white space-y-3">
    <div className="flex justify-between items-center">
      <Skeleton className="h-4 w-24" />
      <Skeleton className="h-6 w-6 rounded-full" />
    </div>
    <Skeleton className="h-8 w-32" />
    <Skeleton className="h-3 w-40" />
  </div>
)
