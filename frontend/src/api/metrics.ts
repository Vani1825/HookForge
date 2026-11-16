import { apiClient } from './client'
import type { OverviewMetrics, TimeSeriesDataPoint, StatusDistribution } from '../types'

<<<<<<< HEAD
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
=======
export interface MetricsQueryParams {
  created_after?: string
  created_before?: string
  startDate?: string
  endDate?: string
  from?: string
  to?: string
  range?: '24h' | '7d' | '30d'
  [key: string]: string | number | boolean | null | undefined
}

function toParams(params?: MetricsQueryParams): Record<string, string | number | boolean | null | undefined> | undefined {
  if (!params) return undefined
  const queryParams: Record<string, string | number | boolean | null | undefined> = {}
  if (params.created_after) queryParams.created_after = params.created_after
  if (params.created_before) queryParams.created_before = params.created_before
  if (params.startDate) queryParams.startDate = params.startDate
  if (params.endDate) queryParams.endDate = params.endDate
  if (params.from) queryParams.from = params.from
  if (params.to) queryParams.to = params.to
  if (params.range) queryParams.range = params.range
  return queryParams
}

export async function fetchSystemMetrics(params?: MetricsQueryParams): Promise<OverviewMetrics> {
  const p = toParams(params)
  return p
    ? apiClient.get<OverviewMetrics>('/metrics', { params: p })
    : apiClient.get<OverviewMetrics>('/metrics')
}

export async function fetchTimeSeriesMetrics(params?: MetricsQueryParams): Promise<TimeSeriesDataPoint[]> {
  const p = toParams(params)
  const res = p
    ? await apiClient.get<any>('/metrics/timeseries', { params: p })
    : await apiClient.get<any>('/metrics/timeseries')
  return Array.isArray(res) ? res : res?.timeSeries || []
}

export async function fetchStatusDistribution(params?: MetricsQueryParams): Promise<StatusDistribution[]> {
  const p = toParams(params)
  const res = p
    ? await apiClient.get<any>('/metrics/distribution', { params: p })
    : await apiClient.get<any>('/metrics/distribution')
  return Array.isArray(res) ? res : res?.statusDistribution || []
>>>>>>> a86c7832e5318df24b920b36e7ca39eb2b80ae92
}
