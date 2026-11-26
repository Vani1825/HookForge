import React, { useState, useEffect, useCallback, useRef } from 'react'
import {
  Inbox,
  CheckCircle2,
  AlertOctagon,
  Clock,
  TrendingUp,
  RefreshCw,
  ChevronRight,
  Settings as SettingsIcon,
} from 'lucide-react'
import { StatCard } from '../components/StatCard'
import { StatusBadge } from '../components/StatusBadge'
import { CircuitBadge } from '../components/CircuitBadge'
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { PageHeader } from '../components/ui/PageHeader'
import { TableSkeleton, CardSkeleton } from '../components/ui/LoadingSkeleton'
import { DeliveryDetailDrawer } from '../components/DeliveryDetailDrawer'
import { formatRelativeTime, truncateId, formatStatusCode, formatRate } from '../utils/formatters'
import { useApp } from '../context/AppContext'
import { formatErrorMessage } from '../api/client'
import type { Delivery, Endpoint, OverviewMetrics, TimeSeriesDataPoint, StatusDistribution } from '../types'
import {
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import { NavLink } from 'react-router-dom'
import { WorkerHealthCard } from '../components/WorkerHealthCard'
import { QueueMetricsSection } from '../components/QueueMetricsSection'

export const DashboardPage: React.FC = () => {
  const { service, mode, toggleMode, backendHealth, checkHealth } = useApp()

  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [metrics, setMetrics] = useState<OverviewMetrics | null>(null)
  const [timeSeries, setTimeSeries] = useState<TimeSeriesDataPoint[]>([])
  const [statusDistribution, setStatusDistribution] = useState<StatusDistribution[]>([])
  const [recentDeliveries, setRecentDeliveries] = useState<Delivery[]>([])
  const [endpoints, setEndpoints] = useState<Endpoint[]>([])

  const [selectedDelivery, setSelectedDelivery] = useState<Delivery | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)

  // Real-time lifecycle activity polling state
  const [isLivePolling, setIsLivePolling] = useState(true)
  const [pollInterval, setPollInterval] = useState<number>(5)
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null)
  const isPollingRef = useRef(false)

  const loadData = useCallback(async (isInitial = false) => {
    if (isInitial) {
      setIsLoading(true)
    } else {
      setIsRefreshing(true)
    }
    setError(null)
    try {
      const [m, ts, sd, delivs, eps] = await Promise.all([
        service.getOverviewMetrics(),
        service.getTimeSeriesMetrics(),
        service.getStatusDistribution(),
        service.getDeliveries({ limit: 8 }),
        service.getEndpoints(),
        checkHealth(),
      ])
      setMetrics(m)
      setTimeSeries(ts)
      setStatusDistribution(sd)
      setRecentDeliveries(delivs.slice(0, 8))
      setEndpoints(eps)
      setLastRefreshedAt(new Date())
    } catch (err: unknown) {
      const msg = formatErrorMessage(err)
      setError(msg)
    } finally {
      if (isInitial) {
        setIsLoading(false)
      }
      setIsRefreshing(false)
    }
  }, [service, checkHealth])

  useEffect(() => {
    loadData(true)
  }, [loadData, mode])

  // Periodic real-time background refresh
  useEffect(() => {
    if (!isLivePolling || pollInterval <= 0) return

    const intervalId = setInterval(() => {
      if (document.visibilityState === 'visible' && !isPollingRef.current) {
        isPollingRef.current = true
        loadData(false).finally(() => {
          isPollingRef.current = false
        })
      }
    }, pollInterval * 1000)

    return () => clearInterval(intervalId)
  }, [isLivePolling, pollInterval, loadData])

  const handleInspect = (del: Delivery) => {
    setSelectedDelivery(del)
    setDrawerOpen(true)
  }

  const totalDeliveriesCount =
    metrics?.totalDeliveries ??
    ((metrics?.succeededDeliveries ?? 0) +
      (metrics?.failedDeliveries ?? 0) +
      (metrics?.pendingDeliveries ?? 0))

  return (
    <div className="space-y-6 text-left">
      {/* Header Refresh Bar with Real-time Feed Controls */}
      <PageHeader
        title="System Reliability Overview"
        description="Real-time webhook delivery pipelines, head-of-line durability, and circuit breaker status."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {/* Live activity indicator badge */}
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#F7F6F2] border border-[#E7E8EC] text-2xs text-[#64748B]">
              <span
                className={`w-2 h-2 rounded-full shrink-0 ${isLivePolling ? 'bg-[#159B78] animate-pulse' : 'bg-gray-400'
                  }`}
              />
              <span className="font-semibold text-[#202938]">
                {isLivePolling ? 'LIVE FEED' : 'PAUSED'}
              </span>
              {lastRefreshedAt && (
                <span className="text-[#64748B] text-3xs font-mono hidden sm:inline">
                  • {lastRefreshedAt.toLocaleTimeString()}
                </span>
              )}
            </div>

            {/* Polling Interval Selector */}
            <div
              role="group"
              aria-label="Activity polling interval"
              className="inline-flex rounded-lg border border-[#E7E8EC] bg-white p-0.5 text-3xs font-medium shadow-2xs"
            >
              <button
                type="button"
                onClick={() => {
                  setIsLivePolling(true)
                  setPollInterval(5)
                }}
                className={`px-2 py-1 rounded cursor-pointer transition-colors ${isLivePolling && pollInterval === 5
                  ? 'bg-[#5277D9] text-white font-semibold shadow-xs'
                  : 'text-[#64748B] hover:text-[#202938]'
                  }`}
              >
                5s
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsLivePolling(true)
                  setPollInterval(10)
                }}
                className={`px-2 py-1 rounded cursor-pointer transition-colors ${isLivePolling && pollInterval === 10
                  ? 'bg-[#5277D9] text-white font-semibold shadow-xs'
                  : 'text-[#64748B] hover:text-[#202938]'
                  }`}
              >
                10s
              </button>
              <button
                type="button"
                onClick={() => setIsLivePolling(false)}
                className={`px-2 py-1 rounded cursor-pointer transition-colors ${!isLivePolling
                  ? 'bg-gray-200 text-[#202938] font-semibold'
                  : 'text-[#64748B] hover:text-[#202938]'
                  }`}
              >
                Off
              </button>
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={() => loadData(true)}
              isLoading={isLoading || isRefreshing}
              leftIcon={<RefreshCw className="w-3.5 h-3.5" />}
            >
              Refresh
            </Button>
          </div>
        }
      />

      {/* Meaningful Backend Communication Error Banner (Live API Mode) */}
      {error && mode === 'live' && (
        <Card className="border-[#E76B64]/30 bg-white shadow-xs overflow-hidden">
          <div className="p-4 sm:p-6 space-y-4">
            <div className="flex items-start gap-3.5">
              <div className="w-10 h-10 rounded-xl bg-[#E76B64]/10 border border-[#E76B64]/20 flex items-center justify-center text-[#E76B64] shrink-0 mt-0.5">
                <AlertOctagon className="w-5 h-5" />
              </div>
              <div className="space-y-1 flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-base font-bold text-[#202938]">
                    Backend API Connection Notice
                  </h3>
                  <span className="text-3xs font-semibold px-2 py-0.5 rounded bg-[#E76B64]/10 text-[#E76B64] border border-[#E76B64]/25">
                    Live Mode
                  </span>
                </div>
                <p className="text-xs text-[#64748B] leading-relaxed">
                  The dashboard encountered an error communicating with your local backend service. Diagnostic details:
                </p>
                <div className="p-3 bg-[#F7F6F2] border border-[#E7E8EC] rounded-lg font-mono text-xs text-[#E76B64] break-all select-all mt-2">
                  {error}
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2.5 pt-2 border-t border-[#E7E8EC]">
              <Button
                variant="primary"
                size="sm"
                onClick={() => loadData(true)}
                isLoading={isLoading}
                leftIcon={<RefreshCw className="w-3.5 h-3.5" />}
              >
                Retry Connection
              </Button>

              <Button
                variant="secondary"
                size="sm"
                onClick={toggleMode}
              >
                Switch to Demo Mode
              </Button>

              <NavLink to="/settings">
                <Button
                  variant="outline"
                  size="sm"
                  leftIcon={<SettingsIcon className="w-3.5 h-3.5 text-[#64748B]" />}
                >
                  Configure API Key in Settings
                </Button>
              </NavLink>
            </div>
          </div>
        </Card>
      )}

      {/* Summary KPI Cards */}
      {isLoading && !metrics ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3 sm:gap-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <CardSkeleton key={i} />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3 sm:gap-4">
          <StatCard
            title="Total Events"
            value={metrics?.totalEvents ?? 0}
            subtitle="Ingested events"
            icon={<Inbox className="w-4 h-4 text-[#5277D9]" />}
          />

          <StatCard
            title="Successful Deliveries"
            value={metrics?.succeededDeliveries ?? 0}
            subtitle="2xx HTTP response"
            icon={<CheckCircle2 className="w-4 h-4 text-[#159B78]" />}
          />

          <StatCard
            title="Dead Letters"
            value={metrics?.failedDeliveries ?? 0}
            subtitle="Max retries exhausted"
            icon={<AlertOctagon className="w-4 h-4 text-[#E76B64]" />}
            badge={
              (metrics?.failedDeliveries ?? 0) > 0 ? (
                <span className="text-2xs font-semibold px-2 py-0.5 rounded-full bg-[#E76B64]/10 text-[#E76B64] border border-[#E76B64]/20">
                  Needs Attention
                </span>
              ) : undefined
            }
          />

          <StatCard
            title="Pending & In-Flight"
            value={metrics?.pendingDeliveries ?? 0}
            subtitle="Queued in PostgreSQL"
            icon={<Clock className="w-4 h-4 text-[#5277D9]" />}
          />

          <StatCard
            title="Success Rate"
            value={formatRate(metrics?.successRate, totalDeliveriesCount)}
            subtitle={
              totalDeliveriesCount > 0
                ? `Avg latency: ${metrics?.averageLatencyMs ?? 0}ms`
                : 'No delivery data'
            }
            icon={<TrendingUp className="w-4 h-4 text-[#159B78]" />}
          />
        </div>
      )}

      {/* Worker Health Monitoring Section */}
      <WorkerHealthCard
        health={backendHealth}
        onRefresh={checkHealth}
        isLoading={isLoading}
      />

      {/* Queue Metrics Dashboard Section */}
      <QueueMetricsSection
        metrics={metrics}
        statusDistribution={statusDistribution}
        timeSeries={timeSeries}
        isLoading={isLoading}
      />

      {/* Visual Analytics / Charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Delivery Volume Chart (2 columns) */}
        <Card className="lg:col-span-2 min-w-0">
          <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b border-[#E7E8EC] bg-[#F7F6F2]">
            <div>
              <CardTitle>Delivery Throughput Over Time</CardTitle>
              <p className="text-xs text-[#64748B]">Hourly delivery dispatches across 24 hours</p>
            </div>
            <span className="text-2xs font-semibold px-2.5 py-0.5 bg-white text-[#202938] border border-[#E7E8EC] rounded-full shadow-2xs self-start sm:self-auto">
              Past 24 Hours
            </span>
          </CardHeader>
          <CardContent className="h-64 sm:h-72 p-3 sm:p-5 min-w-0">
            {timeSeries.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center p-4">
                <Clock className="w-8 h-8 text-[#64748B] mb-2" />
                <span className="text-xs font-semibold text-[#202938]">No Throughput Recorded</span>
                <span className="text-2xs text-[#64748B] mt-0.5">
                  Deliveries dispatched over the past 24 hours will appear here.
                </span>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={timeSeries} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorTotal" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#5277D9" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="#5277D9" stopOpacity={0.0} />
                    </linearGradient>
                    <linearGradient id="colorSucceeded" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#159B78" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="#159B78" stopOpacity={0.0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E7E8EC" />
                  <XAxis dataKey="label" stroke="#64748B" fontSize={11} tickLine={false} />
                  <YAxis stroke="#64748B" fontSize={11} tickLine={false} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#ffffff',
                      borderColor: '#E7E8EC',
                      borderRadius: '8px',
                      boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.05)',
                      fontSize: '12px',
                      color: '#202938',
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="total"
                    name="Total Dispatched"
                    stroke="#5277D9"
                    strokeWidth={2}
                    fillOpacity={1}
                    fill="url(#colorTotal)"
                  />
                  <Area
                    type="monotone"
                    dataKey="succeeded"
                    name="Succeeded"
                    stroke="#159B78"
                    strokeWidth={2}
                    fillOpacity={1}
                    fill="url(#colorSucceeded)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Status Distribution Chart (1 column) */}
        <Card className="min-w-0">
          <CardHeader className="pb-2 border-b border-[#E7E8EC] bg-[#F7F6F2]">
            <CardTitle>Delivery Status Distribution</CardTitle>
            <p className="text-xs text-[#64748B]">Breakdown of current queue states</p>
          </CardHeader>
          <CardContent className="h-64 sm:h-72 p-3 sm:p-4 flex flex-col items-center justify-center min-w-0">
            {statusDistribution.reduce((acc, curr) => acc + (curr.value || 0), 0) === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center p-4">
                <div className="w-12 h-12 rounded-full border-2 border-dashed border-[#E7E8EC] flex items-center justify-center text-[#64748B] mb-2">
                  <Clock className="w-5 h-5 text-[#64748B]" />
                </div>
                <span className="text-xs font-semibold text-[#202938]">No Delivery Queue Activity</span>
                <span className="text-2xs text-[#64748B] mt-0.5">Ingest an event to see queue state breakdown.</span>
              </div>
            ) : (
              <>
                <ResponsiveContainer width="100%" height={170}>
                  <PieChart>
                    <Pie
                      data={statusDistribution}
                      cx="50%"
                      cy="50%"
                      innerRadius={48}
                      outerRadius={72}
                      paddingAngle={3}
                      dataKey="value"
                    >
                      {statusDistribution.map((entry, index) => {
                        const themeColorMap: Record<string, string> = {
                          Succeeded: '#159B78',
                          Retrying: '#E5B34B',
                          'Dead Letter': '#E76B64',
                          'In Flight': '#5277D9',
                          Pending: '#64748B',
                        }
                        const fill = themeColorMap[entry.name] || entry.color || '#5277D9'
                        return <Cell key={`cell-${index}`} fill={fill} />
                      })}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#ffffff',
                        borderColor: '#E7E8EC',
                        borderRadius: '8px',
                        fontSize: '12px',
                        color: '#202938',
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>

                {/* Custom Legend */}
                <div className="grid grid-cols-2 gap-x-3 gap-y-1 mt-2 text-2xs text-[#64748B] w-full px-1">
                  {statusDistribution.map((item) => {
                    const themeColorMap: Record<string, string> = {
                      Succeeded: '#159B78',
                      Retrying: '#E5B34B',
                      'Dead Letter': '#E76B64',
                      'In Flight': '#5277D9',
                      Pending: '#64748B',
                    }
                    const bulletColor = themeColorMap[item.name] || item.color || '#5277D9'
                    return (
                      <div key={item.name} className="flex items-center gap-1.5 min-w-0">
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: bulletColor }} />
                        <span className="truncate">{item.name}:</span>
                        <span className="font-semibold text-[#202938] shrink-0">{item.value}</span>
                      </div>
                    )
                  })}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Grid: Recent Deliveries & Endpoint Health */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent Deliveries Table (2 cols) */}
        <Card className="lg:col-span-2 overflow-hidden min-w-0">
          <CardHeader className="flex flex-row items-center justify-between border-b border-[#E7E8EC] bg-[#F7F6F2] py-3.5">
            <div>
              <div className="flex items-center gap-2">
                <CardTitle>Recent Delivery Activity</CardTitle>
                {isLivePolling && (
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-[#159B78]/10 text-[#159B78] border border-[#159B78]/25 text-3xs font-bold font-mono">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#159B78] animate-pulse" />
                    LIVE {pollInterval}s
                  </span>
                )}
              </div>
              <p className="text-xs text-[#64748B]">Real-time webhook lifecycle states, timestamps, and delivery outcomes</p>
            </div>
            <NavLink
              to="/deliveries"
              className="text-xs font-semibold text-[#5277D9] hover:text-[#4366C4] inline-flex items-center gap-1 cursor-pointer shrink-0"
            >
              <span>View all</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </NavLink>
          </CardHeader>

          {isLoading ? (
            <TableSkeleton rows={4} cols={5} />
          ) : recentDeliveries.length === 0 ? (
            <div className="p-8 text-center text-xs text-[#64748B]">No delivery attempts recorded yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs min-w-[620px]">
                <thead className="bg-[#F7F6F2] border-b border-[#E7E8EC] text-[#64748B] font-semibold">
                  <tr>
                    <th className="py-2.5 px-4">Delivery ID</th>
                    <th className="py-2.5 px-4">Destination Endpoint</th>
                    <th className="py-2.5 px-4">Lifecycle State</th>
                    <th className="py-2.5 px-4">Outcome</th>
                    <th className="py-2.5 px-4">Attempt</th>
                    <th className="py-2.5 px-4">Time</th>
                    <th className="py-2.5 px-4 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E7E8EC]">
                  {recentDeliveries.map((del) => {
                    const statusInfo = formatStatusCode(del.last_status_code)
                    return (
                      <tr key={del.id} className="hover:bg-[#F7F6F2]/70 transition-colors">
                        <td className="py-3 px-4">
                          <div className="flex flex-col">
                            <span className="font-mono font-semibold text-[#202938]">
                              {truncateId(del.id, 8)}
                            </span>
                            {del.event_id && (
                              <span className="text-3xs font-mono text-[#64748B]">
                                Evt: {truncateId(del.event_id, 8)}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="py-3 px-4 text-[#64748B] max-w-xs truncate font-mono" title={del.endpoint_url || del.endpoint_id}>
                          {del.endpoint_url || del.endpoint_id}
                        </td>
                        <td className="py-3 px-4">
                          <StatusBadge state={del.state} />
                        </td>
                        <td className="py-3 px-4">
                          <span
                            className={`px-2 py-0.5 rounded text-2xs font-semibold border ${statusInfo.category === 'success'
                              ? 'bg-[#159B78]/10 text-[#159B78] border-[#159B78]/25'
                              : statusInfo.category === 'client-error'
                                ? 'bg-[#E5B34B]/15 text-[#B8871E] border-[#E5B34B]/30'
                                : del.last_status_code
                                  ? 'bg-[#E76B64]/10 text-[#E76B64] border-[#E76B64]/25'
                                  : 'bg-gray-100 text-gray-600 border-gray-200'
                              }`}
                          >
                            {del.last_status_code ? `HTTP ${del.last_status_code}` : del.state === 'PENDING' ? 'Queued' : 'In Flight'}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-[#64748B] font-mono">
                          #{del.attempt_count}
                        </td>
                        <td className="py-3 px-4 text-[#64748B]" title={del.updated_at}>
                          {formatRelativeTime(del.updated_at)}
                        </td>
                        <td className="py-3 px-4 text-right">
                          <button
                            onClick={() => handleInspect(del)}
                            className="text-xs font-semibold text-[#5277D9] hover:text-[#4366C4] underline underline-offset-2 cursor-pointer"
                          >
                            Inspect
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {/* System Overview & Circuit Breakers (1 col) */}
        <Card className="overflow-hidden min-w-0">
          <CardHeader className="flex flex-row items-center justify-between border-b border-[#E7E8EC] bg-[#F7F6F2] py-3.5">
            <div>
              <CardTitle>Endpoint Circuit Health</CardTitle>
              <p className="text-xs text-[#64748B]">Resilience circuit breakers status</p>
            </div>
            <NavLink
              to="/endpoints"
              className="text-xs font-semibold text-[#5277D9] hover:text-[#4366C4] inline-flex items-center gap-1 cursor-pointer shrink-0"
            >
              <span>Manage</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </NavLink>
          </CardHeader>

          <CardContent className="p-3 sm:p-4 space-y-3">
            <div className="p-3 bg-[#F7F6F2] rounded-lg border border-[#E7E8EC] space-y-1.5 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-[#64748B]">Active Endpoints</span>
                <span className="font-semibold text-[#202938]">
                  {endpoints.filter((e) => e.active).length} / {endpoints.length}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[#64748B]">Open Circuits (Tripped)</span>
                <span className="font-semibold text-[#E76B64]">
                  {endpoints.filter((e) => e.circuit_state === 'OPEN').length}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[#64748B]">Database Connection</span>
                <span className="font-semibold text-[#159B78]">
                  {backendHealth.status === 'up' ? 'Connected (Healthy)' : 'Offline / Standalone'}
                </span>
              </div>
            </div>

            <div className="space-y-2">
              <span className="text-2xs font-semibold text-[#64748B] uppercase tracking-wider block">
                Active Destinations
              </span>
              <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                {endpoints.slice(0, 4).map((ep) => (
                  <div
                    key={ep.id}
                    className="p-2.5 rounded-lg border border-[#E7E8EC] bg-white space-y-1 text-xs hover:border-[#D1D5DB] transition-colors"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-[#202938] font-semibold truncate flex-1 min-w-0">
                        {ep.url}
                      </span>
                      <CircuitBadge state={ep.circuit_state} consecutiveFailures={ep.consecutive_failures} />
                    </div>
                    <div className="flex items-center justify-between text-2xs text-[#64748B]">
                      <span>Rate Limit: {ep.rate_limit_rps} RPS</span>
                      <span>Next Seq: #{ep.next_seq ?? 1}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Detail Drawer */}
      <DeliveryDetailDrawer
        delivery={selectedDelivery}
        isOpen={drawerOpen}
        onClose={() => setDrawerOpen(false)}
      />
    </div>
  )
}
