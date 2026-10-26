import { apiClient } from './client'
import type { OverviewMetrics } from '../types'

export async function fetchSystemMetrics(): Promise<OverviewMetrics> {
  return apiClient.get<OverviewMetrics>('/metrics')
}
