import { apiClient } from './client'
import type { OverviewMetrics, TimeSeriesDataPoint, StatusDistribution } from '../types'

export interface MetricsFilterParams {
  [key: string]: string | number | boolean | undefined | null
  range?: '24h' | '7d' | '30d' | string
  startDate?: string
  endDate?: string
  interval?: 'hour' | 'day'
}

/**
 * Fetch high-level overview KPI telemetry.
 */
export async function fetchOverviewMetrics(params?: MetricsFilterParams): Promise<OverviewMetrics> {
  return apiClient.get<OverviewMetrics>('/metrics', { params })
}

/**
 * Fetch bucketed time-series metrics for throughput and outcome trend charts.
 */
export async function fetchTimeSeriesMetrics(params?: MetricsFilterParams): Promise<TimeSeriesDataPoint[]> {
  return apiClient.get<TimeSeriesDataPoint[]>('/metrics/timeseries', { params })
}

/**
 * Fetch delivery state distribution for pie/donut charts.
 */
export async function fetchStatusDistribution(params?: MetricsFilterParams): Promise<StatusDistribution[]> {
  return apiClient.get<StatusDistribution[]>('/metrics/distribution', { params })
}

/**
 * Backward compatibility alias for fetchOverviewMetrics.
 */
export async function fetchSystemMetrics(): Promise<OverviewMetrics> {
  return fetchOverviewMetrics()
}
