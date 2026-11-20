import React, { useState } from 'react'
import { Modal } from './ui/Modal'
import { Button } from './ui/Button'
import { useApp } from '../context/AppContext'
import { AlertTriangle, AlertCircle, XCircle } from 'lucide-react'
import type { Delivery } from '../types'
import { formatErrorMessage } from '../api/client'
import { formatDateTime } from '../utils/formatters'

interface CancelScheduledModalProps {
  delivery: Delivery | null
  isOpen: boolean
  onClose: () => void
  onSuccess: (updatedDelivery?: Delivery) => void
}

export const CancelScheduledModal: React.FC<CancelScheduledModalProps> = ({
  delivery,
  isOpen,
  onClose,
  onSuccess,
}) => {
  const { service, addToast } = useApp()
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!delivery) return null

  const handleCancel = async () => {
    setIsLoading(true)
    setError(null)

    try {
      const res = await service.cancelScheduledDelivery(delivery.id)
      if (res.success) {
        addToast({
          title: 'Scheduled Delivery Cancelled',
          description: `Delivery ${delivery.id} has been marked as CANCELLED.`,
          type: 'success',
        })
        onSuccess(res.delivery)
        onClose()
      } else {
        setError(res.message || 'Failed to cancel scheduled delivery.')
      }
    } catch (err: unknown) {
      const msg = formatErrorMessage(err)
      setError(msg)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Cancel Scheduled Delivery"
      description="Permanently cancel this scheduled webhook delivery before it is dispatched."
      maxWidth="md"
      footer={
        <div className="flex items-center justify-end gap-2 w-full">
          <Button variant="outline" size="sm" onClick={onClose} disabled={isLoading}>
            Keep Scheduled
          </Button>
          <Button
            variant="danger"
            size="sm"
            onClick={handleCancel}
            isLoading={isLoading}
            leftIcon={<XCircle className="w-3.5 h-3.5" />}
          >
            Confirm Cancellation
          </Button>
        </div>
      }
    >
      <div className="space-y-4 text-left">
        {error && (
          <div className="p-3 bg-[#E76B64]/10 border border-[#E76B64]/25 rounded-lg flex items-center gap-2 text-xs text-[#E76B64]">
            <AlertCircle className="w-4 h-4 shrink-0 text-[#E76B64]" />
            <span>{error}</span>
          </div>
        )}

        <div className="p-3.5 bg-[#E76B64]/10 border border-[#E76B64]/25 rounded-xl flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-[#E76B64] shrink-0 mt-0.5" />
          <div className="text-xs text-[#202938] space-y-1">
            <p className="font-semibold text-[#E76B64]">Permanent Cancellation</p>
            <p className="text-[#64748B]">
              This scheduled webhook delivery will be transitioned to <strong>CANCELLED</strong> state.
              The dispatcher will not dispatch this webhook when the scheduled time arrives.
            </p>
          </div>
        </div>

        <div className="p-3 bg-[#F7F6F2] border border-[#E7E8EC] rounded-lg space-y-2 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-[#64748B]">Delivery ID:</span>
            <span className="font-mono text-[#202938] font-semibold">{delivery.id}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[#64748B]">Destination:</span>
            <span className="font-mono text-[#202938] truncate max-w-xs">
              {delivery.endpoint_url || delivery.endpointId || delivery.endpoint_id}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[#64748B]">Current State:</span>
            <span className="font-semibold text-[#5277D9]">{delivery.state}</span>
          </div>
          {(delivery.scheduled_at || delivery.scheduledAt) && (
            <div className="flex items-center justify-between">
              <span className="text-[#64748B]">Scheduled Execution:</span>
              <span className="font-medium text-[#202938]">
                {formatDateTime(delivery.scheduled_at || delivery.scheduledAt!)}
              </span>
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}

