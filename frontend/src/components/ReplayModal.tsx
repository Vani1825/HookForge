import React, { useState } from 'react'
import { Modal } from './ui/Modal'
import { Button } from './ui/Button'
import { useApp } from '../context/AppContext'
import { RotateCw, AlertTriangle, AlertCircle } from 'lucide-react'
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
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Confirm Delivery Replay"
      description="Re-enqueue an exhausted dead-letter delivery back into the dispatch pipeline."
      maxWidth="md"
      footer={
        <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-2 w-full">
          <Button className="w-full sm:w-auto" variant="outline" size="sm" onClick={onClose} disabled={isLoading}>
            Cancel
          </Button>
          <Button
            className="w-full sm:w-auto"
            variant="primary"
            size="sm"
            onClick={handleReplay}
            isLoading={isLoading}
            leftIcon={<RotateCw className="w-3.5 h-3.5" />}
          >
            Confirm & Replay
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

        {/* Ordering Warning notice */}
        <div className="p-3.5 bg-[#E5B34B]/10 border border-[#E5B34B]/25 rounded-xl flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-[#B8871E] shrink-0 mt-0.5" />
          <div className="text-xs text-[#202938] space-y-1">
            <p className="font-semibold text-[#B8871E]">Ordering Guarantee Notice</p>
            <p>
              When this delivery became <strong>DEAD</strong>, it released the destination
              endpoint&apos;s head-of-line lock so subsequent events could proceed.
            </p>
            <p className="font-medium text-[#B8871E]">
              Replaying it now is <u>not</u> order-preserving relative to newer deliveries to this
              endpoint.
            </p>
          </div>
        </div>

        {/* Delivery Details Summary */}
        <div className="p-3 bg-[#F7F6F2] border border-[#E7E8EC] rounded-lg space-y-2 text-xs">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[#64748B] shrink-0">Delivery ID:</span>
            <span className="font-mono text-[#202938] font-semibold truncate">{delivery.id}</span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[#64748B] shrink-0">Endpoint:</span>
            <span className="font-mono text-[#202938] truncate max-w-[180px] sm:max-w-xs">{delivery.endpoint_url || delivery.endpoint_id}</span>
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
            <div className="pt-1 border-t border-[#E7E8EC]">
              <span className="text-[#64748B] block mb-0.5">Last Error:</span>
              <span className="font-mono text-2xs text-[#E76B64] break-all">{delivery.last_error}</span>
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}
