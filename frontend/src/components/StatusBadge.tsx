import React from 'react'
import type { DeliveryState } from '../types'
import { Badge } from './ui/Badge'

interface StatusBadgeProps {
  state: DeliveryState | string
  className?: string
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ state, className }) => {
  switch (state) {
    case 'SUCCEEDED':
      return (
        <Badge variant="success" dot className={className}>
          Succeeded
        </Badge>
      )
    case 'RETRYING':
      return (
        <Badge variant="warning" dot className={className}>
          Retrying
        </Badge>
      )
    case 'DEAD':
      return (
        <Badge variant="danger" dot className={className}>
          Dead Letter
        </Badge>
      )
    case 'IN_FLIGHT':
      return (
        <Badge variant="purple" dot className={className}>
          In Flight
        </Badge>
      )
    case 'PENDING':
      return (
        <Badge variant="info" dot className={className}>
          Pending
        </Badge>
      )
    default:
      return (
        <Badge variant="default" dot className={className}>
          {state}
        </Badge>
      )
  }
}
