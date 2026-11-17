import React, { type ReactNode } from 'react'
import { Inbox } from 'lucide-react'
import { cn } from '../../utils/cn'

interface EmptyStateProps {
  icon?: ReactNode
  title: string
  description: string
  action?: ReactNode
  className?: string
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon,
  title,
  description,
  action,
  className,
}) => {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center p-8 sm:p-12 border-2 border-dashed border-[#E7E8EC] rounded-xl bg-[#F7F6F2]/60 my-4',
        className
      )}
    >
      <div className="w-12 h-12 rounded-xl bg-[#EAF0FF] flex items-center justify-center text-[#5277D9] mb-3 border border-[#DCE5FA]">
        {icon || <Inbox className="w-6 h-6 text-[#5277D9]" />}
      </div>
      <h3 className="text-sm font-semibold text-[#202938]">{title}</h3>
      <p className="text-xs text-[#64748B] max-w-sm mt-1 mb-4">{description}</p>
      {action && <div>{action}</div>}
    </div>
  )
}
