import { apiClient } from './client'
import type { HealthResponse, RedisMonitoringOverview } from '../types'

/**
 * Fetch Redis and system health telemetry from backend GET /health.
 * Normalizes live health data into a complete RedisMonitoringOverview.
 */
export async function getRedisMonitoring(): Promise<RedisMonitoringOverview> {
  const health = await apiClient.get<HealthResponse>('/health', { timeoutMs: 3500 })

  const redisCheck = health.checks?.redis || {
    status: 'disabled',
  }

  const isFallbackActive = redisCheck.status !== 'up'
  let fallbackReason: string | undefined
  if (redisCheck.status === 'down') {
    fallbackReason = redisCheck.error || 'Redis connection failed or ping timed out'
  } else if (redisCheck.status === 'disabled') {
    fallbackReason = 'Redis is disabled by platform environment configuration'
  }

  return {
    health: redisCheck,
    systemStatus: health.status || 'up',
    timestamp: health.timestamp || new Date().toISOString(),
    isFallbackActive,
    fallbackReason,
    cache: {
      hits: 0,
      misses: 0,
      totalLookups: 0,
      hitRatio: 0,
      sets: 0,
      deletes: 0,
      ttlConfig: {
        endpointTtlSeconds: 300,
        endpointsListTtlSeconds: 300,
        analyticsOverviewTtlSeconds: 60,
      },
    },
    rateLimiting: {
      allowedRequests: 0,
      throttledRequests: 0,
      totalEvaluated: 0,
      throttleRate: 0,
      policies: [
        {
          name: 'Tenant API Rate Limit',
          type: 'tenant',
          limit: 100,
          windowMs: 1000,
          unit: '100 req/sec',
          description: 'Distributed sliding window limit per authenticated tenant key',
        },
        {
          name: 'Failed Authentication Protection',
          type: 'auth_fail',
          limit: 10,
          windowMs: 60000,
          unit: '10 failures/min',
          description: 'IP-based brute-force throttle on failed API key verifications',
        },
        {
          name: 'Health Check Rate Limit',
          type: 'health',
          limit: 30,
          windowMs: 60000,
          unit: '30 req/min',
          description: 'IP-based rate limit protecting PostgreSQL connection pool from health probes',
        },
      ],
    },
    mode: 'live',
  }
}

export default {
  getRedisMonitoring,
}
