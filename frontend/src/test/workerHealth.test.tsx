// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { WorkerHealthCard } from '../components/WorkerHealthCard'
import { DashboardPage } from '../pages/DashboardPage'
import type { WorkerHealth } from '../types'

// Mock AppContext dependencies
const mockGetOverviewMetrics = vi.fn()
const mockGetTimeSeriesMetrics = vi.fn()
const mockGetStatusDistribution = vi.fn()
const mockGetDeliveries = vi.fn()
const mockGetEndpoints = vi.fn()
const mockCheckHealth = vi.fn()

const mockService = {
  getOverviewMetrics: mockGetOverviewMetrics,
  getTimeSeriesMetrics: mockGetTimeSeriesMetrics,
  getStatusDistribution: mockGetStatusDistribution,
  getDeliveries: mockGetDeliveries,
  getEndpoints: mockGetEndpoints,
}

let mockBackendHealthState = {
  status: 'up' as 'checking' | 'up' | 'down',
  timestamp: '2026-11-17T12:00:00.000Z',
  checks: {
    database: { status: 'up' as const },
    worker: {
      status: 'up' as const,
      activeWorkers: 50,
      currentlyProcessing: 3,
      lastHeartbeat: '2026-11-17T11:59:58.000Z',
    } as WorkerHealth,
  },
}

vi.mock('../context/AppContext', () => ({
  useApp: () => ({
    mode: 'live',
    toggleMode: vi.fn(),
    service: mockService,
    backendHealth: mockBackendHealthState,
    checkHealth: mockCheckHealth,
  }),
}))

describe('Worker Health Monitoring', () => {
  beforeEach(() => {
    mockGetOverviewMetrics.mockResolvedValue({
      totalEvents: 100,
      succeededDeliveries: 90,
      failedDeliveries: 5,
      pendingDeliveries: 5,
      successRate: 95,
      averageLatencyMs: 120,
    })
    mockGetTimeSeriesMetrics.mockResolvedValue([])
    mockGetStatusDistribution.mockResolvedValue([])
    mockGetDeliveries.mockResolvedValue([])
    mockGetEndpoints.mockResolvedValue([])
    mockCheckHealth.mockResolvedValue(undefined)
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
    document.body.style.overflow = ''
  })

  describe('Healthy Worker State', () => {
    const healthyHealth = {
      status: 'up' as const,
      timestamp: '2026-11-17T12:00:00.000Z',
      checks: {
        database: { status: 'up' as const },
        worker: {
          status: 'up' as const,
          activeWorkers: 50,
          currentlyProcessing: 4,
          lastHeartbeat: '2026-11-17T11:59:55.000Z',
        },
      },
    }

    it('renders overall worker status as Healthy with green status badge', () => {
      render(<WorkerHealthCard health={healthyHealth} />)

      const badge = screen.getByTestId('worker-status-badge')
      expect(badge).toBeDefined()
      expect(badge.textContent).toContain('Healthy')
      expect(screen.getByText('Delivery dispatcher loop is active and polling queue')).toBeDefined()
    })

    it('displays active worker count and concurrency capacity', () => {
      render(<WorkerHealthCard health={healthyHealth} />)

      expect(screen.getByText('50 concurrency')).toBeDefined()
      expect(screen.getByText('Configured worker slots')).toBeDefined()
    })

    it('displays currently processing deliveries count', () => {
      render(<WorkerHealthCard health={healthyHealth} />)

      expect(screen.getByText('4 in flight')).toBeDefined()
      expect(screen.getByText('Active PostgreSQL leases')).toBeDefined()
    })

    it('displays heartbeat timestamp and last health check timestamp', () => {
      render(<WorkerHealthCard health={healthyHealth} />)

      expect(screen.getByText(/Heartbeat:/)).toBeDefined()
      expect(screen.getByText(/Checked:/)).toBeDefined()
    })
  })

  describe('Unavailable Worker State', () => {
    const unavailableHealth = {
      status: 'down' as const,
      error: 'Connection refused to PostgreSQL database',
      timestamp: '2026-11-17T12:00:00.000Z',
      checks: {
        database: { status: 'down' as const, error: 'Connection refused' },
        worker: {
          status: 'down' as const,
          error: 'Database connection failed; workers unable to claim delivery leases',
          activeWorkers: 0,
          currentlyProcessing: 0,
          lastHeartbeat: null,
        },
      },
    }

    it('renders overall worker status as Unavailable with red badge', () => {
      render(<WorkerHealthCard health={unavailableHealth} />)

      const badge = screen.getByTestId('worker-status-badge')
      expect(badge).toBeDefined()
      expect(badge.textContent).toContain('Unavailable')
    })

    it('renders unavailable notice banner and details', () => {
      render(<WorkerHealthCard health={unavailableHealth} />)

      expect(screen.getByText('Worker Service Unavailable')).toBeDefined()
      expect(
        screen.getByText(/The delivery dispatcher service is currently offline or unreachable/)
      ).toBeDefined()
    })

    it('displays Unavailable when heartbeat is null', () => {
      render(<WorkerHealthCard health={unavailableHealth} />)

      expect(screen.getByText('Heartbeat: Unavailable')).toBeDefined()
    })
  })

  describe('Unknown or Missing Worker Information', () => {
    const missingWorkerHealth = {
      status: 'up' as const,
      timestamp: '2026-11-17T12:00:00.000Z',
      checks: {
        database: { status: 'up' as const },
        // worker is omitted / not exposed by backend
      },
    }

    it('renders overall status as Unknown when backend does not report worker checks', () => {
      render(<WorkerHealthCard health={missingWorkerHealth} />)

      const badge = screen.getByTestId('worker-status-badge')
      expect(badge).toBeDefined()
      expect(badge.textContent).toContain('Unknown')
      expect(screen.getByText('Connected backend does not expose worker telemetry')).toBeDefined()
    })

    it('displays Unavailable for active workers and processing counts without fabricating numbers', () => {
      render(<WorkerHealthCard health={missingWorkerHealth} />)

      const unavailables = screen.getAllByText('Unavailable')
      expect(unavailables.length).toBeGreaterThanOrEqual(2)
      expect(screen.getAllByText('Metric not reported by backend').length).toBe(2)
    })

    it('renders informational notice explaining that worker telemetry is not exposed', () => {
      render(<WorkerHealthCard health={missingWorkerHealth} />)

      expect(screen.getByText('Worker Information Not Reported')).toBeDefined()
      expect(
        screen.getByText(
          /The connected backend is reachable, but does not expose worker-specific telemetry/
        )
      ).toBeDefined()
    })
  })

  describe('API Errors and Health Updates', () => {
    it('handles refresh click without breaking and triggers onRefresh', async () => {
      const handleRefresh = vi.fn()
      render(
        <WorkerHealthCard
          health={{
            status: 'up',
            timestamp: '2026-11-17T12:00:00.000Z',
            checks: {
              database: { status: 'up' },
              worker: {
                status: 'up',
                activeWorkers: 50,
                currentlyProcessing: 0,
                lastHeartbeat: '2026-11-17T12:00:00.000Z',
              },
            },
          }}
          onRefresh={handleRefresh}
          isLoading={false}
        />
      )

      const refreshBtn = screen.getByRole('button', { name: 'Refresh worker health' })
      expect(refreshBtn).toBeDefined()

      await act(async () => {
        fireEvent.click(refreshBtn)
      })

      expect(handleRefresh).toHaveBeenCalledTimes(1)
    })

    it('disables refresh button during loading state', () => {
      render(
        <WorkerHealthCard
          health={{
            status: 'checking',
          }}
          onRefresh={vi.fn()}
          isLoading={true}
        />
      )

      const refreshBtn = screen.getByRole('button', { name: 'Refresh worker health' })
      expect(refreshBtn.getAttribute('disabled')).not.toBeNull()
      expect(screen.getByText('Probing...')).toBeDefined()
    })
  })

  describe('DashboardPage Integration', () => {
    it('renders WorkerHealthCard inside DashboardPage', async () => {
      render(
        <MemoryRouter>
          <DashboardPage />
        </MemoryRouter>
      )

      await waitFor(() => {
        expect(screen.getByText('Worker Health & Telemetry')).toBeDefined()
        expect(screen.getByTestId('worker-status-badge')).toBeDefined()
        expect(screen.getByText('50 concurrency')).toBeDefined()
      })
    })
  })
})
