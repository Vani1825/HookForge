import React, { type HTMLAttributes } from 'react'
import { cn } from '../../utils/cn'

export const Card: React.FC<HTMLAttributes<HTMLDivElement>> = ({ className, ...props }) => (
  <div
    className={cn(
      'bg-white rounded-xl border border-[#E7E8EC] shadow-[0_1px_3px_rgba(0,0,0,0.04)] hover:border-[#D1D5DB] transition-all duration-150',
      className
    )}
    {...props}
  />
)

export const CardHeader: React.FC<HTMLAttributes<HTMLDivElement>> = ({ className, ...props }) => (
  <div className={cn('p-5 pb-3 flex flex-col gap-1', className)} {...props} />
)

export const CardTitle: React.FC<HTMLAttributes<HTMLHeadingElement>> = ({ className, ...props }) => (
  <h3 className={cn('text-base font-semibold text-[#202938] tracking-tight', className)} {...props} />
)

export const CardDescription: React.FC<HTMLAttributes<HTMLParagraphElement>> = ({ className, ...props }) => (
  <p className={cn('text-xs text-[#64748B]', className)} {...props} />
)

export const CardContent: React.FC<HTMLAttributes<HTMLDivElement>> = ({ className, ...props }) => (
  <div className={cn('p-5 pt-0', className)} {...props} />
)

export const CardFooter: React.FC<HTMLAttributes<HTMLDivElement>> = ({ className, ...props }) => (
  <div className={cn('p-5 pt-0 flex items-center justify-between border-t border-[#E7E8EC] mt-4', className)} {...props} />
)
