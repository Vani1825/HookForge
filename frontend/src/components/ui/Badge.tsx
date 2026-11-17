import React, { type HTMLAttributes } from 'react'
import { cn } from '../../utils/cn'

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'info' | 'purple' | 'slate'
  dot?: boolean
}

export const Badge: React.FC<BadgeProps> = ({
  className,
  variant = 'default',
  dot = false,
  children,
  ...props
}) => {
  const variantStyles = {
    default: 'bg-[#F7F6F2] text-[#202938] border-[#E7E8EC]',
    slate: 'bg-slate-100 text-[#202938] border-[#E7E8EC]',
    success: 'bg-[#159B78]/10 text-[#159B78] border-[#159B78]/25',
    warning: 'bg-[#E5B34B]/15 text-[#B8871E] border-[#E5B34B]/30',
    danger: 'bg-[#E76B64]/10 text-[#E76B64] border-[#E76B64]/25',
    info: 'bg-[#EAF0FF] text-[#5277D9] border-[#DCE5FA]',
    purple: 'bg-purple-50 text-purple-700 border-purple-200',
  }

  const dotColors = {
    default: 'bg-[#64748B]',
    slate: 'bg-[#202938]',
    success: 'bg-[#159B78]',
    warning: 'bg-[#E5B34B]',
    danger: 'bg-[#E76B64]',
    info: 'bg-[#5277D9]',
    purple: 'bg-purple-500',
  }

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium border transition-colors',
        variantStyles[variant],
        className
      )}
      {...props}
    >
      {dot && <span className={cn('w-1.5 h-1.5 rounded-full', dotColors[variant])} />}
      {children}
    </span>
  )
}
