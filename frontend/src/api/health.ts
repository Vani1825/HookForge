import { apiClient } from './client'
import type { HealthResponse } from '../types'

/**
 * Health check endpoint probe
 * Backed by backend `GET /health` implemented in Phase 1
 */
export async function checkBackendHealth(): Promise<HealthResponse> {
  return apiClient.get<HealthResponse>('/health', { timeoutMs: 3000 })
}
