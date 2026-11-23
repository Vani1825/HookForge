import React, { useState } from 'react'
import { Drawer } from './ui/Drawer'
import { Button } from './ui/Button'
import { CircuitBadge } from './CircuitBadge'
import { formatDateTime, formatDuration, copyToClipboard } from '../utils/formatters'
import type { Endpoint } from '../types'
import {
  ExternalLink,
  Copy,
  Check,
  RotateCcw,
  Zap,
  Clock,
  FlaskConical,
  Edit3,
  Power,
  Shield,
  Activity,
} from 'lucide-react'

interface EndpointDetailDrawerProps {
  isOpen: boolean
  onClose: () => void
  endpoint: Endpoint | null
  onEdit: (endpoint: Endpoint) => void
  onTest: (endpoint: Endpoint) => void
  onToggle: (endpoint: Endpoint) => void
}

export const EndpointDetailDrawer: React.FC<EndpointDetailDrawerProps> = ({
  isOpen,
  onClose,
  endpoint,
  onEdit,
  onTest,
  onToggle,
}) => {
  const [copiedUrl, setCopiedUrl] = useState(false)
  const [copiedId, setCopiedId] = useState(false)

  if (!endpoint) return null

  const handleCopyUrl = async () => {
    const ok = await copyToClipboard(endpoint.url)
    if (ok) {
      setCopiedUrl(true)
      setTimeout(() => setCopiedUrl(false), 2000)
    }
  }

  const handleCopyId = async () => {
    const ok = await copyToClipboard(endpoint.id)
    if (ok) {
      setCopiedId(true)
      setTimeout(() => setCopiedId(false), 2000)
    }
  }

  const strategy = (endpoint.retryStrategy ||
    endpoint.retry_strategy ||
    endpoint.retryPolicy?.strategy ||
    'EXPONENTIAL') as 'EXPONENTIAL' | 'FIXED'

  const maxAttempts =
    endpoint.retryMaxAttempts ??
    endpoint.retry_max_attempts ??
    endpoint.retryPolicy?.maxAttempts ??
    8

  const baseDelayMs =
    endpoint.retryBaseDelayMs ??
    endpoint.retry_base_delay_ms ??
    endpoint.retryPolicy?.baseDelayMs ??
    5000

  const maxDelayMs =
    endpoint.retryMaxDelayMs ??
    endpoint.retry_max_delay_ms ??
    endpoint.retryPolicy?.maxDelayMs ??
    3600000

  const backoffMultiplier =
    endpoint.retryBackoffMultiplier ??
    endpoint.retry_backoff_multiplier ??
    endpoint.retryPolicy?.backoffMultiplier ??
    2.0

  const isExponential = strategy === 'EXPONENTIAL'

  return (
    <Drawer
      isOpen={isOpen}
      onClose={onClose}
      title="Endpoint Details"
      subtitle={endpoint.description || 'Webhook destination details and retry policy configuration'}
      width="lg"
      footer={
        <div className="flex items-center justify-between w-full">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onToggle(endpoint)}
            leftIcon={<Power className="w-3.5 h-3.5" />}
          >
            {endpoint.active ? 'Pause Endpoint' : 'Activate Endpoint'}
          </Button>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onTest(endpoint)}
              leftIcon={<FlaskConical className="w-3.5 h-3.5 text-[#5277D9]" />}
            >
              Test Endpoint
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => onEdit(endpoint)}
              leftIcon={<Edit3 className="w-3.5 h-3.5" />}
            >
              Edit Policy
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-6 text-left">
        {/* Destination Header Card */}
        <div className="p-4 bg-[#F7F6F2] rounded-xl border border-[#E7E8EC] space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1 min-w-0">
              <span className="text-3xs uppercase font-semibold text-[#64748B] tracking-wider">
                Destination URL
              </span>
              <div className="flex items-center gap-1.5 font-mono text-xs font-semibold text-[#202938] break-all">
                <span>{endpoint.url}</span>
                <a
                  href={endpoint.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[#64748B] hover:text-[#5277D9] shrink-0"
                  title="Open URL in new tab"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>
            </div>
            <button
              onClick={handleCopyUrl}
              className="text-[#64748B] hover:text-[#202938] p-1 rounded hover:bg-white border border-transparent hover:border-[#E7E8EC] transition-colors shrink-0"
              title="Copy URL"
            >
              {copiedUrl ? <Check className="w-3.5 h-3.5 text-[#159B78]" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2 pt-2 border-t border-[#E7E8EC]/80 text-xs">
            <div>
              <span className="text-3xs text-[#64748B]">Status:</span>{' '}
              {endpoint.active ? (
                <span className="inline-flex items-center gap-1 text-2xs font-semibold text-[#159B78]">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#159B78]" /> Active
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-2xs font-semibold text-[#64748B]">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#64748B]" /> Paused
                </span>
              )}
            </div>
            <div>
              <span className="text-3xs text-[#64748B]">Rate Limit:</span>{' '}
              <span className="font-semibold text-[#202938] text-2xs">{endpoint.rate_limit_rps} RPS</span>
            </div>
          </div>
        </div>

        {/* Custom Retry Policy Section */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <RotateCcw className="w-4 h-4 text-[#5277D9]" />
              <h3 className="text-sm font-semibold text-[#202938]">Configured Retry Policy</h3>
            </div>
            <span
              className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-2xs font-semibold border ${
                isExponential
                  ? 'bg-[#EAF0FF] text-[#5277D9] border-[#DCE5FA]'
                  : 'bg-emerald-50 text-emerald-700 border-emerald-200'
              }`}
            >
              {isExponential ? <Zap className="w-3 h-3" /> : <Clock className="w-3 h-3" />}
              {isExponential ? 'Exponential Backoff' : 'Fixed Delay'}
            </span>
          </div>

          <div className="bg-white rounded-xl border border-[#E7E8EC] divide-y divide-[#E7E8EC] overflow-hidden text-xs">
            <div className="p-3.5 flex items-center justify-between">
              <div>
                <p className="font-semibold text-[#202938]">Retry Strategy</p>
                <p className="text-3xs text-[#64748B]">
                  {isExponential
                    ? 'Exponential growth between attempts with max delay ceiling'
                    : 'Constant interval between retry attempts'}
                </p>
              </div>
              <span className="font-mono font-semibold text-[#202938] text-xs">
                {strategy}
              </span>
            </div>

            <div className="p-3.5 flex items-center justify-between">
              <div>
                <p className="font-semibold text-[#202938]">Maximum Retry Attempts</p>
                <p className="text-3xs text-[#64748B]">Attempt limit before sending to DLQ</p>
              </div>
              <span className="font-mono font-bold text-[#5277D9] text-sm">
                {maxAttempts} <span className="text-2xs font-normal text-[#64748B]">attempts</span>
              </span>
            </div>

            <div className="p-3.5 flex items-center justify-between">
              <div>
                <p className="font-semibold text-[#202938]">
                  {isExponential ? 'Base Delay' : 'Fixed Interval Delay'}
                </p>
                <p className="text-3xs text-[#64748B]">Initial wait time before the first retry</p>
              </div>
              <div className="text-right">
                <span className="font-mono font-semibold text-[#202938] text-xs">
                  {baseDelayMs.toLocaleString('en-US')} ms
                </span>
                <span className="block text-3xs text-[#64748B]">({formatDuration(baseDelayMs)})</span>
              </div>
            </div>

            {isExponential && (
              <>
                <div className="p-3.5 flex items-center justify-between">
                  <div>
                    <p className="font-semibold text-[#202938]">Maximum Delay Cap</p>
                    <p className="text-3xs text-[#64748B]">Maximum delay ceiling per retry</p>
                  </div>
                  <div className="text-right">
                    <span className="font-mono font-semibold text-[#202938] text-xs">
                      {maxDelayMs.toLocaleString('en-US')} ms
                    </span>
                    <span className="block text-3xs text-[#64748B]">({formatDuration(maxDelayMs)})</span>
                  </div>
                </div>

                <div className="p-3.5 flex items-center justify-between">
                  <div>
                    <p className="font-semibold text-[#202938]">Backoff Multiplier</p>
                    <p className="text-3xs text-[#64748B]">Multiplier applied to delay on each retry</p>
                  </div>
                  <span className="font-mono font-semibold text-[#202938] text-xs">
                    {backoffMultiplier.toFixed(1)}x
                  </span>
                </div>
              </>
            )}
          </div>

          {/* Narrative Policy Explanation */}
          <div className="p-3 bg-[#EAF0FF]/50 border border-[#DCE5FA] rounded-xl text-xs text-[#202938] space-y-1">
            <p className="font-semibold text-[#5277D9] flex items-center gap-1.5">
              <Activity className="w-3.5 h-3.5" />
              Delivery Behavior Summary
            </p>
            <p className="text-3xs leading-relaxed text-[#4366C4]">
              When a webhook delivery to this endpoint encounters a retryable failure (5xx or network
              timeout), HookForge will execute up to{' '}
              <strong>{maxAttempts} retries</strong> using{' '}
              <strong>
                {isExponential
                  ? `exponential backoff starting at ${formatDuration(baseDelayMs)} (x${backoffMultiplier}, max ${formatDuration(maxDelayMs)})`
                  : `fixed delay of ${formatDuration(baseDelayMs)}`}
              </strong>
              . Non-retryable responses (4xx client errors) are not retried. If all {maxAttempts} retries
              fail, the delivery moves to the Dead Letter Queue.
            </p>
          </div>
        </div>

        {/* Resilience & Circuit Breaker */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-[#5277D9]" />
            <h3 className="text-sm font-semibold text-[#202938]">Resilience & Circuit State</h3>
          </div>

          <div className="p-4 bg-white rounded-xl border border-[#E7E8EC] space-y-3 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-[#64748B]">Circuit Breaker:</span>
              <CircuitBadge
                state={endpoint.circuit_state}
                consecutiveFailures={endpoint.consecutive_failures}
              />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[#64748B]">Consecutive Failures:</span>
              <span className="font-mono font-semibold text-[#202938]">
                {endpoint.consecutive_failures ?? 0}
              </span>
            </div>
            {endpoint.circuit_until && (
              <div className="flex items-center justify-between">
                <span className="text-[#64748B]">Circuit Tripped Until:</span>
                <span className="font-mono text-2xs text-[#E76B64]">
                  {formatDateTime(endpoint.circuit_until)}
                </span>
              </div>
            )}
            <div className="flex items-center justify-between pt-2 border-t border-[#E7E8EC]">
              <span className="text-[#64748B]">Total Dispatched:</span>
              <span className="font-mono font-semibold text-[#202938]">
                {(endpoint.total_deliveries ?? 0).toLocaleString()}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[#64748B]">Success Rate:</span>
              <span className="font-mono font-semibold text-[#159B78]">
                {endpoint.success_rate != null ? `${endpoint.success_rate}%` : 'N/A'}
              </span>
            </div>
          </div>
        </div>

        {/* Metadata */}
        <div className="space-y-2 pt-2 border-t border-[#E7E8EC] text-2xs text-[#64748B]">
          <div className="flex items-center justify-between">
            <span>Endpoint ID:</span>
            <div className="flex items-center gap-1 font-mono text-[#202938]">
              <span>{endpoint.id}</span>
              <button
                onClick={handleCopyId}
                className="hover:text-[#5277D9] cursor-pointer"
                title="Copy ID"
              >
                {copiedId ? <Check className="w-3 h-3 text-[#159B78]" /> : <Copy className="w-3 h-3" />}
              </button>
            </div>
          </div>
          <div className="flex items-center justify-between">
            <span>Created At:</span>
            <span className="font-mono text-[#202938]">{formatDateTime(endpoint.created_at)}</span>
          </div>
        </div>
      </div>
    </Drawer>
  )
}
