import React, { useState, useEffect } from 'react'
import type { Delivery, DeliveryAttempt, DeliveryLogEntry, DeliveryDiagnostics, ResendDeliveryResult } from '../types'
import { Drawer } from './ui/Drawer'
import { StatusBadge } from './StatusBadge'
import { Button } from './ui/Button'
import { JsonViewer } from './ui/JsonViewer'
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
  Layers,
  FileText,
  Terminal,
  Activity,
  ChevronDown,
  ChevronRight,
  RefreshCw,
} from 'lucide-react'

interface DeliveryDetailDrawerProps {
  delivery: Delivery | null
  isOpen: boolean
  onClose: () => void
  onReplayRequest?: (delivery: Delivery) => void
  onCancelRequest?: (delivery: Delivery) => void
  onResendSuccess?: (updatedDelivery?: Delivery) => void
}

type TabType = 'overview' | 'payload' | 'attempts' | 'logs'

export const DeliveryDetailDrawer: React.FC<DeliveryDetailDrawerProps> = ({
  delivery,
  isOpen,
  onClose,
  onReplayRequest,
  onCancelRequest,
  onResendSuccess,
}) => {
  const { service } = useApp()
  const [activeTab, setActiveTab] = useState<TabType>('overview')
  const [copiedId, setCopiedId] = useState(false)
  const [resendModalOpen, setResendModalOpen] = useState(false)
  const [currentDelivery, setCurrentDelivery] = useState<Delivery | null>(delivery)

  useEffect(() => {
    setCurrentDelivery(delivery)
  }, [delivery])

  const activeDelivery = currentDelivery || delivery

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
                timestamp: delivery?.created_at || new Date().toISOString(),
                level: 'INFO',
                event: 'DELIVERY_CREATED',
                message: `Delivery created and queued in state ${delivery?.state || 'PENDING'}`,
              },
            ]
            if (delivery?.attempts && delivery.attempts.length > 0) {
              delivery.attempts.forEach((att) => {
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
      setCurrentDelivery(result.delivery)
    }
    if (deliveryId) {
      try {
        const updated = await service.getDeliveryById(deliveryId)
        if (updated) setCurrentDelivery(updated)
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

  const handleCopyId = async () => {
    const ok = await copyToClipboard(activeDelivery.id)
    if (ok) {
      setCopiedId(true)
      setTimeout(() => setCopiedId(false), 2000)
    }
  }

  const toggleAttemptExpand = (id: string | number) => {
    setExpandedAttemptIds((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  const effectiveDiagnostics = diagnosticsData || activeDelivery.diagnostics
  const retryPolicy = activeDelivery.retry || activeDelivery.endpoint?.retryPolicy

  const isResendEligible =
    activeDelivery.state === 'DEAD' ||
    activeDelivery.state === 'SUCCEEDED' ||
    activeDelivery.state === 'CANCELLED'

  return (
    <>
      <Drawer
        isOpen={isOpen}
        onClose={onClose}
        title="Delivery Details & Diagnostics"
        subtitle={`ID: ${activeDelivery.id}`}
        width="xl"
        footer={
          <div className="flex items-center justify-between w-full">
            <Button variant="outline" size="sm" onClick={onClose}>
              Close
            </Button>
            <div className="flex items-center gap-2">
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
              {activeDelivery.state === 'DEAD' && onReplayRequest && (
                <Button
                  variant="danger"
                  size="sm"
                  leftIcon={<RotateCw className="w-3.5 h-3.5" />}
                  onClick={() => onReplayRequest(activeDelivery)}
                >
                  Replay Dead Delivery
                </Button>
              )}
            </div>
          </div>
        }
      >
      <div className="space-y-4">
        {/* Status & Overview Bar */}
        <div className="flex items-center justify-between p-3.5 bg-[#F7F6F2] rounded-xl border border-[#E7E8EC]">
          <div>
            <span className="text-2xs text-[#64748B] font-semibold uppercase tracking-wider block">
              Current State
            </span>
            <div className="mt-1 flex items-center gap-2">
              <StatusBadge state={activeDelivery.state} />
              <span className="text-xs font-medium text-[#202938]">
                Attempt {activeDelivery.attempt_count ?? activeDelivery.attemptCount ?? 0}
              </span>
              {activeDelivery.last_status_code !== undefined && activeDelivery.last_status_code !== null && (
                <span className="text-2xs font-mono px-2 py-0.5 rounded bg-white border border-[#E7E8EC] font-semibold text-[#64748B]">
                  Last HTTP {activeDelivery.last_status_code}
                </span>
              )}
            </div>
          </div>

          <button
            type="button"
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
                <span>Copy ID</span>
              </>
            )}
          </button>
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
              {attemptsData.length}
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
            {/* Target & Sequence Information */}
            <div className="space-y-2">
              <h4 className="text-2xs font-semibold uppercase tracking-wider text-[#64748B]">
                Target & Ordering
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div className="p-3 bg-white rounded-lg border border-[#E7E8EC]">
                  <span className="text-[#64748B] block mb-1">Destination Endpoint</span>
                  <div className="flex items-center gap-1 font-mono text-[#202938] break-all font-semibold">
                    <ExternalLink className="w-3.5 h-3.5 text-[#64748B] shrink-0" />
                    <span>{activeDelivery.endpoint_url || activeDelivery.endpoint?.url || '—'}</span>
                  </div>
                  {activeDelivery.endpoint && (
                    <div className="mt-1.5 flex items-center gap-2 text-3xs text-[#64748B]">
                      <span>Rate Limit: {activeDelivery.endpoint.rate_limit_rps || 10} rps</span>
                      <span>•</span>
                      <span>Circuit: {activeDelivery.endpoint.circuit_state || 'CLOSED'}</span>
                    </div>
                  )}
                </div>

                <div className="p-3 bg-white rounded-lg border border-[#E7E8EC]">
                  <span className="text-[#64748B] block mb-1">Head-of-Line Sequence</span>
                  <span className="font-mono text-[#202938] font-bold text-sm">
                    #{activeDelivery.seq}
                  </span>
                  <p className="text-3xs text-[#64748B] mt-0.5">Strict per-endpoint FIFO order</p>
                </div>
              </div>
            </div>

            {/* Timestamps, Timing & Leases */}
            <div className="space-y-2">
              <h4 className="text-2xs font-semibold uppercase tracking-wider text-[#64748B]">
                Timing, Leases & Lifecycle
              </h4>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
                <div className="p-2.5 bg-[#F7F6F2] rounded-lg border border-[#E7E8EC]/60">
                  <span className="text-[#64748B] block text-3xs">Created At</span>
                  <span className="font-medium text-[#202938] text-2xs">
                    {formatDateTime(activeDelivery.created_at)}
                  </span>
                </div>
                <div className="p-2.5 bg-[#F7F6F2] rounded-lg border border-[#E7E8EC]/60">
                  <span className="text-[#64748B] block text-3xs">Last Updated</span>
                  <span className="font-medium text-[#202938] text-2xs">
                    {formatRelativeTime(activeDelivery.updated_at)}
                  </span>
                </div>
                <div className="p-2.5 bg-[#F7F6F2] rounded-lg border border-[#E7E8EC]/60">
                  <span className="text-[#64748B] block text-3xs">Next Attempt</span>
                  <span className="font-medium text-[#202938] text-2xs">
                    {activeDelivery.state === 'DEAD' || activeDelivery.state === 'SUCCEEDED'
                      ? '—'
                      : formatDateTime(activeDelivery.next_attempt_at)}
                  </span>
                </div>
                {(activeDelivery.scheduled_at || activeDelivery.scheduledAt) && (
                  <div className="p-2.5 bg-[#F7F6F2] rounded-lg border border-[#E7E8EC]/60">
                    <span className="text-[#64748B] block text-3xs">Scheduled Execution</span>
                    <span className="font-medium text-[#5277D9] text-2xs">
                      {formatDateTime(activeDelivery.scheduled_at || activeDelivery.scheduledAt!)}
                    </span>
                  </div>
                )}
                {activeDelivery.lease_until && (
                  <div className="p-2.5 bg-[#EAF0FF] rounded-lg border border-[#DCE5FA] col-span-2 sm:col-span-1">
                    <span className="text-[#5277D9] block text-3xs">Worker Lease Expiration</span>
                    <span className="font-medium text-[#5277D9] text-2xs">
                      {formatDateTime(activeDelivery.lease_until)}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Retry Policy Configuration */}
            {retryPolicy && (
              <div className="space-y-2">
                <h4 className="text-2xs font-semibold uppercase tracking-wider text-[#64748B]">
                  Configured Retry Policy
                </h4>
                <div className="p-3 bg-white rounded-lg border border-[#E7E8EC] grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                  <div>
                    <span className="text-[#64748B] text-3xs block">Strategy</span>
                    <span className="font-semibold text-[#202938]">{retryPolicy.strategy}</span>
                  </div>
                  <div>
                    <span className="text-[#64748B] text-3xs block">Max Attempts</span>
                    <span className="font-semibold text-[#202938]">{retryPolicy.maxAttempts}</span>
                  </div>
                  <div>
                    <span className="text-[#64748B] text-3xs block">Base Delay</span>
                    <span className="font-semibold text-[#202938]">{retryPolicy.baseDelayMs} ms</span>
                  </div>
                  <div>
                    <span className="text-[#64748B] text-3xs block">Max Delay Cap</span>
                    <span className="font-semibold text-[#202938]">{retryPolicy.maxDelayMs} ms</span>
                  </div>
                </div>
              </div>
            )}

            {/* Request Dispatch Metadata */}
            {activeDelivery.request && (
              <div className="space-y-2">
                <h4 className="text-2xs font-semibold uppercase tracking-wider text-[#64748B]">
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

            {/* Last Error Message */}
            {activeDelivery.last_error && (
              <div className="p-3 bg-[#E76B64]/10 border border-[#E76B64]/25 rounded-xl space-y-1 text-left">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-[#E76B64]">
                  <AlertOctagon className="w-4 h-4 text-[#E76B64]" />
                  <span>Last Captured Error</span>
                </div>
                <p className="text-xs text-[#E76B64] font-mono break-all leading-relaxed">
                  {activeDelivery.last_error}
                </p>
              </div>
            )}
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
                  {activeDelivery.event?.event_type ||
                    (activeDelivery.event?.payload as any)?.type ||
                    (activeDelivery.event?.payload as any)?.event ||
                    'custom.event'}
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
                  No event payload found for this delivery.
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

    <ResendModal
      delivery={activeDelivery}
      isOpen={resendModalOpen}
      onClose={() => setResendModalOpen(false)}
      onSuccess={handleResendSuccess}
    />
  </>
  )
}
