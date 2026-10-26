import React, { useState } from 'react'
import type { WebhookEvent, Delivery } from '../types'
import { Drawer } from './ui/Drawer'
import { Button } from './ui/Button'
import { JsonViewer } from './ui/JsonViewer'
import { StatusBadge } from './StatusBadge'
import { formatDateTime, copyToClipboard, truncateId } from '../utils/formatters'
import { Copy, Check } from 'lucide-react'

interface EventDetailDrawerProps {
  event: WebhookEvent | null
  deliveries?: Delivery[]
  isOpen: boolean
  onClose: () => void
  onInspectDelivery?: (delivery: Delivery) => void
}

export const EventDetailDrawer: React.FC<EventDetailDrawerProps> = ({
  event,
  deliveries = [],
  isOpen,
  onClose,
  onInspectDelivery,
}) => {
  const [copiedId, setCopiedId] = useState(false)
  const [copiedKey, setCopiedKey] = useState(false)

  if (!event) return null

  const handleCopyId = async () => {
    const ok = await copyToClipboard(event.id)
    if (ok) {
      setCopiedId(true)
      setTimeout(() => setCopiedId(false), 2000)
    }
  }

  const handleCopyKey = async () => {
    const ok = await copyToClipboard(event.idempotency_key)
    if (ok) {
      setCopiedKey(true)
      setTimeout(() => setCopiedKey(false), 2000)
    }
  }

  const relatedDeliveries = deliveries.filter((d) => d.event_id === event.id)

  return (
    <Drawer
      isOpen={isOpen}
      onClose={onClose}
      title="Event Inspection"
      subtitle={`ID: ${event.id}`}
      width="xl"
      footer={
        <div className="flex items-center justify-end w-full">
          <Button variant="outline" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      }
    >
      {/* Event Header metadata */}
      <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold px-2 py-0.5 rounded bg-slate-200 text-slate-800 font-mono">
            {event.event_type || 'custom.event'}
          </span>
          <span className="text-xs text-slate-500">{formatDateTime(event.created_at)}</span>
        </div>

        <div className="space-y-1.5 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-slate-500">Event ID:</span>
            <button
              onClick={handleCopyId}
              className="inline-flex items-center gap-1 font-mono text-slate-700 hover:text-slate-900 cursor-pointer"
            >
              <span>{truncateId(event.id, 12)}</span>
              {copiedId ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3 text-slate-400" />}
            </button>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-slate-500">Idempotency Key:</span>
            <button
              onClick={handleCopyKey}
              className="inline-flex items-center gap-1 font-mono text-slate-700 hover:text-slate-900 cursor-pointer"
            >
              <span>{event.idempotency_key}</span>
              {copiedKey ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3 text-slate-400" />}
            </button>
          </div>
        </div>
      </div>

      {/* JSON Payload */}
      <div className="space-y-2">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
          Event Body (JSON Payload)
        </h4>
        <JsonViewer data={event.payload} maxHeight="max-h-80" />
      </div>

      {/* Associated Fan-out Deliveries */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Enqueued Deliveries ({relatedDeliveries.length})
          </h4>
          <span className="text-2xs text-slate-400">Atomic fan-out per endpoint</span>
        </div>

        {relatedDeliveries.length === 0 ? (
          <div className="p-4 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-500 text-center">
            No active deliveries recorded for this event.
          </div>
        ) : (
          <div className="border border-slate-200 rounded-xl overflow-hidden divide-y divide-slate-100 bg-white">
            {relatedDeliveries.map((del) => (
              <div
                key={del.id}
                className="p-3 text-xs flex items-center justify-between hover:bg-slate-50 transition-colors"
              >
                <div className="min-w-0 pr-3">
                  <div className="font-mono text-slate-800 truncate font-medium">
                    {del.endpoint_url || del.endpoint_id}
                  </div>
                  <div className="flex items-center gap-2 mt-1 text-2xs text-slate-400">
                    <span>Seq #{del.seq}</span>
                    <span>•</span>
                    <span>Attempts: {del.attempt_count}</span>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <StatusBadge state={del.state} />
                  {onInspectDelivery && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onInspectDelivery(del)}
                      className="text-xs"
                    >
                      Inspect
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Drawer>
  )
}
