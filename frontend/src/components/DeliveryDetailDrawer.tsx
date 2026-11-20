import React, { useState, useEffect } from 'react'
import type { Delivery } from '../types'
import { Drawer } from './ui/Drawer'
import { StatusBadge } from './StatusBadge'
import { Button } from './ui/Button'
import { JsonViewer } from './ui/JsonViewer'
import { ConfirmationDialog } from './ui/ConfirmationDialog'
import { useApp } from '../context/AppContext'
import {
  formatDateTime,
  formatRelativeTime,
  formatLatency,
  formatStatusCode,
  copyToClipboard,
} from '../utils/formatters'
import {
  Copy,
  RotateCw,
  ExternalLink,
  Check,
  AlertOctagon,
  Clock,
  CheckCircle2,
  FileJson,
  Hash,
  Send,
  AlertTriangle,
} from 'lucide-react'

export interface DeliveryDetailDrawerProps {
  delivery: Delivery | null
  isOpen: boolean
  onClose: () => void
  onReplayRequest?: (delivery: Delivery) => void
  onReplaySuccess?: (updatedDelivery: Delivery) => void
  onCancelRequest?: (delivery: Delivery) => void
}

export const DeliveryDetailDrawer: React.FC<DeliveryDetailDrawerProps> = ({
  delivery: initialDelivery,
  isOpen,
  onClose,
  onReplayRequest,
  onReplaySuccess,
  onCancelRequest,
}) => {
  const { service, addToast } = useApp()

  const [delivery, setDelivery] = useState<Delivery | null>(initialDelivery)
  const [copiedDeliveryId, setCopiedDeliveryId] = useState(false)
  const [copiedEventId, setCopiedEventId] = useState(false)
  const [copiedPayload, setCopiedPayload] = useState(false)
  const [copiedError, setCopiedError] = useState(false)
  const [copiedEndpointUrl, setCopiedEndpointUrl] = useState(false)

  // Internal replay state for standalone / inline confirmation
  const [replayConfirmOpen, setReplayConfirmOpen] = useState(false)
  const [isReplaying, setIsReplaying] = useState(false)
  const [replayError, setReplayError] = useState<string | null>(null)

  useEffect(() => {
    setDelivery(initialDelivery)
    setReplayConfirmOpen(false)
    setReplayError(null)
  }, [initialDelivery])

  if (!delivery) return null

  const handleCopy = async (
    text: string,
    field: 'deliveryId' | 'eventId' | 'payload' | 'error' | 'endpointUrl'
  ) => {
    const ok = await copyToClipboard(text)
    if (ok) {
      if (field === 'deliveryId') {
        setCopiedDeliveryId(true)
        setTimeout(() => setCopiedDeliveryId(false), 2000)
      } else if (field === 'eventId') {
        setCopiedEventId(true)
        setTimeout(() => setCopiedEventId(false), 2000)
      } else if (field === 'payload') {
        setCopiedPayload(true)
        setTimeout(() => setCopiedPayload(false), 2000)
      } else if (field === 'error') {
        setCopiedError(true)
        setTimeout(() => setCopiedError(false), 2000)
      } else if (field === 'endpointUrl') {
        setCopiedEndpointUrl(true)
        setTimeout(() => setCopiedEndpointUrl(false), 2000)
      }
    }
  }

  const handleReplayClick = () => {
    if (delivery.state !== 'DEAD') return

    if (onReplayRequest) {
      onReplayRequest(delivery)
    } else {
      setReplayConfirmOpen(true)
    }
  }

  const handleInlineReplay = async () => {
    setIsReplaying(true)
    setReplayError(null)

    try {
      const res = await service.replayDelivery(delivery.id)
      if (res.success) {
        addToast({
          title: 'Replay Queued',
          description: `Delivery ${delivery.id} re-enqueued as PENDING.`,
          type: 'success',
        })

        // Fetch fresh details or construct updated delivery object
        let freshDelivery: Delivery = {
          ...delivery,
          state: 'PENDING',
          last_error: null,
          lastError: null,
          next_attempt_at: new Date().toISOString(),
          nextAttemptAt: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }

        try {
          const fetched = await service.getDeliveryById(delivery.id)
          if (fetched) {
            freshDelivery = fetched
          }
        } catch {
          // Fall back to constructed fresh delivery
        }

        setDelivery(freshDelivery)
        setReplayConfirmOpen(false)
        onReplaySuccess?.(freshDelivery)
      } else {
        setReplayError(res.message || 'Replay operation failed.')
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to replay delivery'
      setReplayError(msg)
    } finally {
      setIsReplaying(false)
    }
  }

  const attempts = delivery.attempts || []
  const lastAttempt = attempts.length > 0 ? attempts[attempts.length - 1] : null
  const lastAttemptTimestamp = lastAttempt?.started_at || (attempts.length > 0 ? delivery.updated_at : null)
  const eventId = delivery.event_id || delivery.eventId || delivery.event?.id
  const endpointUrl = delivery.endpoint_url || delivery.endpointUrl || delivery.endpoint?.url
  const lastStatusCode = delivery.last_status_code !== undefined ? delivery.last_status_code : delivery.lastStatusCode
  const lastStatusInfo = formatStatusCode(lastStatusCode)
  const lastErrorMsg = delivery.last_error || delivery.lastError
  const hasPayload = Boolean(delivery.event?.payload !== undefined && delivery.event?.payload !== null)
  const isEligibleForReplay = delivery.state === 'DEAD'

  return (
    <>
      <Drawer
        isOpen={isOpen}
        onClose={onClose}
        title="Delivery Inspector"
        subtitle={`ID: ${delivery.id}`}
        width="xl"
        footer={
          <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-between gap-2.5 w-full">
            <Button
              className="w-full sm:w-auto"
              variant="outline"
              size="sm"
              onClick={onClose}
            >
              Close
            </Button>

            <div className="flex items-center gap-2 justify-end">
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

              {isEligibleForReplay ? (
                <Button
                  className="w-full sm:w-auto"
                  variant="danger"
                  size="sm"
                  leftIcon={<RotateCw className="w-3.5 h-3.5" />}
                  onClick={handleReplayClick}
                  disabled={isReplaying}
                  isLoading={isReplaying}
                >
                  Replay Delivery
                </Button>
              ) : (
                <span className="text-2xs text-[#64748B] text-center sm:text-right">
                  {delivery.state === 'SUCCEEDED'
                    ? 'Delivered successfully • Replay not required'
                    : delivery.state === 'IN_FLIGHT' || delivery.state === 'RETRYING'
                    ? 'Active delivery • Managed by retry scheduler'
                    : delivery.state === 'CANCELLED'
                    ? 'Scheduled delivery was cancelled'
                    : 'Pending dispatch in queue'}
                </span>
              )}
            </div>
          </div>
        }
      >
        <div className="space-y-5 text-left">
          {/* Section 1: Delivery Status & State Indicator */}
          <div className="p-3.5 sm:p-4 bg-[#F7F6F2] rounded-xl border border-[#E7E8EC] space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <span className="text-xs text-[#64748B] font-medium block">Delivery Status</span>
                <div className="mt-1 flex items-center gap-2">
                  <StatusBadge state={delivery.state} />
                  <span className="text-xs text-[#64748B] font-semibold">
                    Attempt {delivery.attempt_count ?? delivery.attemptCount ?? 0}
                  </span>
                </div>
              </div>

              <button
                type="button"
                onClick={() => handleCopy(delivery.id, 'deliveryId')}
                className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#202938] bg-white border border-[#E7E8EC] rounded-lg hover:bg-[#F7F6F2] shadow-2xs cursor-pointer self-start sm:self-auto transition-colors"
                aria-label="Copy Delivery ID"
              >
                {copiedDeliveryId ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-[#159B78]" />
                    <span className="text-[#159B78] font-semibold">Copied ID</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5 text-[#64748B]" />
                    <span>Copy Delivery ID</span>
                  </>
                )}
              </button>
            </div>

            {/* Explanatory State Banner */}
            <div
              className={`p-2.5 rounded-lg border text-xs flex items-center gap-2 ${
                delivery.state === 'SUCCEEDED'
                  ? 'bg-[#159B78]/10 border-[#159B78]/25 text-[#159B78]'
                  : delivery.state === 'DEAD'
                  ? 'bg-[#E76B64]/10 border-[#E76B64]/25 text-[#E76B64]'
                  : delivery.state === 'RETRYING'
                  ? 'bg-[#E5B34B]/15 border-[#E5B34B]/30 text-[#B8871E]'
                  : delivery.state === 'IN_FLIGHT'
                  ? 'bg-[#EAF0FF] border-[#DCE5FA] text-[#5277D9]'
                  : delivery.state === 'SCHEDULED'
                  ? 'bg-[#EAF0FF] border-[#DCE5FA] text-[#5277D9]'
                  : delivery.state === 'CANCELLED'
                  ? 'bg-[#E76B64]/10 border-[#E76B64]/25 text-[#E76B64]'
                  : 'bg-white border-[#E7E8EC] text-[#64748B]'
              }`}
            >
              {delivery.state === 'SUCCEEDED' ? (
                <CheckCircle2 className="w-4 h-4 shrink-0 text-[#159B78]" />
              ) : delivery.state === 'DEAD' || delivery.state === 'CANCELLED' ? (
                <AlertOctagon className="w-4 h-4 shrink-0 text-[#E76B64]" />
              ) : delivery.state === 'RETRYING' ? (
                <RotateCw className="w-4 h-4 shrink-0 text-[#B8871E]" />
              ) : (
                <Clock className="w-4 h-4 shrink-0 text-[#5277D9]" />
              )}
              <span className="font-medium">
                {delivery.state === 'SUCCEEDED'
                  ? 'Delivery Succeeded — The webhook was acknowledged with a 2xx HTTP response.'
                  : delivery.state === 'DEAD'
                  ? 'Dead Letter Queue — Retry budget exhausted. Eligible for manual replay.'
                  : delivery.state === 'RETRYING'
                  ? 'Retrying — Scheduled for automatic retry with exponential backoff.'
                  : delivery.state === 'IN_FLIGHT'
                  ? 'In Flight — Leased by worker and awaiting HTTP response.'
                  : delivery.state === 'SCHEDULED'
                  ? 'Scheduled — Queued for future delivery execution.'
                  : delivery.state === 'CANCELLED'
                  ? 'Cancelled — Scheduled delivery cancelled before dispatch.'
                  : 'Pending — Enqueued in work queue awaiting dispatcher worker.'}
              </span>
            </div>
          </div>

          {/* Section 2: Identifiers & Target Endpoint */}
          <div className="space-y-3">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-[#64748B]">
              Routing & Identifiers
            </h4>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              {/* Event ID Card */}
              <div className="p-3 bg-white rounded-xl border border-[#E7E8EC] space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[#64748B] font-medium flex items-center gap-1">
                    <Hash className="w-3.5 h-3.5 text-[#64748B]" />
                    Associated Event ID
                  </span>
                  {eventId && (
                    <button
                      type="button"
                      onClick={() => handleCopy(eventId, 'eventId')}
                      className="text-[#64748B] hover:text-[#202938] inline-flex items-center gap-1 text-2xs cursor-pointer"
                      aria-label="Copy Event ID"
                    >
                      {copiedEventId ? (
                        <>
                          <Check className="w-3 h-3 text-[#159B78]" />
                          <span className="text-[#159B78] font-semibold">Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3 h-3" />
                          <span>Copy</span>
                        </>
                      )}
                    </button>
                  )}
                </div>
                <div className="font-mono text-[#202938] font-semibold break-all text-xs">
                  {eventId || '—'}
                </div>
                {delivery.event?.event_type && (
                  <div className="pt-1 border-t border-[#E7E8EC] flex items-center justify-between text-2xs">
                    <span className="text-[#64748B]">Event Type:</span>
                    <span className="font-semibold text-[#5277D9] bg-[#EAF0FF] px-2 py-0.5 rounded">
                      {delivery.event.event_type}
                    </span>
                  </div>
                )}
                {delivery.event?.idempotency_key && (
                  <div className="pt-1 border-t border-[#E7E8EC] text-2xs space-y-0.5">
                    <span className="text-[#64748B] block">Idempotency Key:</span>
                    <span className="font-mono text-[#202938] font-medium break-all block">
                      {delivery.event.idempotency_key}
                    </span>
                  </div>
                )}
              </div>

              {/* Destination Endpoint Card */}
              <div className="p-3 bg-white rounded-xl border border-[#E7E8EC] space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[#64748B] font-medium flex items-center gap-1">
                    <Send className="w-3.5 h-3.5 text-[#64748B]" />
                    Destination Endpoint
                  </span>
                  {endpointUrl && (
                    <button
                      type="button"
                      onClick={() => handleCopy(endpointUrl, 'endpointUrl')}
                      className="text-[#64748B] hover:text-[#202938] inline-flex items-center gap-1 text-2xs cursor-pointer"
                      aria-label="Copy Endpoint URL"
                    >
                      {copiedEndpointUrl ? (
                        <>
                          <Check className="w-3 h-3 text-[#159B78]" />
                          <span className="text-[#159B78] font-semibold">Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3 h-3" />
                          <span>Copy URL</span>
                        </>
                      )}
                    </button>
                  )}
                </div>

                <div className="flex items-start gap-1.5 font-mono text-[#202938] break-all font-semibold text-xs">
                  <span className="px-1.5 py-0.5 rounded text-3xs font-mono font-bold bg-[#EAF0FF] text-[#5277D9] border border-[#DCE5FA] shrink-0 mt-0.5">
                    POST
                  </span>
                  <span className="flex-1 min-w-0">{endpointUrl || '—'}</span>
                  {endpointUrl && (
                    <a
                      href={endpointUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[#64748B] hover:text-[#5277D9] shrink-0"
                      title="Open endpoint URL"
                      aria-label="Open endpoint URL in new tab"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  )}
                </div>

                {delivery.endpoint?.description && (
                  <p className="text-2xs text-[#64748B]">{delivery.endpoint.description}</p>
                )}

                <div className="pt-1.5 border-t border-[#E7E8EC] flex items-center justify-between text-2xs">
                  <span className="text-[#64748B]">Per-Endpoint Sequence:</span>
                  <span className="font-mono font-bold text-[#202938]">#{delivery.seq}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Section 3: Timestamps & Scheduling */}
          <div className="space-y-3">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-[#64748B]">
              Timing & Schedule
            </h4>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
              <div className="p-2.5 bg-[#F7F6F2] rounded-lg border border-[#E7E8EC]">
                <span className="text-[#64748B] block text-2xs">Created At</span>
                <span className="font-medium text-[#202938] block truncate">
                  {formatDateTime(delivery.created_at || delivery.createdAt)}
                </span>
              </div>

              <div className="p-2.5 bg-[#F7F6F2] rounded-lg border border-[#E7E8EC]">
                <span className="text-[#64748B] block text-2xs">Last Attempt</span>
                <span className="font-medium text-[#202938] block truncate">
                  {formatDateTime(lastAttemptTimestamp)}
                </span>
              </div>

              <div className="p-2.5 bg-[#F7F6F2] rounded-lg border border-[#E7E8EC]">
                <span className="text-[#64748B] block text-2xs">Last Updated</span>
                <span className="font-medium text-[#202938] block truncate">
                  {formatRelativeTime(delivery.updated_at || delivery.updatedAt)}
                </span>
              </div>

              <div className="p-2.5 bg-[#F7F6F2] rounded-lg border border-[#E7E8EC]">
                <span className="text-[#64748B] block text-2xs">Next Attempt</span>
                <span className="font-medium text-[#202938] block truncate">
                  {delivery.state === 'DEAD' || delivery.state === 'SUCCEEDED'
                    ? '—'
                    : formatDateTime(delivery.next_attempt_at || delivery.nextAttemptAt)}
                </span>
              </div>
            </div>

            {(delivery.scheduled_at || delivery.scheduledAt) && (
              <div className="p-2.5 bg-[#EAF0FF] border border-[#DCE5FA] rounded-lg text-xs text-[#5277D9] flex items-center justify-between">
                <span className="font-medium">Scheduled Execution:</span>
                <span className="font-semibold font-mono">
                  {formatDateTime(delivery.scheduled_at || delivery.scheduledAt!)}
                </span>
              </div>
            )}

            {delivery.lease_until && (
              <div className="flex items-center gap-2 p-2.5 bg-[#EAF0FF] border border-[#DCE5FA] rounded-lg text-xs text-[#5277D9]">
                <Clock className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">
                  Active Worker Lease until: {formatDateTime(delivery.lease_until)}
                </span>
              </div>
            )}
          </div>

          {/* Section 4: Request Payload (Formatted JSON) */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <FileJson className="w-4 h-4 text-[#5277D9]" />
                <h4 className="text-xs font-semibold uppercase tracking-wider text-[#64748B]">
                  Request Payload (HTTP POST)
                </h4>
              </div>

              {hasPayload && (
                <button
                  type="button"
                  onClick={() =>
                    handleCopy(
                      JSON.stringify(delivery.event?.payload, null, 2),
                      'payload'
                    )
                  }
                  className="inline-flex items-center gap-1 text-2xs font-medium text-[#5277D9] hover:text-[#4366C4] cursor-pointer"
                  aria-label="Copy Payload JSON"
                >
                  {copiedPayload ? (
                    <>
                      <Check className="w-3 h-3 text-[#159B78]" />
                      <span className="text-[#159B78] font-semibold">Copied Payload</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3 h-3" />
                      <span>Copy Payload</span>
                    </>
                  )}
                </button>
              )}
            </div>

            {hasPayload ? (
              <div className="overflow-x-auto rounded-lg border border-[#E7E8EC]">
                <JsonViewer
                  data={delivery.event!.payload}
                  maxHeight="max-h-60"
                  title="Webhook Payload (JSON)"
                />
              </div>
            ) : (
              <div className="p-4 bg-[#F7F6F2] rounded-lg border border-[#E7E8EC] text-center text-xs text-[#64748B]">
                No request payload recorded for this delivery event.
              </div>
            )}
          </div>

          {/* Section 5: HTTP Response & Diagnostic */}
          <div className="space-y-2.5">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-[#64748B]">
              Response & Diagnostics
            </h4>

            <div className="p-3.5 bg-white rounded-xl border border-[#E7E8EC] space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-[#64748B] font-medium">HTTP Status Code:</span>
                  <span
                    className={`inline-flex items-center px-2 py-0.5 rounded text-2xs font-semibold border ${
                      lastStatusInfo.category === 'success'
                        ? 'bg-[#159B78]/10 text-[#159B78] border-[#159B78]/25'
                        : lastStatusInfo.category === 'client-error'
                        ? 'bg-[#E5B34B]/15 text-[#B8871E] border-[#E5B34B]/30'
                        : 'bg-[#E76B64]/10 text-[#E76B64] border-[#E76B64]/25'
                    }`}
                  >
                    {lastStatusInfo.text}
                  </span>
                </div>

                {lastStatusCode && (
                  <span className="text-2xs text-[#64748B]">
                    Status: {lastStatusCode}
                  </span>
                )}
              </div>

              {/* Diagnostic Box or Success Confirmation */}
              {lastErrorMsg ? (
                <div className="p-3 bg-[#E76B64]/10 border border-[#E76B64]/25 rounded-lg space-y-1.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-[#E76B64]">
                      <AlertOctagon className="w-3.5 h-3.5 text-[#E76B64] shrink-0" />
                      <span>Failure Diagnostic Reason</span>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleCopy(lastErrorMsg, 'error')}
                      className="text-2xs text-[#E76B64] hover:underline inline-flex items-center gap-1 cursor-pointer"
                      aria-label="Copy Failure Diagnostic"
                    >
                      {copiedError ? (
                        <>
                          <Check className="w-3 h-3 text-[#159B78]" />
                          <span className="text-[#159B78] font-semibold">Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3 h-3" />
                          <span>Copy Diagnostic</span>
                        </>
                      )}
                    </button>
                  </div>
                  <p className="text-xs font-mono text-[#E76B64] break-all leading-relaxed">
                    {lastErrorMsg}
                  </p>
                </div>
              ) : delivery.state === 'SUCCEEDED' ? (
                <div className="p-3 bg-[#159B78]/10 border border-[#159B78]/25 rounded-lg text-xs text-[#159B78] flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 shrink-0 text-[#159B78]" />
                  <span>
                    Endpoint returned a 2xx success response code. Delivery acknowledged and completed.
                  </span>
                </div>
              ) : (
                <p className="text-xs text-[#64748B]">
                  No error diagnostic recorded. Current status is {delivery.state}.
                </p>
              )}
            </div>
          </div>

          {/* Section 6: Delivery Attempt History */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-[#64748B]">
                Delivery Attempt History ({attempts.length})
              </h4>
              <span className="text-2xs text-[#64748B]">Chronological order</span>
            </div>

            {attempts.length === 0 ? (
              <div className="text-center p-6 bg-[#F7F6F2] rounded-xl border border-[#E7E8EC] text-xs text-[#64748B]">
                No delivery attempts executed yet. Delivery is currently {delivery.state}.
              </div>
            ) : (
              <div className="border border-[#E7E8EC] rounded-xl overflow-hidden divide-y divide-[#E7E8EC] bg-white">
                {attempts.map((att) => {
                  const statusInfo = formatStatusCode(att.status_code)
                  return (
                    <div key={att.id} className="p-3.5 text-xs flex flex-col gap-2">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-[#202938]">
                            Attempt #{att.attempt_no}
                          </span>
                          <span className="text-3xs px-2 py-0.5 rounded font-medium bg-[#F7F6F2] text-[#64748B] border border-[#E7E8EC]">
                            {att.attempt_no === 1 ? 'Initial Attempt' : 'Automatic Retry'}
                          </span>
                        </div>
                        <span className="text-[#64748B] text-2xs">
                          {formatDateTime(att.started_at)}
                        </span>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 sm:gap-3">
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
                        <span className="text-[#64748B]">
                          Latency: {formatLatency(att.latency_ms)}
                        </span>
                      </div>

                      {att.error && (
                        <p className="text-2xs text-[#E76B64] font-mono bg-[#E76B64]/10 p-2 rounded-lg border border-[#E76B64]/20 break-all leading-snug">
                          {att.error}
                        </p>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </Drawer>

      {/* Inline Confirmation Dialog for Standalone Replay */}
      {replayConfirmOpen && (
        <ConfirmationDialog
          isOpen={replayConfirmOpen}
          onClose={() => setReplayConfirmOpen(false)}
          onConfirm={handleInlineReplay}
          title="Confirm Delivery Replay"
          description="Re-enqueue an exhausted dead-letter delivery back into the dispatch pipeline."
          confirmText="Confirm & Replay"
          cancelText="Cancel"
          variant="warning"
          isLoading={isReplaying}
          error={replayError}
          icon={<RotateCw className="w-5 h-5 text-[#B48418]" />}
        >
          <div className="space-y-3.5 text-left">
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

            <div className="p-3 bg-[#F7F6F2] border border-[#E7E8EC] rounded-xl space-y-1.5 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[#64748B] shrink-0">Delivery ID:</span>
                <span className="font-mono text-[#202938] font-semibold truncate">{delivery.id}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[#64748B] shrink-0">Endpoint:</span>
                <span className="font-mono text-[#202938] truncate max-w-[180px] sm:max-w-xs">
                  {endpointUrl || '—'}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[#64748B] shrink-0">Attempts Exhausted:</span>
                <span className="font-semibold text-[#E76B64]">
                  {delivery.attempt_count ?? delivery.attemptCount ?? 0} attempts
                </span>
              </div>
              {lastErrorMsg && (
                <div className="pt-1.5 border-t border-[#E7E8EC]">
                  <span className="text-[#64748B] block mb-0.5">Last Error:</span>
                  <span className="font-mono text-3xs text-[#E76B64] break-all leading-snug">
                    {lastErrorMsg}
                  </span>
                </div>
              )}
            </div>
          </div>
        </ConfirmationDialog>
      )}
    </>
  )
}
