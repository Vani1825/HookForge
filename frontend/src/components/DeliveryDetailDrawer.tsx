import React, { useState } from 'react'
import type { Delivery } from '../types'
import { Drawer } from './ui/Drawer'
import { StatusBadge } from './StatusBadge'
import { Button } from './ui/Button'
import { JsonViewer } from './ui/JsonViewer'
import {
  formatDateTime,
  formatRelativeTime,
  formatLatency,
  formatStatusCode,
  copyToClipboard,
} from '../utils/formatters'
import { Copy, RotateCw, ExternalLink, Check, AlertOctagon, Clock } from 'lucide-react'

interface DeliveryDetailDrawerProps {
  delivery: Delivery | null
  isOpen: boolean
  onClose: () => void
  onReplayRequest?: (delivery: Delivery) => void
  onCancelRequest?: (delivery: Delivery) => void
}

export const DeliveryDetailDrawer: React.FC<DeliveryDetailDrawerProps> = ({
  delivery,
  isOpen,
  onClose,
  onReplayRequest,
  onCancelRequest,
}) => {
  const [copiedId, setCopiedId] = useState(false)

  if (!delivery) return null

  const handleCopyId = async () => {
    const ok = await copyToClipboard(delivery.id)
    if (ok) {
      setCopiedId(true)
      setTimeout(() => setCopiedId(false), 2000)
    }
  }

  const attempts = delivery.attempts || []

  return (
    <Drawer
      isOpen={isOpen}
      onClose={onClose}
      title="Delivery Details"
      subtitle={`ID: ${delivery.id}`}
      width="xl"
      footer={
        <div className="flex items-center justify-between w-full">
          <Button variant="outline" size="sm" onClick={onClose}>
            Close
          </Button>
          <div className="flex items-center gap-2">
            {(delivery.state === 'SCHEDULED' || delivery.state === 'PENDING') && onCancelRequest && (
              <Button
                variant="outline"
                size="sm"
                className="text-[#E76B64] border-[#E76B64]/30 hover:bg-[#E76B64]/10"
                onClick={() => onCancelRequest(delivery)}
              >
                Cancel Scheduled
              </Button>
            )}
            {delivery.state === 'DEAD' && onReplayRequest && (
              <Button
                variant="danger"
                size="sm"
                leftIcon={<RotateCw className="w-3.5 h-3.5" />}
                onClick={() => onReplayRequest(delivery)}
              >
                Replay Dead Delivery
              </Button>
            )}
          </div>
        </div>
      }
    >
      {/* Status & Overview Bar */}
      <div className="flex items-center justify-between p-4 bg-[#F7F6F2] rounded-xl border border-[#E7E8EC]">
        <div>
          <span className="text-xs text-[#64748B] font-medium block">Current State</span>
          <div className="mt-1 flex items-center gap-2">
            <StatusBadge state={delivery.state} />
            <span className="text-xs text-[#64748B]">Attempt {delivery.attempt_count}</span>
          </div>
        </div>

        <button
          onClick={handleCopyId}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#202938] bg-white border border-[#E7E8EC] rounded-lg hover:bg-[#F7F6F2] shadow-2xs cursor-pointer"
        >
          {copiedId ? (
            <>
              <Check className="w-3.5 h-3.5 text-[#159B78]" />
              <span>Copied ID</span>
            </>
          ) : (
            <>
              <Copy className="w-3.5 h-3.5 text-[#64748B]" />
              <span>Copy Delivery ID</span>
            </>
          )}
        </button>
      </div>

      {/* Target & Sequence Information */}
      <div className="space-y-3">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-[#64748B]">
          Target & Ordering
        </h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
          <div className="p-3 bg-white rounded-lg border border-[#E7E8EC]">
            <span className="text-[#64748B] block mb-1">Destination Endpoint</span>
            <div className="flex items-center gap-1 font-mono text-[#202938] break-all font-semibold">
              <ExternalLink className="w-3.5 h-3.5 text-[#64748B] shrink-0" />
              <span>{delivery.endpoint_url || delivery.endpoint?.url || '—'}</span>
            </div>
          </div>

          <div className="p-3 bg-white rounded-lg border border-[#E7E8EC]">
            <span className="text-[#64748B] block mb-1">Per-Endpoint Sequence Number</span>
            <span className="font-mono text-[#202938] font-bold text-sm">
              #{delivery.seq}
            </span>
            <p className="text-2xs text-[#64748B] mt-0.5">Strict head-of-line ordering</p>
          </div>
        </div>
      </div>

      {/* Timestamps & Scheduling */}
      <div className="space-y-3">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-[#64748B]">
          Timing & Leases
        </h4>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
          <div className="p-2.5 bg-[#F7F6F2] rounded-lg border border-[#E7E8EC]/60">
            <span className="text-[#64748B] block">Created At</span>
            <span className="font-medium text-[#202938]">{formatDateTime(delivery.created_at)}</span>
          </div>
          <div className="p-2.5 bg-[#F7F6F2] rounded-lg border border-[#E7E8EC]/60">
            <span className="text-[#64748B] block">Last Updated</span>
            <span className="font-medium text-[#202938]">{formatRelativeTime(delivery.updated_at)}</span>
          </div>
          <div className="p-2.5 bg-[#F7F6F2] rounded-lg border border-[#E7E8EC]/60">
            <span className="text-[#64748B] block">Next Attempt</span>
            <span className="font-medium text-[#202938]">
              {delivery.state === 'DEAD' || delivery.state === 'SUCCEEDED'
                ? '—'
                : formatDateTime(delivery.next_attempt_at)}
            </span>
          </div>
          {(delivery.scheduled_at || delivery.scheduledAt) && (
            <div className="p-2.5 bg-[#F7F6F2] rounded-lg border border-[#E7E8EC]/60">
              <span className="text-[#64748B] block">Scheduled Execution</span>
              <span className="font-medium text-[#5277D9]">
                {formatDateTime(delivery.scheduled_at || delivery.scheduledAt!)}
              </span>
            </div>
          )}
        </div>
        {delivery.lease_until && (
          <div className="flex items-center gap-2 p-2 bg-[#EAF0FF] border border-[#DCE5FA] rounded-lg text-xs text-[#5277D9]">
            <Clock className="w-3.5 h-3.5 shrink-0" />
            <span>Active Worker Lease until: {formatDateTime(delivery.lease_until)}</span>
          </div>
        )}
      </div>

      {/* Last Error Message (if any) */}
      {delivery.last_error && (
        <div className="p-3.5 bg-[#E76B64]/10 border border-[#E76B64]/25 rounded-xl space-y-1 text-left">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-[#E76B64]">
            <AlertOctagon className="w-4 h-4 text-[#E76B64]" />
            <span>Failure Diagnostic</span>
          </div>
          <p className="text-xs text-[#E76B64] font-mono break-all">{delivery.last_error}</p>
        </div>
      )}

      {/* Attempt History */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-[#64748B]">
            Delivery Attempts ({attempts.length})
          </h4>
          <span className="text-2xs text-[#64748B]">Chronological execution order</span>
        </div>

        {attempts.length === 0 ? (
          <div className="text-center p-6 bg-[#F7F6F2] rounded-lg border border-[#E7E8EC] text-xs text-[#64748B]">
            No attempts executed yet. Delivery is currently {delivery.state}.
          </div>
        ) : (
          <div className="border border-[#E7E8EC] rounded-xl overflow-hidden divide-y divide-[#E7E8EC] bg-white">
            {attempts.map((att) => {
              const statusInfo = formatStatusCode(att.status_code)
              return (
                <div key={att.id} className="p-3 text-xs flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-[#202938]">
                      Attempt #{att.attempt_no}
                    </span>
                    <span className="text-[#64748B]">{formatDateTime(att.started_at)}</span>
                  </div>

                  <div className="flex items-center gap-3">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded text-2xs font-semibold border ${
                        statusInfo.category === 'success'
                          ? 'bg-[#159B78]/10 text-[#159B78] border-[#159B78]/25'
                          : statusInfo.category === 'client-error'
                          ? 'bg-[#E5B34B]/15 text-[#B8871E] border-[#E5B34B]/30'
                          : 'bg-[#E76B64]/10 text-[#E76B64] border-[#E76B64]/25'
                      }`}
                    >
                      {statusInfo.text}
                    </span>
                    <span className="text-[#64748B]">Latency: {formatLatency(att.latency_ms)}</span>
                  </div>

                  {att.error && (
                    <p className="text-2xs text-[#E76B64] font-mono bg-[#E76B64]/10 p-1.5 rounded mt-0.5 break-all">
                      {att.error}
                    </p>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Event Payload Preview */}
      {delivery.event?.payload && (
        <div className="space-y-2">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Event Payload Delivered
          </h4>
          <JsonViewer data={delivery.event.payload} maxHeight="max-h-60" />
        </div>
      )}
    </Drawer>
  )
}
