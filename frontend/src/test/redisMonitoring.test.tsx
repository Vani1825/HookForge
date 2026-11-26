// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AppProvider } from '../context/AppContext'
import { RedisMonitoringPage } from '../pages/RedisMonitoringPage'
import { Sidebar } from '../layouts/Sidebar'
import { mockStore } from '../mocks/mockStore'
import { apiClient } from '../api/client'
import { getRedisMonitoring } from '../api/monitoring'
import type { HealthResponse } from '../types'

vi.mock('../api/client', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
  formatErrorMessage: (err: any) =>
    err?.message || err?.error || 'Failed to fetch monitoring telemetry',
}))

describe("Phase 3 – Mannat's Task 1: Redis Monitoring & Visibility (Frontend)", () => {
  beforeEach(() => {
    cleanup()
    vi.clearAllMocks()
    localStorage.clear()
    localStorage.setItem('hookforge_app_mode', 'demo')
    mockStore.setRedisSimulatedState('healthy')
  })

  afterEach(() => {
    cleanup()
  })

  describe('1. MockStore Redis Monitoring Implementation', () => {
    it('returns healthy status and complete telemetry by default', () => {
      mockStore.setRedisSimulatedState('healthy')
      const telemetry = mockStore.getRedisMonitoring()

      expect(telemetry.health.status).toBe('up')
      expect(telemetry.systemStatus).toBe('up')
      expect(telemetry.isFallbackActive).toBe(false)
      expect(telemetry.health.latencyMs).toBe(2)
      expect(telemetry.cache.hitRatio).toBeGreaterThan(80)
      expect(telemetry.rateLimiting.policies).toHaveLength(3)
    })

    it('returns degraded state with high latency and active fallback', () => {
      mockStore.setRedisSimulatedState('degraded')
      const telemetry = mockStore.getRedisMonitoring()

      expect(telemetry.health.status).toBe('down')
      expect(telemetry.systemStatus).toBe('degraded')
      expect(telemetry.isFallbackActive).toBe(true)
      expect(telemetry.health.latencyMs).toBe(2450)
      expect(telemetry.fallbackReason).toContain('High Redis latency detected')
    })

    it('returns offline state with ECONNREFUSED error and ACID guarantee notice', () => {
      mockStore.setRedisSimulatedState('offline')
      const telemetry = mockStore.getRedisMonitoring()

      expect(telemetry.health.status).toBe('down')
      expect(telemetry.systemStatus).toBe('degraded')
      expect(telemetry.isFallbackActive).toBe(true)
      expect(telemetry.health.error).toContain('ECONNREFUSED')
      expect(telemetry.fallbackReason).toContain('Zero dropped deliveries')
    })
  })

  describe('2. API Client & Telemetry Normalizer', () => {
    it('normalizes live backend /health response into RedisMonitoringOverview', async () => {
      const mockHealth: HealthResponse = {
        status: 'up',
        timestamp: '2026-11-26T10:00:00.000Z',
        checks: {
          database: { status: 'up' },
          redis: { status: 'up', latencyMs: 3 },
        },
      }
      vi.mocked(apiClient.get).mockResolvedValue(mockHealth)

      const result = await getRedisMonitoring()
      expect(result.health.status).toBe('up')
      expect(result.health.latencyMs).toBe(3)
      expect(result.isFallbackActive).toBe(false)
      expect(result.cache.ttlConfig.endpointTtlSeconds).toBe(300)
      expect(result.rateLimiting.policies).toHaveLength(3)
    })

    it('identifies offline redis and marks fallback as active', async () => {
      const mockHealth: HealthResponse = {
        status: 'degraded',
        timestamp: '2026-11-26T10:00:00.000Z',
        checks: {
          database: { status: 'up' },
          redis: { status: 'down', error: 'ECONNREFUSED 127.0.0.1:6379' },
        },
      }
      vi.mocked(apiClient.get).mockResolvedValue(mockHealth)

      const result = await getRedisMonitoring()
      expect(result.health.status).toBe('down')
      expect(result.isFallbackActive).toBe(true)
      expect(result.fallbackReason).toContain('ECONNREFUSED')
    })
  })

  describe('3. RedisMonitoringPage UI Rendering', () => {
    it('renders healthy Redis state, stat cards, and operational banner', async () => {
      mockStore.setRedisSimulatedState('healthy')

      render(
        <AppProvider>
          <MemoryRouter>
            <RedisMonitoringPage />
          </MemoryRouter>
        </AppProvider>
      )

      await waitFor(() => {
        expect(screen.getByText(/Redis & Distributed Systems Monitoring/i)).toBeDefined()
        expect(screen.getByText(/Redis Distributed System Operational/i)).toBeDefined()
        expect(screen.getByText(/Hit Ratio Efficiency/i)).toBeDefined()
        expect(screen.getByText(/Single Endpoint Metadata/i)).toBeDefined()
        expect(screen.getByText(/Distributed Sliding-Window Rate Limiting/i)).toBeDefined()
      })

      // Verify stat cards
      expect(screen.getByText(/Redis Connection/i)).toBeDefined()
      expect(screen.getByText(/Cache Hit Ratio/i)).toBeDefined()
      expect(screen.getByText(/PostgreSQL ACID/i)).toBeDefined()
    })

    it('renders resilient fallback warning when Redis is simulated offline', async () => {
      mockStore.setRedisSimulatedState('offline')

      render(
        <AppProvider>
          <MemoryRouter>
            <RedisMonitoringPage />
          </MemoryRouter>
        </AppProvider>
      )

      await waitFor(() => {
        expect(screen.getByRole('alert')).toBeDefined()
        expect(screen.getByText(/Resilient Database Fallback Active \(Redis Offline\)/i)).toBeDefined()
        expect(screen.getByText(/Zero dropped deliveries/i)).toBeDefined()
      })
    })

    it('allows toggling between simulation states in demo mode', async () => {
      render(
        <AppProvider>
          <MemoryRouter>
            <RedisMonitoringPage />
          </MemoryRouter>
        </AppProvider>
      )

      await waitFor(() => {
        expect(screen.getByText(/Simulate:/i)).toBeDefined()
      })

      const offlineBtn = screen.getByRole('button', { name: /Offline/i })
      fireEvent.click(offlineBtn)

      await waitFor(() => {
        expect(screen.getByText(/Resilient Database Fallback Active/i)).toBeDefined()
      })

      const healthyBtn = screen.getByRole('button', { name: /Healthy/i })
      fireEvent.click(healthyBtn)

      await waitFor(() => {
        expect(screen.getByText(/Redis Distributed System Operational/i)).toBeDefined()
      })
    })

    it('renders error state when fetching telemetry fails', async () => {
      localStorage.setItem('hookforge_app_mode', 'live')
      vi.mocked(apiClient.get).mockRejectedValue(new Error('Network connectivity failure to backend'))

      render(
        <AppProvider>
          <MemoryRouter>
            <RedisMonitoringPage />
          </MemoryRouter>
        </AppProvider>
      )

      await waitFor(() => {
        expect(screen.getByText(/Health Probe Error/i)).toBeDefined()
        expect(screen.getByText(/Network connectivity failure to backend/i)).toBeDefined()
        expect(screen.getByRole('button', { name: /Retry Probe/i })).toBeDefined()
      })
    })

    it('toggles diagnostic raw JSON viewer when clicked', async () => {
      render(
        <AppProvider>
          <MemoryRouter>
            <RedisMonitoringPage />
          </MemoryRouter>
        </AppProvider>
      )

      await waitFor(() => {
        expect(screen.getByText(/View Diagnostic JSON/i)).toBeDefined()
      })

      const toggleBtn = screen.getByText(/View Diagnostic JSON/i)
      fireEvent.click(toggleBtn)

      await waitFor(() => {
        expect(screen.getByText(/Raw Monitoring Payload/i)).toBeDefined()
      })
    })
  })

  describe('4. Sidebar Navigation Integration', () => {
    it('renders System Monitoring navigation link in Operations group', () => {
      render(
        <AppProvider>
          <MemoryRouter>
            <Sidebar isOpen={true} onClose={() => {}} />
          </MemoryRouter>
        </AppProvider>
      )

      const monitoringLink = screen.getByRole('link', { name: /System Monitoring/i })
      expect(monitoringLink).toBeDefined()
      expect(monitoringLink.getAttribute('href')).toBe('/monitoring')
    })

    it('displays Redis Cache status in sidebar system status widget', () => {
      render(
        <AppProvider>
          <MemoryRouter>
            <Sidebar isOpen={true} onClose={() => {}} />
          </MemoryRouter>
        </AppProvider>
      )

      expect(screen.getByText(/Redis Cache/i)).toBeDefined()
      expect(screen.getByText(/SYSTEM STATUS/i)).toBeDefined()
    })
  })
})
