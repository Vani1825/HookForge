import React, { useState, useEffect, useCallback, useRef } from 'react'
import {
  Clock,
  CheckCircle2,
  AlertOctagon,
  RefreshCw,
  Globe2,
  Calendar,
} from 'lucide-react'
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/Card'
import { StatCard } from '../components/StatCard'
import { Button } from '../components/ui/Button'
import { PageHeader } from '../components/ui/PageHeader'
import { CircuitBadge } from '../components/CircuitBadge'
import { TableSkeleton } from '../components/ui/LoadingSkeleton'
import { useApp } from '../context/AppContext'
import { formatErrorMessage } from '../api/client'
import { formatRate, formatLatency } from '../utils/formatters'
import type { OverviewMetrics, TimeSeriesDataPoint, Endpoint, Delivery } from '../types'
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts'

type DateRangeOption = '24h' | '7d' | '30d'

function formatDateRangeBounds(range: DateRangeOption) {
  const now = new Date()
  let durationMs = 24 * 60 * 60 * 1000
  if (range === '7d') durationMs = 7 * 24 * 60 * 60 * 1000
  else if (range === '30d') durationMs = 30 * 24 * 60 * 60 * 1000

  const start = new Date(now.getTime() - durationMs)
  const formatOpt: Intl.DateTimeFormatOptions = {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
    ...(range === '24h' ? { hour: '2-digit', minute: '2-digit', hour12: false } : {}),
  }
  const dtf = new Intl.DateTimeFormat('en-US', formatOpt)
  const startStr = dtf.format(start)
  const endStr = dtf.format(now)
  return `${startStr} – ${endStr} UTC`
}

function getRangeBoundsISO(range: DateRangeOption) {
  const now = new Date()
  let durationMs = 24 * 60 * 60 * 1000
  if (range === '7d') durationMs = 7 * 24 * 60 * 60 * 1000
  else if (range === '30d') durationMs = 30 * 24 * 60 * 60 * 1000

  const start = new Date(now.getTime() - durationMs)
  return {
    created_after: start.toISOString(),
    created_before: now.toISOString(),
    range,
  }
}

export const AnalyticsPage: React.FC = () => {
  const { service, mode } = useApp()

  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dateRange, setDateRange] = useState<DateRangeOption>('24h')

  const [metrics, setMetrics] = useState<OverviewMetrics | null>(null)
  const [timeSeries, setTimeSeries] = useState<TimeSeriesDataPoint[]>([])
  const [endpoints, setEndpoints] = useState<Endpoint[]>([])
  const [deliveries, setDeliveries] = useState<Delivery[]>([])

  // Guard against out-of-order responses and race conditions
  const latestRequestIdRef = useRef(0)

  const loadData = useCallback(
    async (targetRange: DateRangeOption = dateRange) => {
      const reqId = ++latestRequestIdRef.current
      setIsLoading(true)
      setError(null)

      const filter = { ...getRangeBoundsISO(targetRange), range: targetRange }

      try {
        const [m, ts, eps, dels] = await Promise.all([
          service.getOverviewMetrics(filter),
          service.getTimeSeriesMetrics(filter),
          service.getEndpoints(),
          service.getDeliveries({
            created_after: filter.created_after,
            created_before: filter.created_before,
            limit: 1000,
          }).catch(() => [] as any),
        ])

        if (reqId !== latestRequestIdRef.current) return

        setMetrics(m)
        setTimeSeries(ts || [])
        setEndpoints(eps || [])
        setDeliveries(Array.isArray(dels) ? dels : (dels as any)?.data || (dels as any)?.deliveries || [])
      } catch (err: unknown) {
        if (reqId !== latestRequestIdRef.current) return
        const msg = formatErrorMessage(err)
        setError(msg)
      } finally {
        if (reqId === latestRequestIdRef.current) {
          setIsLoading(false)
        }
      }
    },
    [service, dateRange]
  )

  useEffect(() => {
    loadData(dateRange)
  }, [loadData, mode, dateRange])

  const handleRangeChange = (newRange: DateRangeOption) => {
    setDateRange(newRange)
    loadData(newRange)
  }

  const failureRate =
    metrics && metrics.totalDeliveries > 0
      ? (metrics.failedDeliveries / metrics.totalDeliveries) * 100
      : 0

  if (error && mode === 'live') {
    return (
      <div className="p-6 bg-white border border-rose-200 rounded-xl space-y-3 text-left">
        <h3 className="text-sm font-bold text-rose-700">Analytics Query Failed</h3>
        <p className="text-xs text-slate-600">{error}</p>
        <Button variant="outline" size="sm" onClick={() => loadData(dateRange)}>Retry</Button>
      </div>
    )
  }

  const activeRangeBoundsText = formatDateRangeBounds(dateRange)

  return (
    <div className="space-y-6 text-left">
      {/* Header */}
      <PageHeader
        title="Delivery Analytics"
        description="Operational metrics, endpoint reliability distributions, and throughput diagnostics."
        actions={
          <div className="flex flex-col sm:flex-row sm:items-center gap-2">
            {/* Active Range Boundaries Indicator */}
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#F7F6F2] border border-[#E7E8EC] text-2xs text-[#64748B] font-medium">
              <Calendar className="w-3.5 h-3.5 text-[#64748B]" />
              <span className="font-semibold text-[#202938]">{dateRange.toUpperCase()}:</span>
              <span className="font-mono text-[#64748B]">{activeRangeBoundsText}</span>
            </div>

            <div className="flex items-center gap-2">
              {/* Date range picker */}
              <div
                role="group"
                aria-label="Analytics date range selection"
                className="inline-flex rounded-lg border border-[#E7E8EC] bg-white p-0.5 shadow-2xs text-xs"
              >
                {(['24h', '7d', '30d'] as const).map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => handleRangeChange(r)}
                    aria-pressed={dateRange === r}
                    className={`px-3 py-1 rounded-md font-medium transition-colors cursor-pointer ${
                      dateRange === r
                        ? 'bg-[#5277D9] text-white shadow-xs'
                        : 'text-[#64748B] hover:text-[#202938]'
                    }`}
                  >
                    {r.toUpperCase()}
                  </button>
                ))}
              </div>

              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => loadData(dateRange)}
                isLoading={isLoading}
                leftIcon={<RefreshCw className="w-3.5 h-3.5" />}
                aria-label="Refresh analytics data"
              >
                Refresh
              </Button>
            </div>
          </div>
        }
      />

      {/* KPI Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Success Rate"
          value={formatRate(metrics?.successRate, metrics?.totalDeliveries)}
          subtitle={
            (metrics?.totalDeliveries ?? 0) > 0 ? '2xx HTTP responses' : 'No delivery data'
          }
          icon={<CheckCircle2 className="w-4 h-4 text-[#159B78]" />}
          trend={
            (metrics?.totalDeliveries ?? 0) > 0
              ? { value: 'Target: >99.0%', isPositive: (metrics?.successRate ?? 0) >= 99 }
              : undefined
          }
        />

        <StatCard
          title="Failure Rate"
          value={formatRate(failureRate, metrics?.totalDeliveries)}
          subtitle={
            (metrics?.totalDeliveries ?? 0) > 0 ? 'Dead letter exhausts' : 'No delivery data'
          }
          icon={<AlertOctagon className="w-4 h-4 text-[#E76B64]" />}
          trend={
            (metrics?.totalDeliveries ?? 0) > 0
              ? { value: 'Target: <1.0%', isPositive: failureRate <= 1 }
              : undefined
          }
        />

        <StatCard
          title="Average Latency"
          value={formatLatency(metrics?.averageLatencyMs)}
          subtitle="Network + target processing"
          icon={<Clock className="w-4 h-4 text-[#5277D9]" />}
        />

        <StatCard
          title="Monitored Endpoints"
          value={endpoints.length}
          subtitle={`${metrics?.openCircuits ?? 0} circuit(s) tripped`}
          icon={<Globe2 className="w-4 h-4 text-[#5277D9]" />}
        />
      </div>

      {/* Charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Success vs Failed Bar Chart */}
        <Card>
          <CardHeader className="bg-[#F7F6F2] border-b border-[#E7E8EC] py-3.5">
            <CardTitle>Delivery Outcomes Over Time</CardTitle>
            <p className="text-xs text-[#64748B]">
              {dateRange === '24h' ? 'Hourly' : 'Daily'} ratio of successful vs failed deliveries (UTC, {dateRange.toUpperCase()})
            </p>
          </CardHeader>
          <CardContent className="h-72 p-5">
            {timeSeries.length === 0 ? (
              <div className="h-full flex items-center justify-center text-xs text-[#64748B]">
                No delivery activity recorded for this period.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={timeSeries} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E7E8EC" />
                  <XAxis dataKey="label" stroke="#64748B" fontSize={11} tickLine={false} />
                  <YAxis stroke="#64748B" fontSize={11} tickLine={false} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#ffffff',
                      borderColor: '#E7E8EC',
                      borderRadius: '8px',
                      fontSize: '12px',
                      color: '#202938',
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: '12px' }} />
                  <Bar dataKey="succeeded" name="Succeeded" fill="#159B78" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="failed" name="Failed (DLQ)" fill="#E76B64" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Volume Trend Area Chart */}
        <Card>
          <CardHeader className="bg-[#F7F6F2] border-b border-[#E7E8EC] py-3.5">
            <CardTitle>Total Dispatch Throughput</CardTitle>
            <p className="text-xs text-[#64748B]">
              {dateRange === '24h' ? 'Hourly' : 'Daily'} aggregate delivery request volume (UTC, {dateRange.toUpperCase()})
            </p>
          </CardHeader>
          <CardContent className="h-72 p-5">
            {timeSeries.length === 0 ? (
              <div className="h-full flex items-center justify-center text-xs text-[#64748B]">
                No delivery activity recorded for this period.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={timeSeries} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E7E8EC" />
                  <XAxis dataKey="label" stroke="#64748B" fontSize={11} tickLine={false} />
                  <YAxis stroke="#64748B" fontSize={11} tickLine={false} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#ffffff',
                      borderColor: '#E7E8EC',
                      borderRadius: '8px',
                      fontSize: '12px',
                      color: '#202938',
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="total"
                    name="Total Deliveries"
                    stroke="#5277D9"
                    strokeWidth={2}
                    fill="#5277D9"
                    fillOpacity={0.15}
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Endpoint-level breakdown table */}
      <Card className="overflow-hidden">
        <CardHeader className="bg-[#F7F6F2] border-b border-[#E7E8EC] py-3.5">
          <CardTitle>Endpoint Reliability Breakdown</CardTitle>
          <p className="text-xs text-[#64748B]">
            Per-destination delivery success rates and circuit status for the selected {dateRange.toUpperCase()} window
          </p>
        </CardHeader>

        {isLoading && !metrics ? (
          <TableSkeleton rows={4} cols={5} />
        ) : endpoints.length === 0 ? (
          <div className="p-8 text-center text-xs text-[#64748B]">No endpoints found.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#F7F6F2] border-b border-[#E7E8EC] text-[#64748B] font-semibold">
                <tr>
                  <th className="py-3 px-4">Endpoint Destination</th>
                  <th className="py-3 px-4">Circuit Health</th>
                  <th className="py-3 px-4">Rate Ceiling</th>
                  <th className="py-3 px-4">Deliveries Recorded</th>
                  <th className="py-3 px-4 text-right">Success Rate</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E7E8EC]">
                {endpoints.map((ep) => {
                  const epDeliveries = deliveries.filter((d) => d.endpoint_id === ep.id)
                  const epSuccess = epDeliveries.filter((d) => d.state === 'SUCCEEDED').length
                  const epTotal = epDeliveries.length || (ep.total_deliveries ?? 0)
                  const computedRate = epDeliveries.length > 0
                    ? (epSuccess / epDeliveries.length) * 100
                    : ep.success_rate ?? 100

                  return (
                    <tr key={ep.id} className="hover:bg-[#F7F6F2]/70 transition-colors">
                      <td className="py-3 px-4 font-mono font-semibold text-[#202938]">
                        {ep.url}
                      </td>
                      <td className="py-3 px-4">
                        <CircuitBadge state={ep.circuit_state} consecutiveFailures={ep.consecutive_failures} />
                      </td>
                      <td className="py-3 px-4 text-[#202938] font-medium">
                        {ep.rate_limit_rps} RPS
                      </td>
                      <td className="py-3 px-4 text-[#202938]">
                        {epTotal.toLocaleString()}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <span
                          className={`font-semibold ${
                            computedRate >= 98
                              ? 'text-[#159B78]'
                              : computedRate >= 90
                              ? 'text-[#E5B34B]'
                              : 'text-[#E76B64]'
                          }`}
                        >
                          {formatRate(computedRate)}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}
