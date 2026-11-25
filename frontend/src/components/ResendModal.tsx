import React, { useState } from 'react'
import { Modal } from './ui/Modal'
import { Button } from './ui/Button'
import { StatusBadge } from './StatusBadge'
import { useApp } from '../context/AppContext'
import { RotateCw, AlertTriangle, AlertCircle, Zap, Clock, Info, CheckCircle2 } from 'lucide-react'
import type { Delivery, ResendDeliveryResult } from '../types'

interface ResendModalProps {
  delivery: Delivery | null
  isOpen: boolean
  onClose: () => void
  onSuccess: (result: ResendDeliveryResult) => void
}

export const ResendModal: React.FC<ResendModalProps> = ({
  delivery,
  isOpen,
  onClose,
  onSuccess,
}) => {
  const { service, addToast } = useApp()
  const [immediate, setImmediate] = useState<boolean>(false)
  const [isLoading, setIsLoading] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)

  if (!delivery) return null

  const isEligible = delivery.state === 'DEAD' || delivery.state === 'SUCCEEDED' || delivery.state === 'CANCELLED'
  const isInFlight = delivery.state === 'IN_FLIGHT'

  const handleResend = async () => {
    if (!isEligible || isInFlight) return
    setIsLoading(true)
    setError(null)

    try {
      const res = await service.resendDelivery(delivery.id, { immediate })
      if (res.success) {
        addToast({
          title: immediate ? 'Delivery Resent' : 'Resend Queued',
          description: res.message || (immediate ? 'Delivery executed immediately.' : `Delivery ${delivery.id} queued for resend.`),
          type: 'success',
        })
        onSuccess(res)
        onClose()
      } else {
        setError(res.message || 'Resend operation could not be completed.')
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to resend delivery'
      setError(message)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Resend Webhook Delivery"
      description="Configure and trigger a manual resend for this webhook delivery."
      maxWidth="md"
      footer={
        <div className="flex items-center justify-end gap-2 w-full">
          <Button variant="outline" size="sm" onClick={onClose} disabled={isLoading}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={handleResend}
            isLoading={isLoading}
            disabled={!isEligible || isInFlight}
            leftIcon={<RotateCw className="w-3.5 h-3.5" />}
          >
            {immediate ? 'Execute Immediately' : 'Queue Resend'}
          </Button>
        </div>
      }
    >
      <div className="space-y-4 text-left">
        {/* Error Alert */}
        {error && (
          <div className="p-3 bg-[#E76B64]/10 border border-[#E76B64]/25 rounded-lg flex items-start gap-2.5 text-xs text-[#E76B64]">
            <AlertCircle className="w-4 h-4 shrink-0 text-[#E76B64] mt-0.5" />
            <div className="space-y-0.5">
              <span className="font-semibold block">Resend Failed</span>
              <span>{error}</span>
            </div>
          </div>
        )}

        {/* State Notice & Contextual Warnings */}
        {isInFlight ? (
          <div className="p-3.5 bg-[#5277D9]/10 border border-[#5277D9]/25 rounded-xl flex items-start gap-3">
            <Info className="w-5 h-5 text-[#5277D9] shrink-0 mt-0.5" />
            <div className="text-xs text-[#202938] space-y-1">
              <p className="font-semibold text-[#5277D9]">Active Dispatch In Progress</p>
              <p>
                This delivery is currently <strong>IN_FLIGHT</strong>. Resubmissions are rejected
                while an HTTP dispatch lease is active to prevent duplicate concurrent attempts.
              </p>
            </div>
          </div>
        ) : delivery.state === 'SUCCEEDED' ? (
          <div className="p-3.5 bg-[#E5B34B]/10 border border-[#E5B34B]/25 rounded-xl flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-[#B8871E] shrink-0 mt-0.5" />
            <div className="text-xs text-[#202938] space-y-1">
              <p className="font-semibold text-[#B8871E]">Duplicate Delivery Warning</p>
              <p>
                This webhook previously <strong>SUCCEEDED</strong>. Resending will transmit the event
                payload to the destination endpoint again, which may result in duplicate actions on the receiving server.
              </p>
            </div>
          </div>
        ) : delivery.state === 'DEAD' ? (
          <div className="p-3.5 bg-[#E5B34B]/10 border border-[#E5B34B]/25 rounded-xl flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-[#B8871E] shrink-0 mt-0.5" />
            <div className="text-xs text-[#202938] space-y-1">
              <p className="font-semibold text-[#B8871E]">Ordering Guarantee Notice</p>
              <p>
                When this delivery became <strong>DEAD</strong>, the destination head-of-line lock was released.
                Resending now is <u>not</u> guaranteed to be order-preserving relative to newer events.
              </p>
            </div>
          </div>
        ) : delivery.state === 'CANCELLED' ? (
          <div className="p-3.5 bg-[#5277D9]/10 border border-[#5277D9]/25 rounded-xl flex items-start gap-3">
            <Info className="w-5 h-5 text-[#5277D9] shrink-0 mt-0.5" />
            <div className="text-xs text-[#202938] space-y-1">
              <p className="font-semibold text-[#5277D9]">Reactivating Cancelled Delivery</p>
              <p>
                This delivery was previously cancelled. Resending will place it back into the dispatch pipeline
                using its original payload and sequence number.
              </p>
            </div>
          </div>
        ) : null}

        {/* Delivery Details Summary */}
        <div className="p-3 bg-[#F7F6F2] border border-[#E7E8EC] rounded-lg space-y-2 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-[#64748B]">Delivery ID:</span>
            <span className="font-mono text-[#202938] font-semibold">{delivery.id}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[#64748B]">Destination:</span>
            <span className="font-mono text-[#202938] truncate max-w-xs">{delivery.endpoint_url || delivery.endpointId || delivery.endpoint_id}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[#64748B]">Current State:</span>
            <StatusBadge state={delivery.state} />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[#64748B]">Sequence & Attempts:</span>
            <span className="font-mono text-[#202938]">
              Seq #{delivery.seq} • {delivery.attempt_count ?? delivery.attemptCount ?? 0} previous attempts
            </span>
          </div>
        </div>

        {/* Execution Mode Selector */}
        {!isInFlight && (
          <div className="space-y-2 pt-1">
            <label className="text-2xs font-semibold uppercase tracking-wider text-[#64748B] block">
              Execution Mode
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {/* Option 1: Queued Mode */}
              <button
                type="button"
                onClick={() => setImmediate(false)}
                className={`p-3 rounded-xl border text-left flex flex-col justify-between transition-all cursor-pointer ${
                  !immediate
                    ? 'border-[#5277D9] bg-[#EAF0FF]/40 ring-1 ring-[#5277D9]'
                    : 'border-[#E7E8EC] bg-white hover:bg-[#F7F6F2]'
                }`}
                data-testid="resend-mode-queued"
              >
                <div className="flex items-center justify-between w-full mb-1">
                  <div className="flex items-center gap-1.5 font-semibold text-xs text-[#202938]">
                    <Clock className="w-3.5 h-3.5 text-[#5277D9]" />
                    <span>Queued Resend</span>
                  </div>
                  {!immediate && <CheckCircle2 className="w-4 h-4 text-[#5277D9]" />}
                </div>
                <p className="text-2xs text-[#64748B] leading-relaxed">
                  Re-enqueues as PENDING for standard background dispatcher processing. (Recommended)
                </p>
              </button>

              {/* Option 2: Immediate Execution */}
              <button
                type="button"
                onClick={() => setImmediate(true)}
                className={`p-3 rounded-xl border text-left flex flex-col justify-between transition-all cursor-pointer ${
                  immediate
                    ? 'border-[#5277D9] bg-[#EAF0FF]/40 ring-1 ring-[#5277D9]'
                    : 'border-[#E7E8EC] bg-white hover:bg-[#F7F6F2]'
                }`}
                data-testid="resend-mode-immediate"
              >
                <div className="flex items-center justify-between w-full mb-1">
                  <div className="flex items-center gap-1.5 font-semibold text-xs text-[#202938]">
                    <Zap className="w-3.5 h-3.5 text-[#B8871E]" />
                    <span>Immediate Execution</span>
                  </div>
                  {immediate && <CheckCircle2 className="w-4 h-4 text-[#5277D9]" />}
                </div>
                <p className="text-2xs text-[#64748B] leading-relaxed">
                  Safely claims a dispatch lease and executes the HTTP delivery attempt immediately.
                </p>
              </button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}
