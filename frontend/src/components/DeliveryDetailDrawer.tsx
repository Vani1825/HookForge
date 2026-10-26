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
}

export const DeliveryDetailDrawer: React.FC<DeliveryDetailDrawerProps> = ({
  delivery,
  isOpen,
  onClose,
  onReplayRequest,
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
      }
    >
      {/* Status & Overview Bar */}
      <div className="flex items-center justify-between p-4 bg-slate-50 rounded-xl border border-slate-200">
        <div>
          <span className="text-xs text-slate-500 font-medium block">Current State</span>
          <div className="mt-1 flex items-center gap-2">
            <StatusBadge state={delivery.state} />
            <span className="text-xs text-slate-500">Attempt {delivery.attempt_count}</span>
          </div>
        </div>

        <button
          onClick={handleCopyId}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 shadow-2xs cursor-pointer"
        >
          {copiedId ? (
            <>
              <Check className="w-3.5 h-3.5 text-emerald-600" />
              <span>Copied ID</span>
            </>
          ) : (
            <>
              <Copy className="w-3.5 h-3.5 text-slate-400" />
              <span>Copy Delivery ID</span>
            </>
          )}
        </button>
      </div>

      {/* Target & Sequence Information */}
      <div className="space-y-3">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
          Target & Ordering
        </h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
          <div className="p-3 bg-white rounded-lg border border-slate-200">
            <span className="text-slate-400 block mb-1">Destination Endpoint</span>
            <div className="flex items-center gap-1 font-mono text-slate-800 break-all font-medium">
              <ExternalLink className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <span>{delivery.endpoint_url || delivery.endpoint?.url || '—'}</span>
            </div>
          </div>

          <div className="p-3 bg-white rounded-lg border border-slate-200">
            <span className="text-slate-400 block mb-1">Per-Endpoint Sequence Number</span>
            <span className="font-mono text-slate-800 font-bold text-sm">
              #{delivery.seq}
            </span>
            <p className="text-2xs text-slate-400 mt-0.5">Strict head-of-line ordering</p>
          </div>
        </div>
      </div>

      {/* Timestamps & Scheduling */}
      <div className="space-y-3">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
          Timing & Leases
        </h4>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
          <div className="p-2.5 bg-slate-50 rounded-lg">
            <span className="text-slate-400 block">Created At</span>
            <span className="font-medium text-slate-800">{formatDateTime(delivery.created_at)}</span>
          </div>
          <div className="p-2.5 bg-slate-50 rounded-lg">
            <span className="text-slate-400 block">Last Updated</span>
            <span className="font-medium text-slate-800">{formatRelativeTime(delivery.updated_at)}</span>
          </div>
          <div className="p-2.5 bg-slate-50 rounded-lg">
            <span className="text-slate-400 block">Next Attempt</span>
            <span className="font-medium text-slate-800">
              {delivery.state === 'DEAD' || delivery.state === 'SUCCEEDED'
                ? '—'
                : formatDateTime(delivery.next_attempt_at)}
            </span>
          </div>
        </div>
        {delivery.lease_until && (
          <div className="flex items-center gap-2 p-2 bg-indigo-50 border border-indigo-200 rounded-lg text-xs text-indigo-700">
            <Clock className="w-3.5 h-3.5 shrink-0" />
            <span>Active Worker Lease until: {formatDateTime(delivery.lease_until)}</span>
          </div>
        )}
      </div>

      {/* Last Error Message (if any) */}
      {delivery.last_error && (
        <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-xl space-y-1 text-left">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-rose-800">
            <AlertOctagon className="w-4 h-4 text-rose-600" />
            <span>Failure Diagnostic</span>
          </div>
          <p className="text-xs text-rose-700 font-mono break-all">{delivery.last_error}</p>
        </div>
      )}

      {/* Attempt History */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Delivery Attempts ({attempts.length})
          </h4>
          <span className="text-2xs text-slate-400">Chronological execution order</span>
        </div>

        {attempts.length === 0 ? (
          <div className="text-center p-6 bg-slate-50 rounded-lg border border-slate-200 text-xs text-slate-500">
            No attempts executed yet. Delivery is currently {delivery.state}.
          </div>
        ) : (
          <div className="border border-slate-200 rounded-xl overflow-hidden divide-y divide-slate-100 bg-white">
            {attempts.map((att) => {
              const statusInfo = formatStatusCode(att.status_code)
              return (
                <div key={att.id} className="p-3 text-xs flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-800">
                      Attempt #{att.attempt_no}
                    </span>
                    <span className="text-slate-400">{formatDateTime(att.started_at)}</span>
                  </div>

                  <div className="flex items-center gap-3">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded text-2xs font-medium ${
                        statusInfo.category === 'success'
                          ? 'bg-emerald-100 text-emerald-800'
                          : statusInfo.category === 'client-error'
                          ? 'bg-amber-100 text-amber-800'
                          : 'bg-rose-100 text-rose-800'
                      }`}
                    >
                      {statusInfo.text}
                    </span>
                    <span className="text-slate-500">Latency: {formatLatency(att.latency_ms)}</span>
                  </div>

                  {att.error && (
                    <p className="text-2xs text-rose-600 font-mono bg-rose-50/60 p-1.5 rounded mt-0.5 break-all">
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
