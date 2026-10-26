import React, { useState, useEffect, useCallback } from 'react'
import {
  Inbox,
  CheckCircle2,
  AlertOctagon,
  Clock,
  TrendingUp,
  RefreshCw,
  ChevronRight,
} from 'lucide-react'
import { StatCard } from '../components/StatCard'
import { StatusBadge } from '../components/StatusBadge'
import { CircuitBadge } from '../components/CircuitBadge'
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { TableSkeleton, CardSkeleton } from '../components/ui/LoadingSkeleton'
import { DeliveryDetailDrawer } from '../components/DeliveryDetailDrawer'
import { formatRelativeTime, truncateId, formatStatusCode, formatRate } from '../utils/formatters'
import { useApp } from '../context/AppContext'
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
      const msg = err instanceof Error ? err.message : 'Failed to fetch dashboard data'
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

  if (error && mode === 'live') {
    return (
      <div className="space-y-6 text-left">
        <div className="p-6 bg-white border border-rose-200 rounded-xl shadow-xs space-y-4">
          <div className="flex items-center gap-3 text-rose-700">
            <AlertOctagon className="w-6 h-6 shrink-0" />
            <h2 className="text-lg font-bold">Backend Connection Failed</h2>
          </div>
          <p className="text-sm text-slate-600">
            HookForge frontend is in <strong>Live API Mode</strong> and tried to fetch data from your backend
            server, but encountered an error:
          </p>
          <div className="p-3 bg-rose-50 border border-rose-100 rounded-lg font-mono text-xs text-rose-800">
            {error}
          </div>
          <p className="text-xs text-slate-500">
            If your teammate is still implementing Phase 2-8 routes, you can switch to <strong>Demo Mode</strong> to
            test and view the full interactive dashboard with realistic mock fixtures.
          </p>
          <div className="flex items-center gap-3 pt-2">
            <Button variant="primary" size="sm" onClick={toggleMode}>
              Switch to Demo Mode
            </Button>
            <Button variant="outline" size="sm" onClick={loadData} leftIcon={<RefreshCw className="w-3.5 h-3.5" />}>
              Retry Connection
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6 text-left">
      {/* Header Refresh Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight">System Reliability Overview</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Real-time webhook delivery pipelines, head-of-line durability, and circuit breaker status.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={loadData}
            isLoading={isLoading}
            leftIcon={<RefreshCw className="w-3.5 h-3.5" />}
          >
            Refresh
          </Button>
        </div>
      </div>

      {/* Summary KPI Cards */}
      {isLoading && !metrics ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <CardSkeleton key={i} />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          <StatCard
            title="Total Events"
            value={metrics?.totalEvents ?? 0}
            subtitle="Ingested events"
            icon={<Inbox className="w-4 h-4 text-slate-700" />}
            trend={{ value: '+12.4%', isPositive: true }}
          />

          <StatCard
            title="Successful Deliveries"
            value={metrics?.succeededDeliveries ?? 0}
            subtitle="2xx HTTP response"
            icon={<CheckCircle2 className="w-4 h-4 text-emerald-600" />}
            trend={{ value: '+99.2%', isPositive: true }}
          />

          <StatCard
            title="Dead Letters"
            value={metrics?.failedDeliveries ?? 0}
            subtitle="Max retries exhausted"
            icon={<AlertOctagon className="w-4 h-4 text-rose-600" />}
            badge={
              (metrics?.failedDeliveries ?? 0) > 0 ? (
                <span className="text-2xs font-semibold px-1.5 py-0.5 rounded-full bg-rose-100 text-rose-700">
                  Needs Attention
                </span>
              ) : undefined
            }
          />

          <StatCard
            title="Pending & In-Flight"
            value={metrics?.pendingDeliveries ?? 0}
            subtitle="Queued in PostgreSQL"
            icon={<Clock className="w-4 h-4 text-indigo-600" />}
          />

          <StatCard
            title="Success Rate"
            value={formatRate(metrics?.successRate)}
            subtitle={`Avg latency: ${metrics?.averageLatencyMs ?? 0}ms`}
            icon={<TrendingUp className="w-4 h-4 text-teal-600" />}
          />
        </div>
      )}

      {/* Visual Analytics / Charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Delivery Volume Chart (2 columns) */}
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <div>
              <CardTitle>Delivery Throughput Over Time</CardTitle>
              <p className="text-xs text-slate-500">Hourly delivery dispatches across 24 hours</p>
            </div>
            <span className="text-2xs font-medium px-2 py-0.5 bg-slate-100 text-slate-700 rounded-full">
              Past 24 Hours
            </span>
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={timeSeries} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorTotal" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.0} />
                  </linearGradient>
                  <linearGradient id="colorSucceeded" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0.0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="label" stroke="#94a3b8" fontSize={11} tickLine={false} />
                <YAxis stroke="#94a3b8" fontSize={11} tickLine={false} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#ffffff',
                    borderColor: '#e2e8f0',
                    borderRadius: '8px',
                    boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
                    fontSize: '12px',
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="total"
                  name="Total Dispatched"
                  stroke="#3b82f6"
                  strokeWidth={2}
                  fillOpacity={1}
                  fill="url(#colorTotal)"
                />
                <Area
                  type="monotone"
                  dataKey="succeeded"
                  name="Succeeded"
                  stroke="#10b981"
                  strokeWidth={2}
                  fillOpacity={1}
                  fill="url(#colorSucceeded)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Status Distribution Chart (1 column) */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle>Delivery Status Distribution</CardTitle>
            <p className="text-xs text-slate-500">Breakdown of current queue states</p>
          </CardHeader>
          <CardContent className="h-72 flex flex-col items-center justify-center">
            <ResponsiveContainer width="100%" height={180}>
              <PieChart>
                <Pie
                  data={statusDistribution}
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={75}
                  paddingAngle={3}
                  dataKey="value"
                >
                  {statusDistribution.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#ffffff',
                    borderColor: '#e2e8f0',
                    borderRadius: '8px',
                    fontSize: '12px',
                  }}
                />
              </PieChart>
            </ResponsiveContainer>

            {/* Custom Legend */}
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 mt-2 text-2xs text-slate-600">
              {statusDistribution.map((item) => (
                <div key={item.name} className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: item.color }} />
                  <span className="truncate">{item.name}:</span>
                  <span className="font-semibold text-slate-800">{item.value}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Grid: Recent Deliveries & Endpoint Health */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent Deliveries Table (2 cols) */}
        <Card className="lg:col-span-2 overflow-hidden">
          <CardHeader className="flex flex-row items-center justify-between border-b border-slate-100 bg-slate-50/50 py-3">
            <div>
              <CardTitle>Recent Delivery Activity</CardTitle>
              <p className="text-xs text-slate-500">Latest webhook dispatches through the queue</p>
            </div>
            <NavLink
              to="/deliveries"
              className="text-xs font-semibold text-slate-700 hover:text-slate-900 inline-flex items-center gap-1 cursor-pointer"
            >
              <span>View all</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </NavLink>
          </CardHeader>

          {isLoading ? (
            <TableSkeleton rows={4} cols={5} />
          ) : recentDeliveries.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-500">No delivery attempts recorded yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50/70 border-b border-slate-200 text-slate-500 font-medium">
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
                <tbody className="divide-y divide-slate-100">
                  {recentDeliveries.map((del) => {
                    const statusInfo = formatStatusCode(del.last_status_code)
                    return (
                      <tr key={del.id} className="hover:bg-slate-50/80 transition-colors">
                        <td className="py-3 px-4 font-mono font-medium text-slate-800">
                          {truncateId(del.id, 8)}
                        </td>
                        <td className="py-3 px-4 text-slate-600 max-w-xs truncate font-mono">
                          {del.endpoint_url || del.endpoint_id}
                        </td>
                        <td className="py-3 px-4">
                          <StatusBadge state={del.state} />
                        </td>
                        <td className="py-3 px-4">
                          <span
                            className={`px-1.5 py-0.5 rounded text-2xs font-semibold ${
                              statusInfo.category === 'success'
                                ? 'bg-emerald-100 text-emerald-800'
                                : statusInfo.category === 'client-error'
                                ? 'bg-amber-100 text-amber-800'
                                : 'bg-rose-100 text-rose-800'
                            }`}
                          >
                            {del.last_status_code ?? 'Timeout'}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-slate-600">
                          #{del.attempt_count}
                        </td>
                        <td className="py-3 px-4 text-slate-500">
                          {formatRelativeTime(del.updated_at)}
                        </td>
                        <td className="py-3 px-4 text-right">
                          <button
                            onClick={() => handleInspect(del)}
                            className="text-xs font-semibold text-slate-700 hover:text-slate-900 underline underline-offset-2 cursor-pointer"
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
          <CardHeader className="border-b border-slate-100 bg-slate-50/50 py-3">
            <CardTitle>Endpoint Circuit Health</CardTitle>
            <p className="text-xs text-slate-500">Resilience circuit breakers status</p>
          </CardHeader>

          <CardContent className="p-4 space-y-3">
            <div className="p-3 bg-slate-50 rounded-lg border border-slate-200/80 space-y-1.5 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-slate-600">Active Endpoints</span>
                <span className="font-semibold text-slate-900">
                  {endpoints.filter((e) => e.active).length} / {endpoints.length}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-600">Open Circuits (Tripped)</span>
                <span className="font-semibold text-rose-600">
                  {endpoints.filter((e) => e.circuit_state === 'OPEN').length}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-600">Database Connection</span>
                <span className="font-semibold text-emerald-700">
                  {backendHealth.status === 'up' ? 'Connected (Healthy)' : 'Offline / Standalone'}
                </span>
              </div>
            </div>

            <div className="space-y-2">
              <span className="text-2xs font-semibold text-slate-400 uppercase tracking-wider block">
                Active Destinations
              </span>
              <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                {endpoints.slice(0, 4).map((ep) => (
                  <div
                    key={ep.id}
                    className="p-2.5 rounded-lg border border-slate-200 bg-white space-y-1 text-xs"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-slate-800 font-medium truncate max-w-[180px]">
                        {ep.url}
                      </span>
                      <CircuitBadge state={ep.circuit_state} consecutiveFailures={ep.consecutive_failures} />
                    </div>
                    <div className="flex items-center justify-between text-2xs text-slate-400">
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
