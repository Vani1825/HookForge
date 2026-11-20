import React, { useState } from 'react'
import { Modal } from './ui/Modal'
import { Button } from './ui/Button'
import { useApp } from '../context/AppContext'
import { RotateCw, AlertTriangle, AlertCircle } from 'lucide-react'
import type { BulkReplayResult } from '../types'
import { formatErrorMessage } from '../api/client'
import { truncateId } from '../utils/formatters'

interface BulkReplayConfirmModalProps {
  deliveryIds: string[]
  isOpen: boolean
  onClose: () => void
  onComplete: (result: BulkReplayResult) => void
}

export const BulkReplayConfirmModal: React.FC<BulkReplayConfirmModalProps> = ({
  deliveryIds,
  isOpen,
  onClose,
  onComplete,
}) => {
  const { service, addToast } = useApp()
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!isOpen || deliveryIds.length === 0) return null

  const handleBulkReplay = async () => {
    setIsLoading(true)
    setError(null)

    try {
      const result = await service.bulkReplayDeliveries(deliveryIds)

      addToast({
        title: 'Bulk Replay Completed',
        description: `Processed ${result.total} deliveries: ${result.summary.successfulCount} succeeded, ${result.summary.ineligibleCount} ineligible, ${result.summary.rejectedCount} rejected.`,
        type: result.summary.successfulCount > 0 ? 'success' : 'warning',
      })

      onComplete(result)
      onClose()
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
      title={`Confirm Bulk Replay (${deliveryIds.length} Deliveries)`}
      description="Re-enqueue multiple dead deliveries back into the active dispatch pipeline."
      maxWidth="md"
      footer={
        <div className="flex items-center justify-end gap-2 w-full">
          <Button variant="outline" size="sm" onClick={onClose} disabled={isLoading}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={handleBulkReplay}
            isLoading={isLoading}
            leftIcon={<RotateCw className="w-3.5 h-3.5" />}
          >
            Confirm & Replay ({deliveryIds.length})
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

        <div className="p-3.5 bg-[#E5B34B]/10 border border-[#E5B34B]/25 rounded-xl flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-[#B8871E] shrink-0 mt-0.5" />
          <div className="text-xs text-[#202938] space-y-1">
            <p className="font-semibold text-[#B8871E]">Bulk Replay Notice</p>
            <p className="text-[#64748B]">
              Only deliveries currently in <strong>DEAD</strong> state will be successfully re-enqueued.
              Each replayed delivery resets its attempt counter and transitions to <strong>PENDING</strong>.
            </p>
          </div>
        </div>

        <div>
          <span className="text-xs font-semibold text-[#202938] block mb-1">
            Selected Deliveries ({deliveryIds.length}):
          </span>
          <div className="max-h-40 overflow-y-auto p-2.5 bg-[#F7F6F2] border border-[#E7E8EC] rounded-lg divide-y divide-[#E7E8EC]/60">
            {deliveryIds.map((id, index) => (
              <div key={id} className="py-1 flex items-center justify-between text-xs font-mono">
                <span className="text-[#64748B] font-sans text-2xs">#{index + 1}</span>
                <span className="text-[#202938] font-semibold">{truncateId(id, 12)}</span>
                <span className="text-3xs text-[#64748B]">{id}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  )
}

