import React from 'react'
import {
  Activity,
  Cpu,
  CheckCircle2,
  AlertOctagon,
  Clock,
  HeartPulse,
  HelpCircle,
  AlertTriangle,
  Zap,
  RefreshCw,
} from 'lucide-react'
import { Card, CardHeader, CardTitle, CardContent } from './ui/Card'
import { formatDateTime, formatRelativeTime } from '../utils/formatters'
import type { WorkerHealth } from '../types'

interface WorkerHealthCardProps {
  health: {
    status: 'checking' | 'up' | 'down' | 'degraded'
    error?: string
    timestamp?: string
    checks?: {
      database?: {
        status: 'up' | 'down'
        error?: string
      }
      worker?: WorkerHealth
    }
  }
  onRefresh?: () => void
  isLoading?: boolean
}

export const WorkerHealthCard: React.FC<WorkerHealthCardProps> = ({
  health,
  onRefresh,
  isLoading = false,
}) => {
  const worker = health?.checks?.worker
  const isChecking = health.status === 'checking' && !health.timestamp

  // Resolve overall worker status: Healthy, Unavailable, or Unknown
  let workerStatus: 'Healthy' | 'Unavailable' | 'Unknown' = 'Unknown'
  let statusBadgeClass = 'bg-[#64748B]/10 text-[#64748B] border-[#64748B]/25'
  let statusDescription = 'Worker status not reported by backend'
  let StatusIcon = HelpCircle

  if (health.status === 'down') {
    workerStatus = 'Unavailable'
    statusBadgeClass = 'bg-[#E76B64]/10 text-[#E76B64] border-[#E76B64]/25'
    statusDescription = health.error || 'Worker service unreachable or offline'
    StatusIcon = AlertOctagon
  } else if (worker?.status === 'up') {
    workerStatus = 'Healthy'
    statusBadgeClass = 'bg-[#159B78]/10 text-[#159B78] border-[#159B78]/25'
    statusDescription = 'Delivery dispatcher loop is active and polling queue'
    StatusIcon = CheckCircle2
  } else if (worker?.status === 'down' || worker?.status === 'unavailable') {
    workerStatus = 'Unavailable'
    statusBadgeClass = 'bg-[#E76B64]/10 text-[#E76B64] border-[#E76B64]/25'
    statusDescription = worker?.error || 'Dispatcher stopped or offline'
    StatusIcon = AlertOctagon
  } else if (worker?.status === 'degraded') {
    workerStatus = 'Unavailable'
    statusBadgeClass = 'bg-[#E5B34B]/15 text-[#B8871E] border-[#E5B34B]/30'
    statusDescription = 'Dispatcher running but database lease queries degraded'
    StatusIcon = AlertTriangle
  } else if (health.status === 'up' && !worker) {
    workerStatus = 'Unknown'
    statusBadgeClass = 'bg-[#64748B]/10 text-[#64748B] border-[#64748B]/25'
    statusDescription = 'Connected backend does not expose worker telemetry'
    StatusIcon = HelpCircle
  }

  // Determine metric availability
  const hasActiveWorkers = worker?.activeWorkers !== undefined && worker?.activeWorkers !== null
  const hasProcessing = worker?.currentlyProcessing !== undefined && worker?.currentlyProcessing !== null
  const hasHeartbeat = Boolean(worker?.lastHeartbeat)
  const hasTimestamp = Boolean(health.timestamp)

  return (
    <Card className="overflow-hidden min-w-0 bg-white">
      <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pb-3 border-b border-[#E7E8EC] bg-[#F7F6F2]">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-[#EAF0FF] border border-[#DCE5FA] flex items-center justify-center text-[#5277D9] shrink-0">
            <HeartPulse className="w-4 h-4 text-[#5277D9]" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <CardTitle>Worker Health & Telemetry</CardTitle>
              {isChecking && (
                <span className="text-3xs px-2 py-0.5 rounded font-semibold bg-[#EAF0FF] text-[#5277D9] animate-pulse">
                  Probing...
                </span>
              )}
            </div>
            <p className="text-xs text-[#64748B]">
              Real-time delivery dispatcher loop, active worker concurrency, and leases
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto">
          {onRefresh && (
            <button
              type="button"
              onClick={onRefresh}
              disabled={isLoading}
              className="inline-flex items-center justify-center gap-1.5 px-2.5 py-1 text-xs font-medium text-[#202938] bg-white border border-[#E7E8EC] rounded-lg hover:bg-[#F7F6F2] transition-colors cursor-pointer disabled:opacity-50"
              title="Refresh worker health"
              aria-label="Refresh worker health"
            >
              <RefreshCw className={`w-3.5 h-3.5 text-[#64748B] ${isLoading ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">Refresh</span>
            </button>
          )}

          {/* Status Badge */}
          <span
            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border transition-colors shadow-2xs ${statusBadgeClass}`}
            data-testid="worker-status-badge"
          >
            <StatusIcon className="w-3.5 h-3.5 shrink-0" />
            <span>{workerStatus}</span>
          </span>
        </div>
      </CardHeader>

      <CardContent className="p-3.5 sm:p-5 space-y-4">
        {/* Metric Cards Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {/* Card 1: Overall Worker Status */}
          <div className="p-3 bg-[#F7F6F2] rounded-xl border border-[#E7E8EC] space-y-1 text-left">
            <div className="flex items-center justify-between text-[#64748B]">
              <span className="text-2xs font-semibold uppercase tracking-wider">Worker Status</span>
              <Activity className="w-3.5 h-3.5 text-[#64748B]" />
            </div>
            <div className="text-sm sm:text-base font-bold text-[#202938] flex items-center gap-1.5">
              <span>{workerStatus}</span>
            </div>
            <p className="text-2xs text-[#64748B] leading-snug truncate" title={statusDescription}>
              {statusDescription}
            </p>
          </div>

          {/* Card 2: Active Worker Count */}
          <div className="p-3 bg-[#F7F6F2] rounded-xl border border-[#E7E8EC] space-y-1 text-left">
            <div className="flex items-center justify-between text-[#64748B]">
              <span className="text-2xs font-semibold uppercase tracking-wider">Active Workers</span>
              <Cpu className="w-3.5 h-3.5 text-[#5277D9]" />
            </div>
            <div className="text-sm sm:text-base font-bold text-[#202938]">
              {hasActiveWorkers ? (
                <span>{worker!.activeWorkers} concurrency</span>
              ) : (
                <span className="text-xs font-medium text-[#64748B]">Unavailable</span>
              )}
            </div>
            <p className="text-2xs text-[#64748B]">
              {hasActiveWorkers ? 'Configured worker slots' : 'Metric not reported by backend'}
            </p>
          </div>

          {/* Card 3: Currently Processing Deliveries */}
          <div className="p-3 bg-[#F7F6F2] rounded-xl border border-[#E7E8EC] space-y-1 text-left">
            <div className="flex items-center justify-between text-[#64748B]">
              <span className="text-2xs font-semibold uppercase tracking-wider">Processing Deliveries</span>
              <Zap className="w-3.5 h-3.5 text-[#B8871E]" />
            </div>
            <div className="text-sm sm:text-base font-bold text-[#202938]">
              {hasProcessing ? (
                <span>{worker!.currentlyProcessing} in flight</span>
              ) : (
                <span className="text-xs font-medium text-[#64748B]">Unavailable</span>
              )}
            </div>
            <p className="text-2xs text-[#64748B]">
              {hasProcessing ? 'Active PostgreSQL leases' : 'Metric not reported by backend'}
            </p>
          </div>

          {/* Card 4: Last Heartbeat & Last Health Check */}
          <div className="p-3 bg-[#F7F6F2] rounded-xl border border-[#E7E8EC] space-y-1 text-left">
            <div className="flex items-center justify-between text-[#64748B]">
              <span className="text-2xs font-semibold uppercase tracking-wider">Heartbeat & Probe</span>
              <Clock className="w-3.5 h-3.5 text-[#159B78]" />
            </div>
            <div className="text-xs font-bold text-[#202938] truncate">
              {hasHeartbeat ? (
                <span>Heartbeat: {formatRelativeTime(worker!.lastHeartbeat)}</span>
              ) : (
                <span className="text-xs font-medium text-[#64748B]">Heartbeat: Unavailable</span>
              )}
            </div>
            <p className="text-2xs text-[#64748B] truncate">
              {hasTimestamp
                ? `Checked: ${formatRelativeTime(health.timestamp)} (${formatDateTime(health.timestamp)})`
                : 'Last check: Unavailable'}
            </p>
          </div>
        </div>

        {/* Unavailable or Error Notice */}
        {workerStatus === 'Unavailable' && (
          <div className="p-3 bg-[#E76B64]/10 border border-[#E76B64]/25 rounded-xl flex items-start gap-2.5 text-left text-xs">
            <AlertTriangle className="w-4 h-4 text-[#E76B64] shrink-0 mt-0.5" />
            <div className="space-y-0.5">
              <p className="font-semibold text-[#E76B64]">Worker Service Unavailable</p>
              <p className="text-2xs text-[#64748B] leading-relaxed">
                The delivery dispatcher service is currently offline or unreachable. Deliveries will remain queued
                in PostgreSQL until the worker process resumes polling.
                {health.error ? ` Error: ${health.error}` : ''}
              </p>
            </div>
          </div>
        )}

        {/* Unknown Metrics Notice */}
        {workerStatus === 'Unknown' && (
          <div className="p-3 bg-[#F7F6F2] border border-[#E7E8EC] rounded-xl flex items-start gap-2.5 text-left text-xs">
            <HelpCircle className="w-4 h-4 text-[#64748B] shrink-0 mt-0.5" />
            <div className="space-y-0.5">
              <p className="font-semibold text-[#202938]">Worker Information Not Reported</p>
              <p className="text-2xs text-[#64748B] leading-relaxed">
                The connected backend is reachable, but does not expose worker-specific telemetry. Database queries
                and REST APIs are operating normally.
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
