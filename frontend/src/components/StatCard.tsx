import React, { type ReactNode } from 'react'
import { Card } from './ui/Card'
import { cn } from '../utils/cn'

interface StatCardProps {
  title: string
  value: string | number
  subtitle?: string
  icon: ReactNode
  trend?: {
    value: string
    isPositive: boolean
  }
  badge?: ReactNode
  className?: string
}

export const StatCard: React.FC<StatCardProps> = ({
  title,
  value,
  subtitle,
  icon,
  trend,
  badge,
  className,
}) => {
  return (
    <Card className={cn('p-5 flex flex-col justify-between relative overflow-hidden', className)}>
      <div className="flex items-start justify-between">
        <span className="text-xs font-medium text-slate-500 uppercase tracking-wider">{title}</span>
        <div className="p-2 rounded-lg bg-slate-50 border border-slate-100 text-slate-700">
          {icon}
        </div>
      </div>

      <div className="mt-4">
        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-bold tracking-tight text-slate-900">{value}</span>
          {badge}
        </div>

        {(subtitle || trend) && (
          <div className="mt-1 flex items-center gap-1.5 text-xs text-slate-500">
            {trend && (
              <span
                className={cn(
                  'font-medium inline-flex items-center',
                  trend.isPositive ? 'text-emerald-600' : 'text-rose-600'
                )}
              >
                {trend.value}
              </span>
            )}
            {subtitle && <span>{subtitle}</span>}
          </div>
        )}
      </div>
    </Card>
  )
}
