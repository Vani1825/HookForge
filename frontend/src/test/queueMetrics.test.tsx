// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueueMetricsSection } from '../components/QueueMetricsSection'
import { DashboardPage } from '../pages/DashboardPage'
import type { OverviewMetrics, StatusDistribution, TimeSeriesDataPoint } from '../types'

// Mock AppContext dependencies for DashboardPage integration
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

const mockBackendHealth = {
  status: 'up' as const,
  timestamp: '2026-11-17T12:00:00.000Z',
  checks: {
    database: { status: 'up' as const },
    worker: {
      status: 'up' as const,
      activeWorkers: 10,
      currentlyProcessing: 2,
      lastHeartbeat: '2026-11-17T11:59:59.000Z',
    },
  },
}

vi.mock('../context/AppContext', () => ({
  useApp: () => ({
    mode: 'live',
    toggleMode: vi.fn(),
    service: mockService,
    backendHealth: mockBackendHealth,
    checkHealth: mockCheckHealth,
  }),
}))

describe('QueueMetricsSection Component', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  describe('Queue Metrics Rendering & Calculations', () => {
    const sampleMetrics: OverviewMetrics = {
      totalEvents: 100,
      totalDeliveries: 120,
      succeededDeliveries: 100,
      failedDeliveries: 5,
      pendingDeliveries: 15,
      pendingCount: 8,
      inFlightCount: 4,
      retryingCount: 3,
      queueBacklog: 11, // 8 pending + 3 retrying
      currentlyProcessing: 4,
      deadLetterCount: 5,
      successRate: 83.3,
      averageLatencyMs: 45,
      activeEndpoints: 3,
      totalEndpoints: 3,
      openCircuits: 0,
    }

    const sampleTimeSeries: TimeSeriesDataPoint[] = [
      { timestamp: '10:00', label: '10:00', total: 40, succeeded: 35, failed: 2, pending: 3 },
      { timestamp: '11:00', label: '11:00', total: 65, succeeded: 60, failed: 1, pending: 4 },
    ]

    it('renders the queue backlog and processing section title and badge', () => {
      render(
        <QueueMetricsSection
          metrics={sampleMetrics}
          timeSeries={sampleTimeSeries}
        />
      )

      expect(screen.getByText('Queue Backlog & Processing Metrics')).toBeDefined()
      expect(screen.getByText(/11.*Backlogged/)).toBeDefined()
    })

    it('renders all 7 key queue metrics accurately', () => {
      render(
        <QueueMetricsSection
          metrics={sampleMetrics}
          timeSeries={sampleTimeSeries}
        />
      )

      // Metric labels
      expect(screen.getByText('Queue Backlog')).toBeDefined()
      expect(screen.getByText('In-Flight')).toBeDefined()
      expect(screen.getByText('Pending')).toBeDefined()
      expect(screen.getByText('Retrying')).toBeDefined()
      expect(screen.getByText('Delivered')).toBeDefined()
      expect(screen.getByText('Dead Letters')).toBeDefined()
      expect(screen.getByText('Throughput')).toBeDefined()

      // Metric values (using getAllByText because values also appear in legend / badge)
      expect(screen.getAllByText('11').length).toBeGreaterThanOrEqual(1) // Queue Backlog
      expect(screen.getAllByText('4').length).toBeGreaterThanOrEqual(1) // In-Flight / Currently processing
      expect(screen.getAllByText('8').length).toBeGreaterThanOrEqual(1) // Pending
      expect(screen.getAllByText('3').length).toBeGreaterThanOrEqual(1) // Retrying
      expect(screen.getAllByText('100').length).toBeGreaterThanOrEqual(1) // Delivered
      expect(screen.getAllByText('5').length).toBeGreaterThanOrEqual(1) // Dead Letters
      expect(screen.getByText(/65/)).toBeDefined() // Latest throughput (from sampleTimeSeries[1])
    })

    it('computes queue backlog as pending + retrying when not explicitly in metrics', () => {
      const metricsWithoutExplicitBacklog: OverviewMetrics = {
        totalEvents: 50,
        totalDeliveries: 50,
        succeededDeliveries: 40,
        failedDeliveries: 2,
        pendingDeliveries: 8,
        pendingCount: 5,
        inFlightCount: 1,
        retryingCount: 2,
        successRate: 80,
        averageLatencyMs: 60,
        activeEndpoints: 2,
        totalEndpoints: 2,
        openCircuits: 0,
      }

      render(<QueueMetricsSection metrics={metricsWithoutExplicitBacklog} />)

      // Backlog = pendingCount(5) + retryingCount(2) = 7
      expect(screen.getByText(/7.*Backlogged/)).toBeDefined()
      expect(screen.getByText('7')).toBeDefined()
      // Currently processing defaults to inFlightCount = 1
      expect(screen.getAllByText('1').length).toBeGreaterThanOrEqual(1)
    })

    it('displays "Queue Clean" when backlog is 0', () => {
      const cleanMetrics: OverviewMetrics = {
        totalEvents: 50,
        totalDeliveries: 50,
        succeededDeliveries: 48,
        failedDeliveries: 2,
        pendingDeliveries: 0,
        pendingCount: 0,
        inFlightCount: 0,
        retryingCount: 0,
        queueBacklog: 0,
        currentlyProcessing: 0,
        deadLetterCount: 2,
        successRate: 96,
        averageLatencyMs: 35,
        activeEndpoints: 2,
        totalEndpoints: 2,
        openCircuits: 0,
      }

      render(<QueueMetricsSection metrics={cleanMetrics} />)

      expect(screen.getByText('Queue Clean')).toBeDefined()
      expect(screen.getByText('Queue is currently idle')).toBeDefined()
    })

    it('displays active queue summary when items are in backlog or leased', () => {
      render(
        <QueueMetricsSection
          metrics={sampleMetrics}
          timeSeries={sampleTimeSeries}
        />
      )

      expect(
        screen.getByText('11 awaiting dispatch • 4 currently leased')
      ).toBeDefined()
    })

    it('renders workload distribution legend with exact counts and calculated percentages', () => {
      render(
        <QueueMetricsSection
          metrics={sampleMetrics}
          timeSeries={sampleTimeSeries}
        />
      )

      // Total is 120
      // Succeeded: 100 / 120 = 83%
      expect(screen.getByText(/Succeeded:/)).toBeDefined()
      expect(screen.getByText(/83%/)).toBeDefined()

      // In-flight: 4 / 120 = 3%
      expect(screen.getByText(/In-Flight:/)).toBeDefined()
      expect(screen.getAllByText(/3%/).length).toBeGreaterThanOrEqual(1)

      // Pending: 8 / 120 = 7%
      expect(screen.getByText(/Pending:/)).toBeDefined()
      expect(screen.getByText(/7%/)).toBeDefined()

      // Retrying: 3 / 120 = 3%
      expect(screen.getByText(/Retrying:/)).toBeDefined()

      // Dead letters: 5 / 120 = 4%
      expect(screen.getByText(/Dead Letters:/)).toBeDefined()
      expect(screen.getByText(/4%/)).toBeDefined()
    })
  })

  describe('Fallback to StatusDistribution', () => {
    it('uses statusDistribution values if metrics does not contain broken-down counts', () => {
      const legacyMetrics: OverviewMetrics = {
        totalEvents: 25,
        totalDeliveries: 25,
        succeededDeliveries: 20,
        failedDeliveries: 2,
        pendingDeliveries: 3,
        successRate: 80,
        averageLatencyMs: 50,
        activeEndpoints: 1,
        totalEndpoints: 1,
        openCircuits: 0,
      }

      const statusDist: StatusDistribution[] = [
        { name: 'Succeeded', value: 20, color: '#159B78' },
        { name: 'Pending', value: 1, color: '#64748B' },
        { name: 'Retrying', value: 1, color: '#E5B34B' },
        { name: 'In Flight', value: 1, color: '#5277D9' },
        { name: 'Dead Letter', value: 2, color: '#E76B64' },
      ]

      render(
        <QueueMetricsSection
          metrics={legacyMetrics}
          statusDistribution={statusDist}
        />
      )

      // Backlog should be pending (1) + retrying (1) = 2
      expect(screen.getByText(/2.*Backlogged/)).toBeDefined()
      expect(screen.getByText('2 awaiting dispatch • 1 currently leased')).toBeDefined()
    })
  })

  describe('Empty & Loading & Error States', () => {
    it('handles empty queue with zero deliveries gracefully', () => {
      const emptyMetrics: OverviewMetrics = {
        totalEvents: 0,
        totalDeliveries: 0,
        succeededDeliveries: 0,
        failedDeliveries: 0,
        pendingDeliveries: 0,
        pendingCount: 0,
        inFlightCount: 0,
        retryingCount: 0,
        queueBacklog: 0,
        currentlyProcessing: 0,
        successRate: 100,
        averageLatencyMs: 0,
        activeEndpoints: 0,
        totalEndpoints: 0,
        openCircuits: 0,
      }

      render(<QueueMetricsSection metrics={emptyMetrics} />)

      expect(screen.getByText('No deliveries currently recorded. Queue is clear.')).toBeDefined()
      expect(screen.getByText('Queue Clean')).toBeDefined()
    })

    it('shows updating pill when isLoading is true', () => {
      render(
        <QueueMetricsSection
          metrics={null}
          isLoading={true}
        />
      )

      expect(screen.getByText('Updating...')).toBeDefined()
    })

    it('renders error notice if error prop is passed', () => {
      render(
        <QueueMetricsSection
          metrics={null}
          error="Failed to connect to PostgreSQL queue"
        />
      )

      expect(screen.getByText('Queue Telemetry Unavailable')).toBeDefined()
      expect(screen.getByText('Failed to connect to PostgreSQL queue')).toBeDefined()
    })
  })
})

describe('DashboardPage Integration with Queue Metrics', () => {
  beforeEach(() => {
    mockGetOverviewMetrics.mockResolvedValue({
      totalEvents: 42,
      totalDeliveries: 50,
      succeededDeliveries: 45,
      failedDeliveries: 2,
      pendingDeliveries: 3,
      pendingCount: 2,
      inFlightCount: 1,
      retryingCount: 0,
      queueBacklog: 2,
      currentlyProcessing: 1,
      deadLetterCount: 2,
      successRate: 90,
      averageLatencyMs: 50,
      activeEndpoints: 4,
      totalEndpoints: 4,
      openCircuits: 0,
    })
    mockGetTimeSeriesMetrics.mockResolvedValue([
      { timestamp: '12:00', label: '12:00', total: 15, succeeded: 14, failed: 1, pending: 0 },
    ])
    mockGetStatusDistribution.mockResolvedValue([
      { name: 'Succeeded', value: 45, color: '#159B78' },
      { name: 'Pending', value: 2, color: '#64748B' },
      { name: 'In Flight', value: 1, color: '#5277D9' },
      { name: 'Dead Letter', value: 2, color: '#E76B64' },
    ])
    mockGetDeliveries.mockResolvedValue([])
    mockGetEndpoints.mockResolvedValue([])
    mockCheckHealth.mockResolvedValue(undefined)
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('renders QueueMetricsSection within DashboardPage with live telemetry', async () => {
    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    )

    await waitFor(() => {
      expect(screen.getByText('Queue Backlog & Processing Metrics')).toBeDefined()
      expect(screen.getByText(/2.*Backlogged/)).toBeDefined()
      expect(screen.getByText('15')).toBeDefined() // Recent throughput
    })
  })

  it('re-fetches queue metrics when refresh button is clicked', async () => {
    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    )

    await waitFor(() => {
      expect(screen.getByText('Queue Backlog & Processing Metrics')).toBeDefined()
    })

    const refreshButtons = screen.getAllByRole('button', { name: /Refresh/i })
    fireEvent.click(refreshButtons[0])

    await waitFor(() => {
      // service.getOverviewMetrics called on mount and once on refresh
      expect(mockGetOverviewMetrics).toHaveBeenCalledTimes(2)
    })
  })
})
