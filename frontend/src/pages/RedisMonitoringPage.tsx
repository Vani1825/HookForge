import React, { useState, useEffect, useCallback } from 'react'
import {
  Database,
  Activity,
  Layers,
  ShieldAlert,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Zap,
  Clock,
  Sparkles,
  Sliders,
  Radio,
  HardDrive,
  FileText,
} from 'lucide-react'
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { PageHeader } from '../components/ui/PageHeader'
import { Badge } from '../components/ui/Badge'
import { StatCard } from '../components/StatCard'
import { CardSkeleton } from '../components/ui/LoadingSkeleton'
import { JsonViewer } from '../components/ui/JsonViewer'
import { useApp } from '../context/AppContext'
import { mockStore } from '../mocks/mockStore'
import { formatErrorMessage } from '../api/client'
import type { RedisMonitoringOverview } from '../types'
import { cn } from '../utils/cn'

export const RedisMonitoringPage: React.FC = () => {
  const { service, mode, addToast } = useApp()

  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<RedisMonitoringOverview | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date())
  const [simulatedState, setSimulatedState] = useState<'healthy' | 'degraded' | 'offline'>(
    mockStore.getRedisSimulatedState()
  )
  const [showRawJson, setShowRawJson] = useState(false)

  const loadMonitoringData = useCallback(async (isManualRefresh = false) => {
    if (isManualRefresh) {
      setIsRefreshing(true)
    } else {
      setIsLoading(true)
    }
    setError(null)

    try {
      const overview = await service.getRedisMonitoring()
      setData(overview)
      setLastUpdated(new Date())
      if (isManualRefresh) {
        addToast({
          title: 'Metrics Refreshed',
          description: 'Redis telemetry and system health updated successfully.',
          type: 'success',
        })
      }
    } catch (err: unknown) {
      const msg = formatErrorMessage(err)
      setError(msg)
      addToast({
        title: 'Failed to Refresh Redis Telemetry',
        description: msg,
        type: 'error',
      })
    } finally {
      setIsLoading(false)
      setIsRefreshing(false)
    }
  }, [service, addToast])

  useEffect(() => {
    loadMonitoringData()
  }, [loadMonitoringData, mode])

  const handleSimulatedStateChange = (nextState: 'healthy' | 'degraded' | 'offline') => {
    mockStore.setRedisSimulatedState(nextState)
    setSimulatedState(nextState)
    setData(mockStore.getRedisMonitoring())
    addToast({
      title: 'Simulation State Updated',
      description: `Redis telemetry switched to simulated "${nextState}" mode.`,
      type: nextState === 'healthy' ? 'success' : nextState === 'degraded' ? 'warning' : 'error',
    })
  }

  const isHealthy = data?.health?.status === 'up'
  const isDown = data?.health?.status === 'down'
  const isDisabled = data?.health?.status === 'disabled'
  const isFallback = data?.isFallbackActive ?? false

  return (
    <div className="space-y-6 text-left pb-10">
      {/* Page Header */}
      <PageHeader
        title="Redis & Distributed Systems Monitoring"
        description="Real-time visibility into distributed Redis cache hit rates, atomic rate-limiting enforcement, and resilient database fallback behavior."
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            {mode === 'demo' && (
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#E7E8EC] bg-white text-xs shadow-2xs">
                <Sliders className="w-3.5 h-3.5 text-[#5277D9]" />
                <span className="font-medium text-[#64748B]">Simulate:</span>
                <button
                  type="button"
                  onClick={() => handleSimulatedStateChange('healthy')}
                  className={cn(
                    'px-2 py-0.5 rounded text-2xs font-semibold transition-colors',
                    simulatedState === 'healthy'
                      ? 'bg-[#159B78] text-white'
                      : 'text-[#64748B] hover:text-[#202938]'
                  )}
                >
                  Healthy
                </button>
                <button
                  type="button"
                  onClick={() => handleSimulatedStateChange('degraded')}
                  className={cn(
                    'px-2 py-0.5 rounded text-2xs font-semibold transition-colors',
                    simulatedState === 'degraded'
                      ? 'bg-[#E5B34B] text-white'
                      : 'text-[#64748B] hover:text-[#202938]'
                  )}
                >
                  Degraded
                </button>
                <button
                  type="button"
                  onClick={() => handleSimulatedStateChange('offline')}
                  className={cn(
                    'px-2 py-0.5 rounded text-2xs font-semibold transition-colors',
                    simulatedState === 'offline'
                      ? 'bg-[#E76B64] text-white'
                      : 'text-[#64748B] hover:text-[#202938]'
                  )}
                >
                  Offline
                </button>
              </div>
            )}

            <Button
              variant="outline"
              size="sm"
              onClick={() => loadMonitoringData(true)}
              disabled={isLoading || isRefreshing}
              className="gap-2 text-xs"
            >
              <RefreshCw className={cn('w-3.5 h-3.5', (isLoading || isRefreshing) && 'animate-spin')} />
              <span>{isRefreshing ? 'Refreshing...' : 'Refresh Metrics'}</span>
            </Button>
          </div>
        }
      />

      {/* Operation Mode & Status Banner */}
      <div className="flex items-center justify-between text-xs text-[#64748B] px-1 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          {mode === 'demo' ? (
            <Badge variant="info" className="gap-1 bg-[#EAF0FF] text-[#5277D9] border-[#DCE5FA]">
              <Sparkles className="w-3 h-3" />
              <span>Simulated Demo Mode</span>
            </Badge>
          ) : (
            <Badge variant="success" className="gap-1 bg-[#EBF8F4] text-[#159B78] border-[#CFEFE6]">
              <Radio className="w-3 h-3 animate-pulse" />
              <span>Live Backend Telemetry (/health)</span>
            </Badge>
          )}
          <span>•</span>
          <span>Last polled: {lastUpdated.toLocaleTimeString()}</span>
        </div>

        <button
          type="button"
          onClick={() => setShowRawJson(!showRawJson)}
          className="text-xs text-[#5277D9] hover:underline inline-flex items-center gap-1 font-medium"
        >
          <FileText className="w-3.5 h-3.5" />
          <span>{showRawJson ? 'Hide Diagnostic JSON' : 'View Diagnostic JSON'}</span>
        </button>
      </div>

      {/* Fallback & Degraded Status Alert Banner */}
      {isFallback && (
        <div
          role="alert"
          className={cn(
            'p-4 rounded-xl border flex items-start gap-3 text-left transition-all',
            isDown
              ? 'bg-[#FFF2F0] border-[#FFCCC7] text-[#A8071A]'
              : 'bg-[#FFFBE6] border-[#FFE58F] text-[#AD6800]'
          )}
        >
          <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <h4 className="font-semibold text-sm">
              {isDown
                ? 'Resilient Database Fallback Active (Redis Offline)'
                : isDisabled
                ? 'Redis Explicitly Disabled - PostgreSQL Fallback Mode'
                : 'Redis Disabled / Degraded Fallback Mode'}
            </h4>
            <p className="text-xs leading-relaxed opacity-90">
              {data?.fallbackReason ||
                'Redis is currently disconnected or unavailable. HookForge has transparently redirected read lookups directly to PostgreSQL ACID queries and rate limiting to in-memory sliding-window stores. Zero webhook delivery jobs or API requests are being dropped.'}
            </p>
          </div>
        </div>
      )}

      {/* Healthy Banner */}
      {!isFallback && isHealthy && (
        <div
          role="status"
          className="p-4 rounded-xl border border-[#CFEFE6] bg-[#EBF8F4] text-[#0A664E] flex items-center justify-between text-left"
        >
          <div className="flex items-center gap-3">
            <CheckCircle2 className="w-5 h-5 text-[#159B78] shrink-0" />
            <div>
              <h4 className="font-semibold text-sm text-[#0A664E]">
                Redis Distributed System Operational
              </h4>
              <p className="text-xs text-[#0D7A5D]">
                Distributed caching and atomic sliding-window rate limiting are operating normally across all replicas with strict tenant isolation.
              </p>
            </div>
          </div>
          {data?.health?.latencyMs !== undefined && (
            <div className="text-right">
              <span className="text-2xs uppercase tracking-wider font-semibold opacity-75">Ping Latency</span>
              <div className="text-sm font-bold">{data.health.latencyMs} ms</div>
            </div>
          )}
        </div>
      )}

      {/* Error state card if health probe failed completely */}
      {error && (
        <Card className="border-[#E76B64] bg-[#FFF2F0] p-4 text-[#A8071A]">
          <div className="flex items-center gap-2">
            <ShieldAlert className="w-5 h-5" />
            <span className="font-semibold text-sm">Health Probe Error</span>
          </div>
          <p className="text-xs mt-1">{error}</p>
          <Button
            size="sm"
            variant="outline"
            className="mt-3 text-xs bg-white text-[#A8071A] border-[#FFCCC7]"
            onClick={() => loadMonitoringData(true)}
          >
            Retry Probe
          </Button>
        </Card>
      )}

      {/* Collapsible Diagnostic JSON */}
      {showRawJson && data && (
        <Card className="p-4 bg-[#F8FAFC]">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-[#64748B] uppercase tracking-wider">
              Raw Monitoring Payload (/health)
            </span>
            <Button size="sm" variant="ghost" onClick={() => setShowRawJson(false)} className="text-xs h-7">
              Close
            </Button>
          </div>
          <JsonViewer data={data} title="Diagnostics Telemetry JSON" />
        </Card>
      )}

      {/* Section A: Stat Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {isLoading && !data ? (
          <>
            <CardSkeleton />
            <CardSkeleton />
            <CardSkeleton />
            <CardSkeleton />
          </>
        ) : (
          <>
            {/* 1. Redis Connection Status */}
            <StatCard
              title="Redis Connection"
              value={isHealthy ? 'Connected' : isDown ? 'Offline' : 'Disabled'}
              subtitle={
                isHealthy
                  ? `Response latency: ${data?.health?.latencyMs ?? 1} ms`
                  : isDown
                  ? 'Connection refused or timed out'
                  : 'Disabled via config'
              }
              badge={
                <Badge
                  variant={isHealthy ? 'success' : isDown ? 'danger' : 'slate'}
                  className="text-2xs uppercase"
                >
                  {isHealthy ? 'Healthy' : isDown ? 'Degraded' : 'Disabled'}
                </Badge>
              }
              icon={<Database className="w-5 h-5 text-[#5277D9]" />}
            />

            {/* 2. Cache Hit Ratio */}
            <StatCard
              title="Cache Hit Ratio"
              value={
                isHealthy
                  ? `${data?.cache?.hitRatio?.toFixed(1) ?? '0.0'}%`
                  : 'Bypassed'
              }
              subtitle={
                isHealthy
                  ? `${(data?.cache?.hits ?? 0).toLocaleString()} hits / ${(
                      data?.cache?.totalLookups ?? 0
                    ).toLocaleString()} lookups`
                  : 'Direct PostgreSQL reads active'
              }
              badge={
                isHealthy && (
                  <Badge variant="success" className="text-2xs text-[#159B78] border-[#CFEFE6] bg-[#EBF8F4]">
                    Optimal
                  </Badge>
                )
              }
              icon={<Zap className="w-5 h-5 text-[#E5B34B]" />}
            />

            {/* 3. Distributed Rate Limiting */}
            <StatCard
              title="Rate Limiting"
              value={isHealthy ? 'Distributed' : 'In-Memory'}
              subtitle={
                isHealthy
                  ? `${(data?.rateLimiting?.allowedRequests ?? 0).toLocaleString()} allowed / ${(
                      data?.rateLimiting?.throttledRequests ?? 0
                    ).toLocaleString()} throttled`
                  : 'Process-local fallback limiter active'
              }
              badge={
                <Badge variant={isHealthy ? 'default' : 'warning'} className="text-2xs">
                  {isHealthy ? 'Atomic Lua' : 'Fallback'}
                </Badge>
              }
              icon={<Activity className="w-5 h-5 text-[#159B78]" />}
            />

            {/* 4. Persistence Fallback */}
            <StatCard
              title="PostgreSQL ACID"
              value="Guaranteed"
              subtitle="Zero message loss on Redis down"
              badge={
                <Badge variant="slate" className="text-2xs text-[#202938] border-[#E7E8EC] bg-white">
                  Durable
                </Badge>
              }
              icon={<HardDrive className="w-5 h-5 text-[#7357D6]" />}
            />
          </>
        )}
      </div>

      {/* Section B: Caching Performance & Strategy */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: Cache Operations Telemetry */}
        <Card className="flex flex-col justify-between">
          <CardHeader className="border-b border-[#E7E8EC] bg-[#F7F6F2] py-3.5 px-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-[#5277D9]" />
                <CardTitle className="text-sm">Cache Operations & Hit Distribution</CardTitle>
              </div>
              <Badge variant={isHealthy ? 'success' : 'slate'} className="text-2xs">
                {isHealthy ? 'Cache Active' : 'Cache Bypassed'}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="p-5 space-y-4">
            <div className="space-y-3">
              {/* Hit Ratio Visual Bar */}
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="font-medium text-[#202938]">Hit Ratio Efficiency</span>
                  <span className="font-bold text-[#159B78]">
                    {data?.cache?.hitRatio ? `${data.cache.hitRatio.toFixed(1)}%` : '0.0%'}
                  </span>
                </div>
                <div className="w-full bg-[#E7E8EC] h-2.5 rounded-full overflow-hidden flex">
                  <div
                    className="bg-[#159B78] h-full transition-all duration-500"
                    style={{ width: `${Math.min(100, Math.max(0, data?.cache?.hitRatio ?? 0))}%` }}
                    title="Hits"
                  />
                  <div
                    className="bg-[#E5B34B] h-full transition-all duration-500"
                    style={{ width: `${Math.min(100, Math.max(0, 100 - (data?.cache?.hitRatio ?? 0)))}%` }}
                    title="Misses"
                  />
                </div>
                <div className="flex justify-between text-3xs text-[#64748B] mt-1 font-mono">
                  <span>Hits: {(data?.cache?.hits ?? 0).toLocaleString()}</span>
                  <span>Misses: {(data?.cache?.misses ?? 0).toLocaleString()}</span>
                </div>
              </div>

              {/* Counters Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2">
                <div className="p-2.5 rounded-lg border border-[#E7E8EC] bg-white text-center">
                  <div className="text-3xs text-[#64748B] font-semibold uppercase">Hits</div>
                  <div className="text-base font-bold text-[#159B78]">
                    {(data?.cache?.hits ?? 0).toLocaleString()}
                  </div>
                </div>

                <div className="p-2.5 rounded-lg border border-[#E7E8EC] bg-white text-center">
                  <div className="text-3xs text-[#64748B] font-semibold uppercase">Misses</div>
                  <div className="text-base font-bold text-[#E5B34B]">
                    {(data?.cache?.misses ?? 0).toLocaleString()}
                  </div>
                </div>

                <div className="p-2.5 rounded-lg border border-[#E7E8EC] bg-white text-center">
                  <div className="text-3xs text-[#64748B] font-semibold uppercase">Sets / Writes</div>
                  <div className="text-base font-bold text-[#5277D9]">
                    {(data?.cache?.sets ?? 0).toLocaleString()}
                  </div>
                </div>

                <div className="p-2.5 rounded-lg border border-[#E7E8EC] bg-white text-center">
                  <div className="text-3xs text-[#64748B] font-semibold uppercase">Invalidations</div>
                  <div className="text-base font-bold text-[#7357D6]">
                    {(data?.cache?.deletes ?? 0).toLocaleString()}
                  </div>
                </div>
              </div>

              {/* Security Invariant Callout */}
              <div className="p-3 rounded-lg border border-[#E7E8EC] bg-[#F8FAFC] text-xs space-y-1">
                <div className="flex items-center gap-1.5 font-semibold text-[#202938]">
                  <ShieldAlert className="w-3.5 h-3.5 text-[#5277D9]" />
                  <span>Security & Invalidation Invariants</span>
                </div>
                <p className="text-2xs text-[#64748B] leading-relaxed">
                  Signing secrets are strictly <strong>excluded</strong> from cache storage. Only sanitized response DTOs are cached in Redis. Cache entries are atomically evicted on every endpoint update or deactivation.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Right: Cache Namespaces & Policy Rules */}
        <Card className="flex flex-col justify-between">
          <CardHeader className="border-b border-[#E7E8EC] bg-[#F7F6F2] py-3.5 px-5">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-[#5277D9]" />
              <CardTitle className="text-sm">Configured Cache TTL Policies</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-[#E7E8EC] text-xs">
              <div className="p-4 flex items-center justify-between">
                <div>
                  <div className="font-semibold text-[#202938]">Single Endpoint Metadata</div>
                  <div className="text-2xs text-[#64748B] font-mono mt-0.5">
                    tenant:{'{tenantId}'}:endpoint:{'{endpointId}'}
                  </div>
                  <div className="text-3xs text-[#64748B] mt-1">
                    Evicted on: Endpoint update, deactivation
                  </div>
                </div>
                <div className="text-right">
                  <span className="font-bold text-sm text-[#202938]">
                    {data?.cache?.ttlConfig?.endpointTtlSeconds ?? 300}s
                  </span>
                  <div className="text-3xs text-[#64748B]">5 minutes</div>
                </div>
              </div>

              <div className="p-4 flex items-center justify-between">
                <div>
                  <div className="font-semibold text-[#202938]">Endpoints List Summary</div>
                  <div className="text-2xs text-[#64748B] font-mono mt-0.5">
                    tenant:{'{tenantId}'}:endpoints:list
                  </div>
                  <div className="text-3xs text-[#64748B] mt-1">
                    Evicted on: Endpoint creation, update, deactivation
                  </div>
                </div>
                <div className="text-right">
                  <span className="font-bold text-sm text-[#202938]">
                    {data?.cache?.ttlConfig?.endpointsListTtlSeconds ?? 300}s
                  </span>
                  <div className="text-3xs text-[#64748B]">5 minutes</div>
                </div>
              </div>

              <div className="p-4 flex items-center justify-between">
                <div>
                  <div className="font-semibold text-[#202938]">Analytics Overview Aggregates</div>
                  <div className="text-2xs text-[#64748B] font-mono mt-0.5">
                    tenant:{'{tenantId}'}:analytics:overview:{'{startDate}'}:{'{endDate}'}
                  </div>
                  <div className="text-3xs text-[#64748B] mt-1">
                    Natural TTL expiration per date boundary range
                  </div>
                </div>
                <div className="text-right">
                  <span className="font-bold text-sm text-[#202938]">
                    {data?.cache?.ttlConfig?.analyticsOverviewTtlSeconds ?? 60}s
                  </span>
                  <div className="text-3xs text-[#64748B]">1 minute</div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Section C: Distributed Rate Limiting */}
      <Card>
        <CardHeader className="border-b border-[#E7E8EC] bg-[#F7F6F2] py-3.5 px-5">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-[#5277D9]" />
              <CardTitle className="text-sm">Distributed Sliding-Window Rate Limiting</CardTitle>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="slate" className="text-2xs font-mono">
                Store: {isHealthy ? 'Redis ZSET (Lua Script)' : 'MemoryRateLimitStore (Fallback)'}
              </Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-5 space-y-6">
          {/* Rate Limit Summary Stats */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-4 rounded-xl border border-[#E7E8EC] bg-white">
              <span className="text-3xs font-semibold uppercase text-[#64748B]">Total Requests Evaluated</span>
              <div className="text-xl font-bold text-[#202938] mt-1">
                {(data?.rateLimiting?.totalEvaluated ?? 0).toLocaleString()}
              </div>
              <p className="text-3xs text-[#64748B] mt-1">Evaluated across all active rate limit policies</p>
            </div>

            <div className="p-4 rounded-xl border border-[#CFEFE6] bg-[#EBF8F4]">
              <span className="text-3xs font-semibold uppercase text-[#0D7A5D]">Allowed Permits</span>
              <div className="text-xl font-bold text-[#159B78] mt-1">
                {(data?.rateLimiting?.allowedRequests ?? 0).toLocaleString()}
              </div>
              <p className="text-3xs text-[#0D7A5D] mt-1">Requests processed within tenant allocation</p>
            </div>

            <div className="p-4 rounded-xl border border-[#FFCCC7] bg-[#FFF2F0]">
              <span className="text-3xs font-semibold uppercase text-[#A8071A]">Throttled (HTTP 429)</span>
              <div className="text-xl font-bold text-[#E76B64] mt-1">
                {(data?.rateLimiting?.throttledRequests ?? 0).toLocaleString()}
              </div>
              <p className="text-3xs text-[#A8071A] mt-1">
                Throttle rate: {data?.rateLimiting?.throttleRate ?? 0}%
              </p>
            </div>
          </div>

          {/* Rate Limit Policies Table */}
          <div>
            <h4 className="text-xs font-semibold text-[#202938] mb-2 uppercase tracking-wider">
              Enforced Rate Limit Policies
            </h4>
            <div className="rounded-lg border border-[#E7E8EC] overflow-x-auto bg-white">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-[#F8FAFC] border-b border-[#E7E8EC] text-3xs font-semibold text-[#64748B] uppercase tracking-wider">
                    <th className="py-2.5 px-4">Policy Name</th>
                    <th className="py-2.5 px-4">Limiter Type</th>
                    <th className="py-2.5 px-4">Configured Limit</th>
                    <th className="py-2.5 px-4">Sliding Window</th>
                    <th className="py-2.5 px-4">Storage Mode</th>
                    <th className="py-2.5 px-4">Action on Exceeded</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E7E8EC]">
                  {data?.rateLimiting?.policies.map((p) => (
                    <tr key={p.type} className="hover:bg-[#F8FAFC]/60 transition-colors">
                      <td className="py-3 px-4 font-medium text-[#202938]">
                        {p.name}
                        <div className="text-3xs text-[#64748B] font-normal">{p.description}</div>
                      </td>
                      <td className="py-3 px-4">
                        <Badge variant="slate" className="font-mono text-3xs">
                          {p.type}
                        </Badge>
                      </td>
                      <td className="py-3 px-4 font-semibold text-[#202938]">
                        {p.limit} requests
                      </td>
                      <td className="py-3 px-4 font-mono text-2xs text-[#64748B]">
                        {p.windowMs >= 1000 ? `${p.windowMs / 1000}s` : `${p.windowMs}ms`}
                      </td>
                      <td className="py-3 px-4">
                        <Badge
                          variant={isHealthy ? 'success' : 'warning'}
                          className="text-3xs"
                        >
                          {isHealthy ? 'Redis ZSET' : 'In-Memory Fallback'}
                        </Badge>
                      </td>
                      <td className="py-3 px-4">
                        <span className="inline-flex items-center gap-1 font-mono text-3xs text-[#E76B64] font-semibold bg-[#FFF2F0] px-2 py-0.5 rounded border border-[#FFCCC7]">
                          429 Too Many Requests
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

export default RedisMonitoringPage
