import React from 'react'
import type { CircuitState } from '../types'
import { Badge } from './ui/Badge'
import { Zap, AlertTriangle, ShieldCheck } from 'lucide-react'

interface CircuitBadgeProps {
  state: CircuitState | string
  className?: string
  consecutiveFailures?: number
}

export const CircuitBadge: React.FC<CircuitBadgeProps> = ({ state, className, consecutiveFailures }) => {
  switch (state) {
    case 'CLOSED':
      return (
        <Badge variant="success" className={className}>
          <ShieldCheck className="w-3 h-3 mr-1 inline" />
          Closed (Healthy)
        </Badge>
      )
    case 'HALF_OPEN':
      return (
        <Badge variant="warning" className={className}>
          <AlertTriangle className="w-3 h-3 mr-1 inline" />
          Half-Open (Probing)
        </Badge>
      )
    case 'OPEN':
      return (
        <Badge variant="danger" className={className}>
          <Zap className="w-3 h-3 mr-1 inline" />
          Open (Tripped{consecutiveFailures ? ` · ${consecutiveFailures} fails` : ''})
        </Badge>
      )
    default:
      return (
        <Badge variant="default" className={className}>
          {state}
        </Badge>
      )
  }
}
