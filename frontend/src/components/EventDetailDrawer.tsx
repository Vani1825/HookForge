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
          <Button className="w-full sm:w-auto" variant="outline" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      }
    >
      {/* Event Header metadata */}
      <div className="p-3.5 sm:p-4 bg-[#F7F6F2] rounded-xl border border-[#E7E8EC] space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-semibold px-2.5 py-0.5 rounded bg-[#EAF0FF] text-[#5277D9] border border-[#DCE5FA] font-mono">
            {event.event_type || 'custom.event'}
          </span>
          <span className="text-xs text-[#64748B]">{formatDateTime(event.created_at)}</span>
        </div>

        <div className="space-y-1.5 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-1">
            <span className="text-[#64748B]">Event ID:</span>
            <button
              onClick={handleCopyId}
              className="inline-flex items-center gap-1 font-mono text-[#202938] hover:text-[#5277D9] cursor-pointer"
            >
              <span>{truncateId(event.id, 12)}</span>
              {copiedId ? <Check className="w-3 h-3 text-[#159B78]" /> : <Copy className="w-3 h-3 text-[#64748B]" />}
            </button>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-1">
            <span className="text-[#64748B]">Idempotency Key:</span>
            <button
              onClick={handleCopyKey}
              className="inline-flex items-center gap-1 font-mono text-[#202938] hover:text-[#5277D9] cursor-pointer truncate max-w-[200px] sm:max-w-none"
            >
              <span className="truncate">{event.idempotency_key}</span>
              {copiedKey ? <Check className="w-3 h-3 text-[#159B78] shrink-0" /> : <Copy className="w-3 h-3 text-[#64748B] shrink-0" />}
            </button>
          </div>
        </div>
      </div>

      {/* JSON Payload */}
      <div className="space-y-2">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-[#64748B]">
          Event Body (JSON Payload)
        </h4>
        <JsonViewer data={event.payload} maxHeight="max-h-80" />
      </div>

      {/* Associated Fan-out Deliveries */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-1">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-[#64748B]">
            Enqueued Deliveries ({relatedDeliveries.length})
          </h4>
          <span className="text-2xs text-[#64748B]">Atomic fan-out per endpoint</span>
        </div>

        {relatedDeliveries.length === 0 ? (
          <div className="p-4 rounded-lg bg-[#F7F6F2] border border-[#E7E8EC] text-xs text-[#64748B] text-center">
            No active deliveries recorded for this event.
          </div>
        ) : (
          <div className="border border-[#E7E8EC] rounded-xl overflow-hidden divide-y divide-[#E7E8EC] bg-white">
            {relatedDeliveries.map((del) => (
              <div
                key={del.id}
                className="p-3 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2 hover:bg-[#F7F6F2] transition-colors"
              >
                <div className="min-w-0 pr-2">
                  <div className="font-mono text-[#202938] truncate font-semibold">
                    {del.endpoint_url || del.endpoint_id}
                  </div>
                  <div className="flex items-center gap-2 mt-1 text-2xs text-[#64748B]">
                    <span>Seq #{del.seq}</span>
                    <span>&bull;</span>
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
