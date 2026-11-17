import React from 'react'
import {
  Layers,
  Zap,
  Clock,
  RotateCw,
  CheckCircle2,
  AlertOctagon,
  TrendingUp,
  Inbox,
  ArrowRightLeft,
} from 'lucide-react'
import { Card, CardHeader, CardTitle, CardContent } from './ui/Card'
import type { OverviewMetrics, StatusDistribution, TimeSeriesDataPoint } from '../types'

interface QueueMetricsSectionProps {
  metrics: OverviewMetrics | null
  statusDistribution?: StatusDistribution[]
  timeSeries?: TimeSeriesDataPoint[]
  isLoading?: boolean
  error?: string | null
}

export const QueueMetricsSection: React.FC<QueueMetricsSectionProps> = ({
  metrics,
  statusDistribution = [],
  timeSeries = [],
  isLoading = false,
  error = null,
}) => {
  // Extract state counts with multiple fallback layers to prevent discrepancies
  const succeededCount =
    metrics?.succeededDeliveries ??
    statusDistribution.find((s) => s.name === 'Succeeded')?.value ??
    0

  const deadLetterCount =
    metrics?.deadLetterCount ??
    metrics?.failedDeliveries ??
    statusDistribution.find((s) => s.name === 'Dead Letter')?.value ??
    0

  const pendingCount =
    metrics?.pendingCount ??
    statusDistribution.find((s) => s.name === 'Pending')?.value ??
    0

  const inFlightCount =
    metrics?.inFlightCount ??
    metrics?.currentlyProcessing ??
    statusDistribution.find((s) => s.name === 'In Flight')?.value ??
    0

  const retryingCount =
    metrics?.retryingCount ??
    statusDistribution.find((s) => s.name === 'Retrying')?.value ??
    0

  // Queue backlog: deliveries waiting to be dispatched (pending initial + backoff retrying)
  const queueBacklog =
    metrics?.queueBacklog !== undefined
      ? metrics.queueBacklog
      : pendingCount + retryingCount

  // Currently processing deliveries: in-flight worker lease locks
  const currentlyProcessing =
    metrics?.currentlyProcessing !== undefined
      ? metrics.currentlyProcessing
      : inFlightCount

  // Total deliveries across all states
  const totalDeliveries =
    metrics?.totalDeliveries ??
    succeededCount + deadLetterCount + pendingCount + inFlightCount + retryingCount

  // Active queue load (in queue or in flight)
  const activeQueueLoad = queueBacklog + currentlyProcessing

  // Recent throughput: most recent hour bucket from timeSeries
  const recentThroughput =
    timeSeries.length > 0
      ? timeSeries[timeSeries.length - 1].total
      : 0

  // Compute workload percentages for progress visualization
  const getPercentage = (count: number) => {
    if (totalDeliveries <= 0) return 0
    return Math.round((count / totalDeliveries) * 100)
  }

  const succeededPct = getPercentage(succeededCount)
  const pendingPct = getPercentage(pendingCount)
  const inFlightPct = getPercentage(inFlightCount)
  const retryingPct = getPercentage(retryingCount)
  const deadLetterPct = getPercentage(deadLetterCount)

  if (error) {
    return (
      <Card className="p-4 bg-white border border-[#E76B64]/30 text-left">
        <div className="flex items-center gap-2 text-xs text-[#E76B64] font-semibold">
          <AlertOctagon className="w-4 h-4" />
          <span>Queue Telemetry Unavailable</span>
        </div>
        <p className="text-2xs text-[#64748B] mt-1">{error}</p>
      </Card>
    )
  }

  return (
    <Card className="overflow-hidden min-w-0 bg-white text-left" data-testid="queue-metrics-section">
      <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pb-3 border-b border-[#E7E8EC] bg-[#F7F6F2]">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-[#EAF0FF] border border-[#DCE5FA] flex items-center justify-center text-[#5277D9] shrink-0">
            <Layers className="w-4 h-4 text-[#5277D9]" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <CardTitle>Queue Backlog & Processing Metrics</CardTitle>
              {isLoading && (
                <span className="text-3xs px-2 py-0.5 rounded font-semibold bg-[#EAF0FF] text-[#5277D9] animate-pulse">
                  Updating...
                </span>
              )}
            </div>
            <p className="text-xs text-[#64748B]">
              Durable PostgreSQL work queue states, backlog pressure, and active processing
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto flex-wrap">
          {/* Backlog Status Indicator */}
          <span
            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border transition-colors shadow-2xs ${
              queueBacklog === 0
                ? 'bg-[#159B78]/10 text-[#159B78] border-[#159B78]/25'
                : queueBacklog > 100
                ? 'bg-[#E76B64]/10 text-[#E76B64] border-[#E76B64]/25'
                : 'bg-[#EAF0FF] text-[#5277D9] border-[#DCE5FA]'
            }`}
          >
            {queueBacklog === 0 ? (
              <>
                <CheckCircle2 className="w-3.5 h-3.5 text-[#159B78]" />
                <span>Queue Clean</span>
              </>
            ) : (
              <>
                <Layers className="w-3.5 h-3.5" />
                <span>{queueBacklog} Backlogged</span>
              </>
            )}
          </span>
        </div>
      </CardHeader>

      <CardContent className="p-3.5 sm:p-5 space-y-5">
        {/* Metric Cards Grid: 7 key metrics */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-2.5 sm:gap-3">
          {/* 1. Total Queue Backlog */}
          <div className="p-3 bg-[#F7F6F2] rounded-xl border border-[#E7E8EC] space-y-1">
            <div className="flex items-center justify-between text-[#64748B]">
              <span className="text-2xs font-semibold uppercase tracking-wider">Queue Backlog</span>
              <Layers className="w-3.5 h-3.5 text-[#5277D9]" />
            </div>
            <div className="text-base sm:text-lg font-bold text-[#202938]">
              {queueBacklog}
            </div>
            <p className="text-2xs text-[#64748B] truncate" title="Pending + Retrying waiting">
              Pending + Retrying
            </p>
          </div>

          {/* 2. Currently Processing (In-Flight) */}
          <div className="p-3 bg-[#F7F6F2] rounded-xl border border-[#E7E8EC] space-y-1">
            <div className="flex items-center justify-between text-[#64748B]">
              <span className="text-2xs font-semibold uppercase tracking-wider">In-Flight</span>
              <Zap className="w-3.5 h-3.5 text-[#5277D9]" />
            </div>
            <div className="text-base sm:text-lg font-bold text-[#5277D9]">
              {currentlyProcessing}
            </div>
            <p className="text-2xs text-[#64748B] truncate" title="Active worker lease locks">
              Currently processing
            </p>
          </div>

          {/* 3. Pending Deliveries */}
          <div className="p-3 bg-[#F7F6F2] rounded-xl border border-[#E7E8EC] space-y-1">
            <div className="flex items-center justify-between text-[#64748B]">
              <span className="text-2xs font-semibold uppercase tracking-wider">Pending</span>
              <Clock className="w-3.5 h-3.5 text-[#64748B]" />
            </div>
            <div className="text-base sm:text-lg font-bold text-[#202938]">
              {pendingCount}
            </div>
            <p className="text-2xs text-[#64748B] truncate" title="Initial dispatch queue">
              Initial queue
            </p>
          </div>

          {/* 4. Retrying Deliveries */}
          <div className="p-3 bg-[#F7F6F2] rounded-xl border border-[#E7E8EC] space-y-1">
            <div className="flex items-center justify-between text-[#64748B]">
              <span className="text-2xs font-semibold uppercase tracking-wider">Retrying</span>
              <RotateCw className="w-3.5 h-3.5 text-[#B8871E]" />
            </div>
            <div className="text-base sm:text-lg font-bold text-[#B8871E]">
              {retryingCount}
            </div>
            <p className="text-2xs text-[#64748B] truncate" title="Exponential backoff retry">
              Retry backoff
            </p>
          </div>

          {/* 5. Successfully Delivered */}
          <div className="p-3 bg-[#F7F6F2] rounded-xl border border-[#E7E8EC] space-y-1">
            <div className="flex items-center justify-between text-[#64748B]">
              <span className="text-2xs font-semibold uppercase tracking-wider">Delivered</span>
              <CheckCircle2 className="w-3.5 h-3.5 text-[#159B78]" />
            </div>
            <div className="text-base sm:text-lg font-bold text-[#159B78]">
              {succeededCount}
            </div>
            <p className="text-2xs text-[#64748B] truncate" title="2xx HTTP responses">
              HTTP 2xx Success
            </p>
          </div>

          {/* 6. Dead-Letter Deliveries */}
          <div className="p-3 bg-[#F7F6F2] rounded-xl border border-[#E7E8EC] space-y-1">
            <div className="flex items-center justify-between text-[#64748B]">
              <span className="text-2xs font-semibold uppercase tracking-wider">Dead Letters</span>
              <AlertOctagon className="w-3.5 h-3.5 text-[#E76B64]" />
            </div>
            <div className="text-base sm:text-lg font-bold text-[#E76B64]">
              {deadLetterCount}
            </div>
            <p className="text-2xs text-[#64748B] truncate" title="Max retries exhausted">
              Exhausted retries
            </p>
          </div>

          {/* 7. Recent Throughput */}
          <div className="p-3 bg-[#F7F6F2] rounded-xl border border-[#E7E8EC] space-y-1 col-span-2 sm:col-span-1">
            <div className="flex items-center justify-between text-[#64748B]">
              <span className="text-2xs font-semibold uppercase tracking-wider">Throughput</span>
              <TrendingUp className="w-3.5 h-3.5 text-[#159B78]" />
            </div>
            <div className="text-base sm:text-lg font-bold text-[#202938]">
              {recentThroughput} <span className="text-2xs font-normal text-[#64748B]">/ hr</span>
            </div>
            <p className="text-2xs text-[#64748B] truncate" title="Dispatches in past 60 minutes">
              Past 60m window
            </p>
          </div>
        </div>

        {/* Workload Activity Bar & Ratio Comparison */}
        <div className="p-3.5 sm:p-4 bg-[#F7F6F2] rounded-xl border border-[#E7E8EC] space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 text-xs">
            <div className="flex items-center gap-2">
              <ArrowRightLeft className="w-4 h-4 text-[#5277D9]" />
              <span className="font-semibold text-[#202938]">Queue Workload Distribution</span>
            </div>
            <span className="text-2xs text-[#64748B]">
              {activeQueueLoad > 0
                ? `${queueBacklog} awaiting dispatch • ${currentlyProcessing} currently leased`
                : 'Queue is currently idle'}
            </span>
          </div>

          {/* Proportional Stacked Progress Bar */}
          {totalDeliveries === 0 ? (
            <div className="py-2 text-center text-xs text-[#64748B] flex items-center justify-center gap-1.5">
              <Inbox className="w-3.5 h-3.5 text-[#64748B]" />
              <span>No deliveries currently recorded. Queue is clear.</span>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="w-full h-3 rounded-full bg-white border border-[#E7E8EC] overflow-hidden flex">
                {succeededCount > 0 && (
                  <div
                    style={{ width: `${Math.max(succeededPct, 2)}%` }}
                    className="h-full bg-[#159B78] transition-all duration-300"
                    title={`Delivered: ${succeededCount} (${succeededPct}%)`}
                  />
                )}
                {inFlightCount > 0 && (
                  <div
                    style={{ width: `${Math.max(inFlightPct, 2)}%` }}
                    className="h-full bg-[#5277D9] transition-all duration-300"
                    title={`In-Flight: ${inFlightCount} (${inFlightPct}%)`}
                  />
                )}
                {pendingCount > 0 && (
                  <div
                    style={{ width: `${Math.max(pendingPct, 2)}%` }}
                    className="h-full bg-[#64748B] transition-all duration-300"
                    title={`Pending: ${pendingCount} (${pendingPct}%)`}
                  />
                )}
                {retryingCount > 0 && (
                  <div
                    style={{ width: `${Math.max(retryingPct, 2)}%` }}
                    className="h-full bg-[#E5B34B] transition-all duration-300"
                    title={`Retrying: ${retryingCount} (${retryingPct}%)`}
                  />
                )}
                {deadLetterCount > 0 && (
                  <div
                    style={{ width: `${Math.max(deadLetterPct, 2)}%` }}
                    className="h-full bg-[#E76B64] transition-all duration-300"
                    title={`Dead Letters: ${deadLetterCount} (${deadLetterPct}%)`}
                  />
                )}
              </div>

              {/* Legend with Counts and Percentages */}
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-2xs text-[#64748B] pt-0.5">
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-[#159B78]" />
                  <span>Succeeded: <strong className="text-[#202938]">{succeededCount}</strong> ({succeededPct}%)</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-[#5277D9]" />
                  <span>In-Flight: <strong className="text-[#202938]">{inFlightCount}</strong> ({inFlightPct}%)</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-[#64748B]" />
                  <span>Pending: <strong className="text-[#202938]">{pendingCount}</strong> ({pendingPct}%)</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-[#E5B34B]" />
                  <span>Retrying: <strong className="text-[#202938]">{retryingCount}</strong> ({retryingPct}%)</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-[#E76B64]" />
                  <span>Dead Letters: <strong className="text-[#202938]">{deadLetterCount}</strong> ({deadLetterPct}%)</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
