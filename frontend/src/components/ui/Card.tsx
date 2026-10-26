import React, { type HTMLAttributes } from 'react'
import { cn } from '../../utils/cn'

export const Card: React.FC<HTMLAttributes<HTMLDivElement>> = ({ className, ...props }) => (
  <div
    className={cn(
      'bg-white rounded-xl border border-slate-200/90 shadow-xs hover:border-slate-300/80 transition-all duration-150',
      className
    )}
    {...props}
  />
)

export const CardHeader: React.FC<HTMLAttributes<HTMLDivElement>> = ({ className, ...props }) => (
  <div className={cn('p-5 pb-3 flex flex-col gap-1', className)} {...props} />
)

export const CardTitle: React.FC<HTMLAttributes<HTMLHeadingElement>> = ({ className, ...props }) => (
  <h3 className={cn('text-base font-semibold text-slate-900 tracking-tight', className)} {...props} />
)

export const CardDescription: React.FC<HTMLAttributes<HTMLParagraphElement>> = ({ className, ...props }) => (
  <p className={cn('text-xs text-slate-500', className)} {...props} />
)

export const CardContent: React.FC<HTMLAttributes<HTMLDivElement>> = ({ className, ...props }) => (
  <div className={cn('p-5 pt-0', className)} {...props} />
)

export const CardFooter: React.FC<HTMLAttributes<HTMLDivElement>> = ({ className, ...props }) => (
  <div className={cn('p-5 pt-0 flex items-center justify-between border-t border-slate-100 mt-4', className)} {...props} />
)
