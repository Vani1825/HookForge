import React, { useState, useEffect } from 'react'
import type { Delivery, DeliveryAttempt, DeliveryLogEntry, DeliveryDiagnostics, ResendDeliveryResult } from '../types'
import { Drawer } from './ui/Drawer'
import { StatusBadge } from './StatusBadge'
import { Button } from './ui/Button'
import { JsonViewer } from './ui/JsonViewer'
import { ConfirmationDialog } from './ui/ConfirmationDialog'
import { ResendModal } from './ResendModal'
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
  Layers,
  FileText,
  Terminal,
  Activity,
  ChevronDown,
  ChevronRight,
  RefreshCw,
} from 'lucide-react'

export interface DeliveryDetailDrawerProps {
  delivery: Delivery | null
  isOpen: boolean
  onClose: () => void
  onReplayRequest?: (delivery: Delivery) => void
  onReplaySuccess?: (updatedDelivery: Delivery) => void
  onCancelRequest?: (delivery: Delivery) => void
  onResendSuccess?: (updatedDelivery?: Delivery) => void
}

type TabType = 'overview' | 'payload' | 'attempts' | 'logs'

export const DeliveryDetailDrawer: React.FC<DeliveryDetailDrawerProps> = ({
  delivery: initialDelivery,
  isOpen,
  onClose,
  onReplayRequest,
  onReplaySuccess,
  onCancelRequest,
  onResendSuccess,
}) => {
  const { service, addToast } = useApp()

  const [delivery, setDelivery] = useState<Delivery | null>(initialDelivery)
  const [activeTab, setActiveTab] = useState<TabType>('overview')

  const [copiedDeliveryId, setCopiedDeliveryId] = useState(false)
  const [copiedEventId, setCopiedEventId] = useState(false)
  const [copiedPayload, setCopiedPayload] = useState(false)
  const [copiedError, setCopiedError] = useState(false)
  const [copiedEndpointUrl, setCopiedEndpointUrl] = useState(false)

  // Resend state
  const [resendModalOpen, setResendModalOpen] = useState(false)

  // Internal replay state for standalone / inline confirmation
  const [replayConfirmOpen, setReplayConfirmOpen] = useState(false)
  const [isReplaying, setIsReplaying] = useState(false)
  const [replayError, setReplayError] = useState<string | null>(null)

  // Attempts state
  const [attemptsData, setAttemptsData] = useState<DeliveryAttempt[]>([])
  const [isLoadingAttempts, setIsLoadingAttempts] = useState(false)
  const [attemptsError, setAttemptsError] = useState<string | null>(null)
  const [expandedAttemptIds, setExpandedAttemptIds] = useState<Record<string | number, boolean>>({})

  // Logs state
  const [logsData, setLogsData] = useState<DeliveryLogEntry[]>([])
  const [isLoadingLogs, setIsLoadingLogs] = useState(false)
  const [logsError, setLogsError] = useState<string | null>(null)
  const [diagnosticsData, setDiagnosticsData] = useState<DeliveryDiagnostics | undefined>(undefined)

  useEffect(() => {
    setDelivery(initialDelivery)
    setReplayConfirmOpen(false)
    setReplayError(null)
  }, [initialDelivery])

  const activeDelivery = delivery || initialDelivery
  const deliveryId = activeDelivery?.id

  // Load detailed attempts and logs when drawer opens
  useEffect(() => {
    if (!isOpen || !deliveryId) {
      setAttemptsData([])
      setLogsData([])
      setDiagnosticsData(undefined)
      setActiveTab('overview')
      return
    }

    let isMounted = true

    // Initial seed from delivery object if present
    if (activeDelivery?.attempts) {
      setAttemptsData(activeDelivery.attempts)
    }
    if (activeDelivery?.diagnostics) {
      setDiagnosticsData(activeDelivery.diagnostics)
    }

    const fetchAttempts = async () => {
      setIsLoadingAttempts(true)
      setAttemptsError(null)
      try {
        const res = await service.getDeliveryAttempts(deliveryId)
        if (isMounted) {
          if (res?.attempts && res.attempts.length > 0) {
            setAttemptsData(res.attempts)
          } else if (activeDelivery?.attempts && activeDelivery.attempts.length > 0) {
            setAttemptsData(activeDelivery.attempts)
          } else {
            setAttemptsData([])
          }
        }
      } catch {
        if (isMounted) {
          if (!activeDelivery?.attempts || activeDelivery.attempts.length === 0) {
            setAttemptsError('Failed to fetch detailed attempts history.')
          }
        }
      } finally {
        if (isMounted) setIsLoadingAttempts(false)
      }
    }

    const fetchLogs = async () => {
      setIsLoadingLogs(true)
      setLogsError(null)
      try {
        const res = await service.getDeliveryLogs(deliveryId)
        if (isMounted) {
          if (res?.logs && res.logs.length > 0) {
            setLogsData(res.logs)
            if (res.diagnostics) {
              setDiagnosticsData(res.diagnostics)
            }
          } else {
            // Fallback logs from delivery if delivery is not in mockStore
            const fallbackLogs: DeliveryLogEntry[] = [
              {
                timestamp: activeDelivery?.created_at || new Date().toISOString(),
                level: 'INFO',
                event: 'DELIVERY_CREATED',
                message: `Delivery created and queued in state ${activeDelivery?.state || 'PENDING'}`,
              },
            ]
            if (activeDelivery?.attempts && activeDelivery.attempts.length > 0) {
              activeDelivery.attempts.forEach((att) => {
                const code = att.status_code ?? att.statusCode
                const num = att.attempt_no ?? att.attemptNumber ?? 1
                fallbackLogs.push({
                  timestamp: att.started_at,
                  level: code && code >= 200 && code < 300 ? 'INFO' : 'ERROR',
                  event:
                    code && code >= 200 && code < 300
                      ? 'DISPATCH_ATTEMPT_SUCCEEDED'
                      : 'DISPATCH_ATTEMPT_FAILED',
                  message: `Attempt ${num} executed with status ${code || 'TIMEOUT'}`,
                  statusCode: code || null,
                  attemptNumber: num,
                })
              })
            }
            setLogsData(fallbackLogs)
          }
        }
      } catch {
        if (isMounted) {
          setLogsError('Failed to fetch diagnostic execution logs.')
        }
      } finally {
        if (isMounted) setIsLoadingLogs(false)
      }
    }

    fetchAttempts()
    fetchLogs()

    return () => {
      isMounted = false
    }
  }, [isOpen, deliveryId, service, activeDelivery?.attempts, activeDelivery?.diagnostics])

  const handleResendSuccess = async (result: ResendDeliveryResult) => {
    if (result.delivery) {
      setDelivery(result.delivery)
    }
    if (deliveryId) {
      try {
        const updated = await service.getDeliveryById(deliveryId)
        if (updated) setDelivery(updated)
        const atts = await service.getDeliveryAttempts(deliveryId)
        if (atts?.attempts) setAttemptsData(atts.attempts)
        const logs = await service.getDeliveryLogs(deliveryId)
        if (logs?.logs) {
          setLogsData(logs.logs)
          if (logs.diagnostics) setDiagnosticsData(logs.diagnostics)
        }
      } catch {
        // Fallback
      }
    }
    onResendSuccess?.(result.delivery)
  }

  if (!activeDelivery) return null

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
    if (activeDelivery.state !== 'DEAD') return

    if (onReplayRequest) {
      onReplayRequest(activeDelivery)
    } else {
      setReplayConfirmOpen(true)
    }
  }

  const handleInlineReplay = async () => {
    setIsReplaying(true)
    setReplayError(null)

    try {
      const res = await service.replayDelivery(activeDelivery.id)
      if (res.success) {
        addToast({
          title: 'Replay Queued',
          description: `Delivery ${activeDelivery.id} re-enqueued as PENDING.`,
          type: 'success',
        })

        // Fetch fresh details or construct updated delivery object
        let freshDelivery: Delivery = {
          ...activeDelivery,
          state: 'PENDING',
          last_error: null,
          lastError: null,
          next_attempt_at: new Date().toISOString(),
          nextAttemptAt: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }

        try {
          const fetched = await service.getDeliveryById(activeDelivery.id)
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

  const toggleAttemptExpand = (id: string | number) => {
    setExpandedAttemptIds((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  const attempts = activeDelivery.attempts || attemptsData || []
  const lastAttempt = attempts.length > 0 ? attempts[attempts.length - 1] : null
  const lastAttemptTimestamp = lastAttempt?.started_at || (attempts.length > 0 ? activeDelivery.updated_at : null)
  const eventId = activeDelivery.event_id || (activeDelivery as any).eventId || activeDelivery.event?.id
  const endpointUrl = activeDelivery.endpoint_url || (activeDelivery as any).endpointUrl || activeDelivery.endpoint?.url
  const lastStatusCode = activeDelivery.last_status_code !== undefined ? activeDelivery.last_status_code : (activeDelivery as any).lastStatusCode
  const lastErrorMsg = activeDelivery.last_error || (activeDelivery as any).lastError
  const hasPayload = Boolean(activeDelivery.event?.payload !== undefined && activeDelivery.event?.payload !== null)
  const isEligibleForReplay = activeDelivery.state === 'DEAD'
  const isResendEligible =
    activeDelivery.state === 'DEAD' ||
    activeDelivery.state === 'SUCCEEDED' ||
    activeDelivery.state === 'CANCELLED'
  const effectiveDiagnostics = diagnosticsData || activeDelivery.diagnostics
  const retryPolicy = activeDelivery.retry || activeDelivery.endpoint?.retryPolicy

  return (
    <>
      <Drawer
        isOpen={isOpen}
        onClose={onClose}
        title="Delivery Inspector"
        subtitle={`ID: ${activeDelivery.id}`}
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

            <div className="flex items-center gap-2 justify-end flex-wrap">
              {activeDelivery.state === 'IN_FLIGHT' && (
                <span
                  className="text-2xs font-semibold text-[#5277D9] bg-[#5277D9]/10 px-2.5 py-1.5 rounded-lg border border-[#5277D9]/20 flex items-center gap-1.5"
                  data-testid="dispatch-in-flight-badge"
                >
                  <RefreshCw className="w-3 h-3 animate-spin text-[#5277D9]" />
                  <span>Dispatch In Flight</span>
                </span>
              )}

              {(activeDelivery.state === 'SCHEDULED' || activeDelivery.state === 'PENDING') && onCancelRequest && (
                <Button
                  variant="outline"
                  size="sm"
                  className="text-[#E76B64] border-[#E76B64]/30 hover:bg-[#E76B64]/10"
                  onClick={() => onCancelRequest(activeDelivery)}
                >
                  Cancel Scheduled
                </Button>
              )}

              {isResendEligible && (
                <Button
                  variant={activeDelivery.state === 'DEAD' ? 'primary' : 'outline'}
                  size="sm"
                  leftIcon={<RotateCw className="w-3.5 h-3.5" />}
                  onClick={() => setResendModalOpen(true)}
                  data-testid="resend-webhook-button"
                >
                  Resend Webhook
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
                  {activeDelivery.state === 'SUCCEEDED'
                    ? 'Delivered successfully • Replay not required'
                    : activeDelivery.state === 'IN_FLIGHT' || activeDelivery.state === 'RETRYING'
                    ? 'Active delivery • Managed by retry scheduler'
                    : activeDelivery.state === 'CANCELLED'
                    ? 'Scheduled delivery was cancelled'
                    : 'Pending dispatch in queue'}
                </span>
              )}
            </div>
          </div>
        }
      >
        <div className="space-y-4 text-left">
          {/* Status & Overview Bar */}
          <div className="p-3.5 sm:p-4 bg-[#F7F6F2] rounded-xl border border-[#E7E8EC] space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <span className="text-2xs text-[#64748B] font-semibold uppercase tracking-wider block">
                  Delivery Status
                </span>
                <div className="mt-1 flex items-center gap-2">
                  <StatusBadge state={activeDelivery.state} />
                  <span className="text-xs text-[#64748B] font-semibold">
                    Attempt {activeDelivery.attempt_count ?? (activeDelivery as any).attemptCount ?? 0}
                  </span>
                  {lastStatusCode !== undefined && lastStatusCode !== null && (
                    <span className="text-2xs font-mono px-2 py-0.5 rounded bg-white border border-[#E7E8EC] font-semibold text-[#64748B]">
                      Last HTTP {lastStatusCode}
                    </span>
                  )}
                </div>
              </div>

              <button
                type="button"
                onClick={() => handleCopy(activeDelivery.id, 'deliveryId')}
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
                activeDelivery.state === 'SUCCEEDED'
                  ? 'bg-[#159B78]/10 border-[#159B78]/25 text-[#159B78]'
                  : activeDelivery.state === 'DEAD'
                  ? 'bg-[#E76B64]/10 border-[#E76B64]/25 text-[#E76B64]'
                  : activeDelivery.state === 'RETRYING'
                  ? 'bg-[#E5B34B]/15 border-[#E5B34B]/30 text-[#B8871E]'
                  : activeDelivery.state === 'IN_FLIGHT'
                  ? 'bg-[#EAF0FF] border-[#DCE5FA] text-[#5277D9]'
                  : activeDelivery.state === 'SCHEDULED'
                  ? 'bg-[#EAF0FF] border-[#DCE5FA] text-[#5277D9]'
                  : activeDelivery.state === 'CANCELLED'
                  ? 'bg-[#E76B64]/10 border-[#E76B64]/25 text-[#E76B64]'
                  : 'bg-white border-[#E7E8EC] text-[#64748B]'
              }`}
            >
              {activeDelivery.state === 'SUCCEEDED' ? (
                <CheckCircle2 className="w-4 h-4 shrink-0 text-[#159B78]" />
              ) : activeDelivery.state === 'DEAD' || activeDelivery.state === 'CANCELLED' ? (
                <AlertOctagon className="w-4 h-4 shrink-0 text-[#E76B64]" />
              ) : activeDelivery.state === 'RETRYING' ? (
                <RotateCw className="w-4 h-4 shrink-0 text-[#B8871E]" />
              ) : (
                <Clock className="w-4 h-4 shrink-0 text-[#5277D9]" />
              )}
              <span className="font-medium">
                {activeDelivery.state === 'SUCCEEDED'
                  ? 'Endpoint returned a 2xx success response code. Delivery acknowledged and completed.'
                  : activeDelivery.state === 'DEAD'
                  ? 'Dead Letter Queue — Retry budget exhausted. Eligible for manual replay.'
                  : activeDelivery.state === 'RETRYING'
                  ? 'Retrying — Scheduled for automatic retry with exponential backoff.'
                  : activeDelivery.state === 'IN_FLIGHT'
                  ? 'In Flight — Leased by worker and awaiting HTTP response.'
                  : activeDelivery.state === 'SCHEDULED'
                  ? 'Scheduled — Queued for future delivery execution.'
                  : activeDelivery.state === 'CANCELLED'
                  ? 'Cancelled — Scheduled delivery cancelled before dispatch.'
                  : 'Pending — Enqueued in work queue awaiting dispatcher worker.'}
              </span>
            </div>
          </div>

          {/* Diagnostic Failure Recommendation Banner */}
          {effectiveDiagnostics && (
            <div
              className={`p-3.5 rounded-xl border space-y-1.5 text-left ${
                effectiveDiagnostics.category === 'SUCCESS'
                  ? 'bg-[#159B78]/10 border-[#159B78]/25 text-[#159B78]'
                  : effectiveDiagnostics.category === 'TIMEOUT' || effectiveDiagnostics.category === 'RATE_LIMITED_429'
                  ? 'bg-[#D97706]/10 border-[#D97706]/25 text-[#B8871E]'
                  : 'bg-[#E76B64]/10 border-[#E76B64]/25 text-[#E76B64]'
              }`}
            >
              <div className="flex items-center gap-2 text-xs font-semibold">
                <AlertOctagon className="w-4 h-4 shrink-0" />
                <span>Failure Diagnosis: {effectiveDiagnostics.category}</span>
              </div>
              <p className="text-xs leading-relaxed font-sans opacity-95">
                {effectiveDiagnostics.recommendation}
              </p>
            </div>
          )}

          {/* Navigation Tabs */}
          <div className="flex items-center gap-1 border-b border-[#E7E8EC] text-xs">
            <button
              type="button"
              onClick={() => setActiveTab('overview')}
              className={`px-3 py-2 font-semibold border-b-2 transition-all cursor-pointer flex items-center gap-1.5 ${
                activeTab === 'overview'
                  ? 'border-[#5277D9] text-[#5277D9]'
                  : 'border-transparent text-[#64748B] hover:text-[#202938]'
              }`}
            >
              <Activity className="w-3.5 h-3.5" />
              <span>Overview</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('payload')}
              className={`px-3 py-2 font-semibold border-b-2 transition-all cursor-pointer flex items-center gap-1.5 ${
                activeTab === 'payload'
                  ? 'border-[#5277D9] text-[#5277D9]'
                  : 'border-transparent text-[#64748B] hover:text-[#202938]'
              }`}
            >
              <FileText className="w-3.5 h-3.5" />
              <span>Event Payload</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('attempts')}
              className={`px-3 py-2 font-semibold border-b-2 transition-all cursor-pointer flex items-center gap-1.5 ${
                activeTab === 'attempts'
                  ? 'border-[#5277D9] text-[#5277D9]'
                  : 'border-transparent text-[#64748B] hover:text-[#202938]'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Attempt History</span>
              <span className="ml-1 px-1.5 py-0.2 rounded-full text-3xs font-mono bg-[#F7F6F2] border border-[#E7E8EC] text-[#64748B]">
                {attempts.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('logs')}
              className={`px-3 py-2 font-semibold border-b-2 transition-all cursor-pointer flex items-center gap-1.5 ${
                activeTab === 'logs'
                  ? 'border-[#5277D9] text-[#5277D9]'
                  : 'border-transparent text-[#64748B] hover:text-[#202938]'
              }`}
            >
              <Terminal className="w-3.5 h-3.5" />
              <span>Detailed Logs</span>
              <span className="ml-1 px-1.5 py-0.2 rounded-full text-3xs font-mono bg-[#F7F6F2] border border-[#E7E8EC] text-[#64748B]">
                {logsData.length}
              </span>
            </button>
          </div>

          {/* Tab 1: Overview */}
          {activeTab === 'overview' && (
            <div className="space-y-4">
              {/* Routing & Identifiers */}
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
                    {activeDelivery.event?.event_type && (
                      <div className="pt-1 border-t border-[#E7E8EC] flex items-center justify-between text-2xs">
                        <span className="text-[#64748B]">Event Type:</span>
                        <span className="font-semibold text-[#5277D9] bg-[#EAF0FF] px-2 py-0.5 rounded">
                          {activeDelivery.event.event_type}
                        </span>
                      </div>
                    )}
                    {activeDelivery.event?.idempotency_key && (
                      <div className="pt-1 border-t border-[#E7E8EC] text-2xs space-y-0.5">
                        <span className="text-[#64748B] block">Idempotency Key:</span>
                        <span className="font-mono text-[#202938] font-medium break-all block">
                          {activeDelivery.event.idempotency_key}
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
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                      )}
                    </div>

                    {activeDelivery.endpoint && (
                      <div className="pt-1.5 border-t border-[#E7E8EC] space-y-1 text-2xs text-[#64748B]">
                        {activeDelivery.endpoint.description && (
                          <p className="font-sans italic">{activeDelivery.endpoint.description}</p>
                        )}
                        <div className="flex items-center gap-2">
                          <span>Rate Limit: {activeDelivery.endpoint.rate_limit_rps} rps</span>
                          <span>•</span>
                          <span>Circuit: {activeDelivery.endpoint.circuit_state}</span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Timing & Execution Sequence */}
              <div className="space-y-3">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-[#64748B]">
                  Timing & Execution Sequence
                </h4>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                  <div className="p-3 bg-white rounded-lg border border-[#E7E8EC]">
                    <span className="text-[#64748B] block mb-1">Created At</span>
                    <span className="font-mono text-[#202938] font-semibold block text-2xs">
                      {formatDateTime(activeDelivery.created_at)}
                    </span>
                    <span className="text-3xs text-[#64748B] block mt-0.5">
                      {formatRelativeTime(activeDelivery.created_at)}
                    </span>
                  </div>

                  <div className="p-3 bg-white rounded-lg border border-[#E7E8EC]">
                    <span className="text-[#64748B] block mb-1">Last Attempt</span>
                    <span className="font-mono text-[#202938] font-semibold block text-2xs">
                      {lastAttemptTimestamp ? formatDateTime(lastAttemptTimestamp) : '—'}
                    </span>
                    {lastAttemptTimestamp && (
                      <span className="text-3xs text-[#64748B] block mt-0.5">
                        {formatRelativeTime(lastAttemptTimestamp)}
                      </span>
                    )}
                  </div>

                  <div className="p-3 bg-white rounded-lg border border-[#E7E8EC]">
                    <span className="text-[#64748B] block mb-1">Last Updated</span>
                    <span className="font-mono text-[#202938] font-semibold block text-2xs">
                      {formatDateTime(activeDelivery.updated_at)}
                    </span>
                    <span className="text-3xs text-[#64748B] block mt-0.5">
                      {formatRelativeTime(activeDelivery.updated_at)}
                    </span>
                  </div>

                  <div className="p-3 bg-white rounded-lg border border-[#E7E8EC]">
                    <span className="text-[#64748B] block mb-1">Sequence #</span>
                    <span className="font-mono text-[#202938] font-bold text-sm">
                      #{activeDelivery.seq}
                    </span>
                    <span className="text-3xs text-[#64748B] block mt-0.5">
                      Strict FIFO order
                    </span>
                  </div>

                  {activeDelivery.next_attempt_at && (
                    <div className="p-3 bg-[#EAF0FF]/50 rounded-lg border border-[#DCE5FA] col-span-2">
                      <span className="text-[#5277D9] font-medium block mb-1">
                        Next Scheduled Retry
                      </span>
                      <span className="font-mono text-[#202938] font-semibold block text-2xs">
                        {formatDateTime(activeDelivery.next_attempt_at)}
                      </span>
                      <span className="text-3xs text-[#5277D9] block mt-0.5">
                        {formatRelativeTime(activeDelivery.next_attempt_at)}
                      </span>
                    </div>
                  )}

                  {activeDelivery.lease_until && (
                    <div className="p-3 bg-[#EAF0FF]/50 rounded-lg border border-[#DCE5FA] col-span-2">
                      <span className="text-[#5277D9] font-medium block mb-1">Active Dispatch Lease</span>
                      <span className="font-mono text-[#202938] font-semibold block text-2xs">
                        {formatDateTime(activeDelivery.lease_until)}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* Configured Retry Policy */}
              {retryPolicy && (
                <div className="space-y-2">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-[#64748B]">
                    Configured Retry Policy
                  </h4>
                  <div className="p-3 bg-white rounded-lg border border-[#E7E8EC] grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                    <div>
                      <span className="text-[#64748B] text-2xs block">Strategy</span>
                      <span className="font-semibold text-[#202938]">{retryPolicy.strategy}</span>
                    </div>
                    <div>
                      <span className="text-[#64748B] text-2xs block">Max Attempts</span>
                      <span className="font-semibold text-[#202938]">{retryPolicy.maxAttempts}</span>
                    </div>
                    <div>
                      <span className="text-[#64748B] text-2xs block">Base Delay</span>
                      <span className="font-semibold text-[#202938]">{retryPolicy.baseDelayMs} ms</span>
                    </div>
                    <div>
                      <span className="text-[#64748B] text-2xs block">Max Delay Cap</span>
                      <span className="font-semibold text-[#202938]">{retryPolicy.maxDelayMs} ms</span>
                    </div>
                  </div>
                </div>
              )}

              {/* HTTP Request Details */}
              {activeDelivery.request && (
                <div className="space-y-2">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-[#64748B]">
                    HTTP Request Details
                  </h4>
                  <div className="p-3 bg-white rounded-lg border border-[#E7E8EC] space-y-2 text-xs font-mono">
                    <div className="flex items-center gap-2">
                      <span className="px-1.5 py-0.5 rounded bg-[#EAF0FF] text-[#5277D9] font-bold text-3xs">
                        {activeDelivery.request.method}
                      </span>
                      <span className="text-[#202938] break-all text-2xs">{activeDelivery.request.url}</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Request Payload (HTTP POST) */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-[#64748B] flex items-center gap-1.5">
                    <FileJson className="w-3.5 h-3.5 text-[#64748B]" />
                    Request Payload (HTTP POST)
                  </h4>
                  {hasPayload && (
                    <button
                      type="button"
                      onClick={() =>
                        handleCopy(
                          typeof activeDelivery.event?.payload === 'string'
                            ? activeDelivery.event.payload
                            : JSON.stringify(activeDelivery.event?.payload, null, 2),
                          'payload'
                        )
                      }
                      className="text-[#64748B] hover:text-[#202938] inline-flex items-center gap-1 text-2xs cursor-pointer"
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
                          <span>Copy Payload JSON</span>
                        </>
                      )}
                    </button>
                  )}
                </div>

                {hasPayload ? (
                  <JsonViewer data={activeDelivery.event!.payload} maxHeight="max-h-64" />
                ) : (
                  <div className="p-4 bg-[#F7F6F2] rounded-xl border border-[#E7E8EC] text-center text-xs text-[#64748B]">
                    No request payload recorded for this delivery event.
                  </div>
                )}
              </div>

              {/* Failure Diagnostic Reason */}
              {(activeDelivery.state === 'DEAD' || activeDelivery.last_error) && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-[#E76B64] flex items-center gap-1.5">
                      <AlertOctagon className="w-3.5 h-3.5 text-[#E76B64]" />
                      Failure Diagnostic Reason
                    </h4>
                    {lastErrorMsg && (
                      <button
                        type="button"
                        onClick={() => handleCopy(lastErrorMsg, 'error')}
                        className="text-[#64748B] hover:text-[#202938] inline-flex items-center gap-1 text-2xs cursor-pointer"
                        aria-label="Copy Failure Diagnostic"
                      >
                        {copiedError ? (
                          <>
                            <Check className="w-3 h-3 text-[#159B78]" />
                            <span className="text-[#159B78] font-semibold">Copied Error</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3 h-3" />
                            <span>Copy Diagnostic</span>
                          </>
                        )}
                      </button>
                    )}
                  </div>

                  <div className="p-3 bg-[#E76B64]/10 rounded-xl border border-[#E76B64]/20 space-y-2 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-[#E76B64]">Terminal Execution Error</span>
                      {lastStatusCode && (
                        <span className="px-2 py-0.5 rounded font-mono text-2xs bg-[#E76B64]/20 text-[#E76B64] font-bold">
                          {formatStatusCode(lastStatusCode).text}
                        </span>
                      )}
                    </div>
                    <p className="font-mono text-2xs text-[#E76B64] break-all leading-relaxed">
                      {lastErrorMsg || 'Unknown terminal failure occurred during dispatch attempt.'}
                    </p>
                    <p className="text-2xs text-[#64748B] pt-1 border-t border-[#E76B64]/20">
                      Recommendation: Inspect target endpoint service health, verify webhook route and secrets, or manually trigger replay.
                    </p>
                  </div>
                </div>
              )}

              {/* Delivery Attempt History */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-[#64748B]">
                    Delivery Attempt History ({attempts.length})
                  </h4>
                  <span className="text-2xs text-[#64748B]">Execution timeline</span>
                </div>

                {attempts.length === 0 ? (
                  <div className="p-4 bg-[#F7F6F2] rounded-xl border border-[#E7E8EC] text-center text-xs text-[#64748B]">
                    No delivery attempts executed yet. Delivery is currently {activeDelivery.state}.
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {attempts.map((att, index) => {
                      const attemptStatusCode = att.status_code !== undefined ? att.status_code : (att as any).statusCode
                      const statusInfo = formatStatusCode(attemptStatusCode)
                      const isFirst = index === 0

                      return (
                        <div
                          key={att.id || index}
                          className="p-3 bg-white rounded-xl border border-[#E7E8EC] space-y-2 text-xs"
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-[#202938]">
                                Attempt #{att.attempt_no ?? (att as any).attemptNumber ?? index + 1}
                              </span>
                              <span className="text-2xs px-1.5 py-0.5 rounded font-medium bg-[#F7F6F2] text-[#64748B] border border-[#E7E8EC]">
                                {isFirst ? 'Initial Attempt' : 'Automatic Retry'}
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
          )}

          {/* Tab 2: Payload */}
          {activeTab === 'payload' && (
            <div className="space-y-3">
              {/* Event Metadata */}
              <div className="p-3 bg-[#F7F6F2] rounded-lg border border-[#E7E8EC] grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="text-[#64748B] text-3xs block">Event UUID</span>
                  <span className="font-mono text-[#202938] text-2xs font-semibold break-all">
                    {activeDelivery.event_id}
                  </span>
                </div>
                <div>
                  <span className="text-[#64748B] text-3xs block">Idempotency Key</span>
                  <span className="font-mono text-[#202938] text-2xs break-all">
                    {activeDelivery.event?.idempotency_key || '—'}
                  </span>
                </div>
                <div>
                  <span className="text-[#64748B] text-3xs block">Event Type</span>
                  <span className="font-semibold text-[#5277D9] text-2xs">
                    {activeDelivery.event?.event_type || '—'}
                  </span>
                </div>
                <div>
                  <span className="text-[#64748B] text-3xs block">Ingested Timestamp</span>
                  <span className="text-[#202938] text-2xs">
                    {activeDelivery.event?.created_at ? formatDateTime(activeDelivery.event.created_at) : '—'}
                  </span>
                </div>
              </div>

              {/* Redacted Payload JSON */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <h4 className="text-2xs font-semibold uppercase tracking-wider text-[#64748B]">
                    Payload Content (Safely Redacted)
                  </h4>
                  <span className="text-3xs text-[#64748B] italic">
                    Sensitive credentials automatically masked
                  </span>
                </div>
                {activeDelivery.event?.payload ? (
                  <JsonViewer data={activeDelivery.event.payload} maxHeight="max-h-96" />
                ) : (
                  <div className="p-6 text-center text-xs text-[#64748B] bg-[#F7F6F2] rounded-lg border border-[#E7E8EC]">
                    No request payload recorded for this delivery event.
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Tab 3: Attempt History */}
          {activeTab === 'attempts' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-2xs font-semibold uppercase tracking-wider text-[#64748B]">
                  Chronological Dispatch Attempts ({attemptsData.length})
                </h4>
                <span className="text-3xs text-[#64748B]">Execution sequence</span>
              </div>

              {isLoadingAttempts ? (
                <div className="p-8 text-center space-y-2">
                  <RefreshCw className="w-5 h-5 text-[#5277D9] animate-spin mx-auto" />
                  <p className="text-xs text-[#64748B]">Loading attempt history...</p>
                </div>
              ) : attemptsError ? (
                <div className="p-4 bg-[#E76B64]/10 border border-[#E76B64]/25 rounded-lg text-xs text-[#E76B64] flex items-center justify-between">
                  <span>{attemptsError}</span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => service.getDeliveryAttempts(activeDelivery.id)}
                  >
                    Retry
                  </Button>
                </div>
              ) : attemptsData.length === 0 ? (
                <div className="text-center p-8 bg-[#F7F6F2] rounded-xl border border-[#E7E8EC] text-xs text-[#64748B]">
                  No delivery attempts executed yet. Current state: {activeDelivery.state}.
                </div>
              ) : (
                <div className="border border-[#E7E8EC] rounded-xl overflow-hidden divide-y divide-[#E7E8EC] bg-white">
                  {attemptsData.map((att) => {
                    const num = att.attempt_no ?? att.attemptNumber ?? 1
                    const code = att.status_code ?? att.statusCode
                    const lat = att.latency_ms ?? att.latencyMs ?? 0
                    const err = att.error ?? att.errorMessage
                    const started = att.started_at || att.attemptedAt || new Date().toISOString()
                    const statusInfo = formatStatusCode(code)
                    const isExpanded = Boolean(expandedAttemptIds[att.id])
                    const reqHeaders = att.request_headers || att.requestHeaders
                    const headers = att.response_headers || att.responseHeaders
                    const body = att.response_body || att.responseBody
                    const hasDetails = Boolean(
                      (reqHeaders && Object.keys(reqHeaders).length > 0) ||
                      (headers && Object.keys(headers).length > 0) ||
                      body
                    )

                    return (
                      <div key={att.id} className="p-3 text-xs flex flex-col gap-2">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-[#202938]">Attempt #{num}</span>
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
                          </div>
                          <span className="text-2xs text-[#64748B]">{formatDateTime(started)}</span>
                        </div>

                        <div className="flex items-center justify-between text-2xs text-[#64748B]">
                          <span>Latency: {formatLatency(lat)}</span>
                          {hasDetails && (
                            <button
                              type="button"
                              onClick={() => toggleAttemptExpand(att.id)}
                              className="inline-flex items-center gap-1 text-[#5277D9] hover:underline font-medium cursor-pointer"
                            >
                              {isExpanded ? (
                                <>
                                  <ChevronDown className="w-3 h-3" />
                                  <span>Hide Response Details</span>
                                </>
                              ) : (
                                <>
                                  <ChevronRight className="w-3 h-3" />
                                  <span>View Response Details</span>
                                </>
                              )}
                            </button>
                          )}
                        </div>

                        {err && (
                          <p className="text-2xs text-[#E76B64] font-mono bg-[#E76B64]/10 p-2 rounded break-all leading-relaxed">
                            {err}
                          </p>
                        )}

                        {/* Expanded Details: Request Headers, Response Headers, Response Body */}
                        {isExpanded && (
                          <div className="pt-2 border-t border-[#E7E8EC] space-y-2.5">
                            {reqHeaders && Object.keys(reqHeaders).length > 0 && (
                              <div className="space-y-1">
                                <span className="text-3xs font-semibold uppercase text-[#64748B] block">
                                  Request Headers
                                </span>
                                <div className="p-2 bg-[#F7F6F2] rounded border border-[#E7E8EC] font-mono text-3xs space-y-0.5">
                                  {Object.entries(reqHeaders).map(([k, v]) => (
                                    <div key={k} className="flex gap-2">
                                      <span className="font-semibold text-[#202938]">{k}:</span>
                                      <span className="text-[#64748B] break-all">{v}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}

                            {headers && Object.keys(headers).length > 0 && (
                              <div className="space-y-1">
                                <span className="text-3xs font-semibold uppercase text-[#64748B] block">
                                  Response Headers
                                </span>
                                <div className="p-2 bg-[#F7F6F2] rounded border border-[#E7E8EC] font-mono text-3xs space-y-0.5">
                                  {Object.entries(headers).map(([k, v]) => (
                                    <div key={k} className="flex gap-2">
                                      <span className="font-semibold text-[#202938]">{k}:</span>
                                      <span className="text-[#64748B] break-all">{v}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}

                            {body && (
                              <div className="space-y-1">
                                <div className="flex items-center justify-between">
                                  <span className="text-3xs font-semibold uppercase text-[#64748B] block">
                                    Response Body
                                  </span>
                                  {(body.includes('[TRUNCATED') || body.length >= 65536) && (
                                    <span className="text-3xs text-[#B8871E] font-semibold bg-[#E5B34B]/15 px-1.5 py-0.5 rounded border border-[#E5B34B]/30">
                                      Truncated (64KB capture limit)
                                    </span>
                                  )}
                                </div>
                                <div className="p-2 bg-[#F7F6F2] rounded border border-[#E7E8EC] font-mono text-3xs text-[#202938] max-h-48 overflow-y-auto whitespace-pre-wrap break-all">
                                  {body}
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {/* Tab 4: Detailed Logs */}
          {activeTab === 'logs' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-2xs font-semibold uppercase tracking-wider text-[#64748B]">
                  Diagnostic Execution Logs ({logsData.length})
                </h4>
                <span className="text-3xs text-[#64748B]">Structured event timeline</span>
              </div>

              {isLoadingLogs ? (
                <div className="p-8 text-center space-y-2">
                  <RefreshCw className="w-5 h-5 text-[#5277D9] animate-spin mx-auto" />
                  <p className="text-xs text-[#64748B]">Streaming diagnostic logs...</p>
                </div>
              ) : logsError ? (
                <div className="p-4 bg-[#E76B64]/10 border border-[#E76B64]/25 rounded-lg text-xs text-[#E76B64] flex items-center justify-between">
                  <span>{logsError}</span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => service.getDeliveryLogs(activeDelivery.id)}
                  >
                    Retry
                  </Button>
                </div>
              ) : logsData.length === 0 ? (
                <div className="text-center p-8 bg-[#F7F6F2] rounded-xl border border-[#E7E8EC] text-xs text-[#64748B]">
                  No structured logs recorded for this delivery.
                </div>
              ) : (
                <div className="border border-[#E7E8EC] rounded-xl overflow-hidden divide-y divide-[#E7E8EC] bg-white font-mono text-2xs">
                  {logsData.map((log, idx) => {
                    const isError = log.level === 'ERROR'
                    const isWarn = log.level === 'WARN'

                    return (
                      <div key={idx} className="p-2.5 flex items-start gap-2.5 leading-relaxed">
                        <span
                          className={`px-1.5 py-0.5 rounded text-3xs font-bold uppercase shrink-0 ${
                            isError
                              ? 'bg-[#E76B64]/15 text-[#E76B64]'
                              : isWarn
                              ? 'bg-[#E5B34B]/15 text-[#B8871E]'
                              : 'bg-[#5277D9]/15 text-[#5277D9]'
                          }`}
                        >
                          {log.level}
                        </span>

                        <div className="flex-1 space-y-0.5">
                          <div className="flex items-center justify-between text-3xs text-[#64748B]">
                            <span className="font-semibold text-[#202938]">{log.event}</span>
                            <span>{formatDateTime(log.timestamp)}</span>
                          </div>
                          <p className="text-[#202938]">{log.message}</p>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}
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
                <span className="font-mono text-[#202938] font-semibold truncate">{activeDelivery.id}</span>
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
                  {activeDelivery.attempt_count ?? (activeDelivery as any).attemptCount ?? 0} attempts
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

      {/* Resend Webhook Modal */}
      <ResendModal
        delivery={activeDelivery}
        isOpen={resendModalOpen}
        onClose={() => setResendModalOpen(false)}
        onSuccess={handleResendSuccess}
      />
    </>
  )
}
