import React, { useState } from 'react'
import { ConfirmationDialog } from './ui/ConfirmationDialog'
import { useApp } from '../context/AppContext'
import { RotateCw, AlertTriangle } from 'lucide-react'
import type { Delivery } from '../types'

interface ReplayModalProps {
  delivery: Delivery | null
  isOpen: boolean
  onClose: () => void
  onSuccess: (updatedDelivery?: Delivery) => void
}

export const ReplayModal: React.FC<ReplayModalProps> = ({
  delivery,
  isOpen,
  onClose,
  onSuccess,
}) => {
  const { service, addToast } = useApp()
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!delivery) return null

  const handleReplay = async () => {
    setIsLoading(true)
    setError(null)

    try {
      const res = await service.replayDelivery(delivery.id)
      if (res.success) {
        addToast({
          title: 'Replay Queued',
          description: `Delivery ${delivery.id} re-enqueued as PENDING.`,
          type: 'success',
        })
        onSuccess(res.delivery)
        onClose()
      } else {
        setError(res.message || 'Replay operation failed.')
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to replay delivery'
      setError(message)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <ConfirmationDialog
      isOpen={isOpen}
      onClose={onClose}
      onConfirm={handleReplay}
      title="Confirm Delivery Replay"
      description="Re-enqueue an exhausted dead-letter delivery back into the dispatch pipeline."
      confirmText="Confirm & Replay"
      cancelText="Cancel"
      variant="warning"
      isLoading={isLoading}
      error={error}
      icon={<RotateCw className="w-5 h-5 text-[#B48418]" />}
    >
      <div className="space-y-3.5 text-left">
        {/* Ordering Warning notice */}
        <div className="p-3 bg-[#E5B34B]/10 border border-[#E5B34B]/25 rounded-xl flex items-start gap-2.5">
          <AlertTriangle className="w-4 h-4 text-[#B8871E] shrink-0 mt-0.5" />
          <div className="text-xs text-[#202938] space-y-1">
            <p className="font-semibold text-[#B8871E]">Ordering Guarantee Notice</p>
            <p className="text-3xs text-[#64748B] leading-relaxed">
              When this delivery became <strong>DEAD</strong>, it released the destination
              endpoint&apos;s head-of-line lock. Replaying it now is <u>not</u> order-preserving
              relative to newer deliveries to this endpoint.
            </p>
          </div>
        </div>

        {/* Delivery Details Summary */}
        <div className="p-3 bg-[#F7F6F2] border border-[#E7E8EC] rounded-xl space-y-1.5 text-xs">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[#64748B] shrink-0">Delivery ID:</span>
            <span className="font-mono text-[#202938] font-semibold truncate">{delivery.id}</span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[#64748B] shrink-0">Endpoint:</span>
            <span className="font-mono text-[#202938] truncate max-w-[180px] sm:max-w-xs">
              {delivery.endpoint_url || delivery.endpoint_id}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[#64748B] shrink-0">Sequence:</span>
            <span className="font-mono text-[#202938]">#{delivery.seq}</span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[#64748B] shrink-0">Attempts Exhausted:</span>
            <span className="font-semibold text-[#E76B64]">{delivery.attempt_count} attempts</span>
          </div>
          {delivery.last_error && (
            <div className="pt-1.5 border-t border-[#E7E8EC]">
              <span className="text-[#64748B] block mb-0.5">Last Error:</span>
              <span className="font-mono text-3xs text-[#E76B64] break-all leading-snug">
                {delivery.last_error}
              </span>
            </div>
          )}
        </div>
      </div>
    </ConfirmationDialog>
  )
}
