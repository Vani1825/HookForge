import React, { useState, useEffect, useCallback } from 'react'
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

export const DashboardPage: React.FC = () => {
  const { service, mode, toggleMode, backendHealth } = useApp()

  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [metrics, setMetrics] = useState<OverviewMetrics | null>(null)
  const [timeSeries, setTimeSeries] = useState<TimeSeriesDataPoint[]>([])
  const [statusDistribution, setStatusDistribution] = useState<StatusDistribution[]>([])
  const [recentDeliveries, setRecentDeliveries] = useState<Delivery[]>([])
  const [endpoints, setEndpoints] = useState<Endpoint[]>([])

  const [selectedDelivery, setSelectedDelivery] = useState<Delivery | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)

  const loadData = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const [m, ts, sd, delivs, eps] = await Promise.all([
        service.getOverviewMetrics(),
        service.getTimeSeriesMetrics(),
        service.getStatusDistribution(),
        service.getDeliveries({ limit: 6 }),
        service.getEndpoints(),
      ])
      setMetrics(m)
      setTimeSeries(ts)
      setStatusDistribution(sd)
      setRecentDeliveries(delivs.slice(0, 6))
      setEndpoints(eps)
    } catch (err: unknown) {
      const msg = formatErrorMessage(err)
      setError(msg)
    } finally {
      setIsLoading(false)
    }
  }, [service])

  useEffect(() => {
    loadData()
  }, [loadData, mode])

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
      {/* Header Refresh Bar */}
      <PageHeader
        title="System Reliability Overview"
        description="Real-time webhook delivery pipelines, head-of-line durability, and circuit breaker status."
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={loadData}
            isLoading={isLoading}
            leftIcon={<RefreshCw className="w-3.5 h-3.5" />}
          >
            Refresh
          </Button>
        }
      />

      {/* Meaningful Backend Communication Error Banner (Live API Mode) */}
      {error && mode === 'live' && (
        <Card className="border-[#E76B64]/30 bg-white shadow-xs overflow-hidden">
          <div className="p-5 sm:p-6 space-y-4">
            <div className="flex items-start gap-3.5">
              <div className="w-10 h-10 rounded-xl bg-[#E76B64]/10 border border-[#E76B64]/20 flex items-center justify-center text-[#E76B64] shrink-0 mt-0.5">
                <AlertOctagon className="w-5 h-5" />
              </div>
              <div className="space-y-1 flex-1 min-w-0">
                <div className="flex items-center gap-2">
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
                onClick={loadData}
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
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <CardSkeleton key={i} />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
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

      {/* Visual Analytics / Charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Delivery Volume Chart (2 columns) */}
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between pb-2 border-b border-[#E7E8EC] bg-[#F7F6F2]">
            <div>
              <CardTitle>Delivery Throughput Over Time</CardTitle>
              <p className="text-xs text-[#64748B]">Hourly delivery dispatches across 24 hours</p>
            </div>
            <span className="text-2xs font-semibold px-2.5 py-0.5 bg-white text-[#202938] border border-[#E7E8EC] rounded-full shadow-2xs">
              Past 24 Hours
            </span>
          </CardHeader>
          <CardContent className="h-72 p-5">
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
        <Card>
          <CardHeader className="pb-2 border-b border-[#E7E8EC] bg-[#F7F6F2]">
            <CardTitle>Delivery Status Distribution</CardTitle>
            <p className="text-xs text-[#64748B]">Breakdown of current queue states</p>
          </CardHeader>
          <CardContent className="h-72 p-4 flex flex-col items-center justify-center">
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
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 mt-2 text-2xs text-[#64748B] w-full px-2">
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
                      <div key={item.name} className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: bulletColor }} />
                        <span className="truncate">{item.name}:</span>
                        <span className="font-semibold text-[#202938]">{item.value}</span>
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
        <Card className="lg:col-span-2 overflow-hidden">
          <CardHeader className="flex flex-row items-center justify-between border-b border-[#E7E8EC] bg-[#F7F6F2] py-3.5">
            <div>
              <CardTitle>Recent Delivery Activity</CardTitle>
              <p className="text-xs text-[#64748B]">Latest webhook dispatches through the queue</p>
            </div>
            <NavLink
              to="/deliveries"
              className="text-xs font-semibold text-[#5277D9] hover:text-[#4366C4] inline-flex items-center gap-1 cursor-pointer"
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
              <table className="w-full text-left text-xs">
                <thead className="bg-[#F7F6F2] border-b border-[#E7E8EC] text-[#64748B] font-semibold">
                  <tr>
                    <th className="py-2.5 px-4">Delivery ID</th>
                    <th className="py-2.5 px-4">Destination Endpoint</th>
                    <th className="py-2.5 px-4">State</th>
                    <th className="py-2.5 px-4">HTTP</th>
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
                        <td className="py-3 px-4 text-[#64748B] max-w-xs truncate font-mono">
                          {del.endpoint_url || del.endpoint_id}
                        </td>
                        <td className="py-3 px-4">
                          <StatusBadge state={del.state} />
                        </td>
                        <td className="py-3 px-4">
                          <span
                            className={`px-2 py-0.5 rounded text-2xs font-semibold border ${
                              statusInfo.category === 'success'
                                ? 'bg-[#159B78]/10 text-[#159B78] border-[#159B78]/25'
                                : statusInfo.category === 'client-error'
                                ? 'bg-[#E5B34B]/15 text-[#B8871E] border-[#E5B34B]/30'
                                : 'bg-[#E76B64]/10 text-[#E76B64] border-[#E76B64]/25'
                            }`}
                          >
                            {del.last_status_code ?? 'Timeout'}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-[#64748B]">
                          #{del.attempt_count}
                        </td>
                        <td className="py-3 px-4 text-[#64748B]">
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
        <Card className="overflow-hidden">
          <CardHeader className="flex flex-row items-center justify-between border-b border-[#E7E8EC] bg-[#F7F6F2] py-3.5">
            <div>
              <CardTitle>Endpoint Circuit Health</CardTitle>
              <p className="text-xs text-[#64748B]">Resilience circuit breakers status</p>
            </div>
            <NavLink
              to="/endpoints"
              className="text-xs font-semibold text-[#5277D9] hover:text-[#4366C4] inline-flex items-center gap-1 cursor-pointer"
            >
              <span>Manage</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </NavLink>
          </CardHeader>

          <CardContent className="p-4 space-y-3">
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
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-[#202938] font-semibold truncate max-w-[180px]">
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
