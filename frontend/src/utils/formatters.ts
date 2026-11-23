/**
 * Utility functions for date, string, and number formatting.
 */

export function formatDateTime(dateInput: string | Date | undefined | null): string {
  if (!dateInput) return '—'
  const date = typeof dateInput === 'string' ? new Date(dateInput) : dateInput
  if (isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date)
}

export function formatRelativeTime(dateInput: string | Date | undefined | null): string {
  if (!dateInput) return '—'
  const date = typeof dateInput === 'string' ? new Date(dateInput) : dateInput
  if (isNaN(date.getTime())) return '—'

  const now = new Date()
  const diffSec = Math.floor((now.getTime() - date.getTime()) / 1000)

  if (diffSec < 5) return 'just now'
  if (diffSec < 60) return `${diffSec}s ago`
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  const diffDays = Math.floor(diffHr / 24)
  if (diffDays < 7) return `${diffDays}d ago`

  return formatDateTime(date)
}

export function truncateId(id: string | undefined | null, length: number = 8): string {
  if (!id) return '—'
  if (id.length <= length + 4) return id
  return `${id.slice(0, length)}...${id.slice(-4)}`
}

export function formatLatency(latencyMs: number | undefined | null): string {
  if (latencyMs === undefined || latencyMs === null || isNaN(latencyMs)) return '—'
  if (latencyMs < 1000) return `${Math.round(latencyMs)} ms`
  return `${(latencyMs / 1000).toFixed(2)} s`
}

export function formatStatusCode(code: number | undefined | null): { text: string; category: 'success' | 'redirect' | 'client-error' | 'server-error' | 'timeout' } {
  if (code === undefined || code === null) {
    return { text: 'Network Error / Timeout', category: 'timeout' }
  }
  if (code >= 200 && code < 300) {
    return { text: `${code} OK`, category: 'success' }
  }
  if (code >= 300 && code < 400) {
    return { text: `${code} Redirect`, category: 'redirect' }
  }
  if (code === 429) {
    return { text: '429 Rate Limited', category: 'client-error' }
  }
  if (code >= 400 && code < 500) {
    return { text: `${code} Client Error`, category: 'client-error' }
  }
  if (code >= 500) {
    return { text: `${code} Server Error`, category: 'server-error' }
  }
  return { text: `${code}`, category: 'timeout' }
}

export function formatRate(rate: number | undefined | null, totalDeliveries?: number): string {
  if (totalDeliveries !== undefined && totalDeliveries <= 0) return '—'
  if (rate === undefined || rate === null || isNaN(rate)) return '0.0%'
  return `${rate.toFixed(1)}%`
}

export function copyToClipboard(text: string): Promise<boolean> {
  if (navigator?.clipboard?.writeText) {
    return navigator.clipboard.writeText(text).then(() => true).catch(() => false)
  }
  return Promise.resolve(false)
}

export function formatDuration(ms: number | undefined | null): string {
  if (ms === undefined || ms === null || isNaN(ms)) return '—'
  if (ms < 1000) return `${ms} ms`
  const sec = ms / 1000
  if (sec < 60) {
    return Number.isInteger(sec) ? `${sec}s` : `${sec.toFixed(1)}s`
  }
  const min = sec / 60
  if (min < 60) {
    return Number.isInteger(min) ? `${min}m` : `${min.toFixed(1)}m`
  }
  const hr = min / 60
  return Number.isInteger(hr) ? `${hr}h` : `${hr.toFixed(1)}h`
}

export function formatRetryPolicySummary(endpoint: {
  retry_strategy?: string
  retryStrategy?: string
  retry_max_attempts?: number
  retryMaxAttempts?: number
  retry_base_delay_ms?: number
  retryBaseDelayMs?: number
  retry_max_delay_ms?: number
  retryMaxDelayMs?: number
  retry_backoff_multiplier?: number
  retryBackoffMultiplier?: number
}): string {
  const strategy = (endpoint.retry_strategy || endpoint.retryStrategy || 'EXPONENTIAL').toUpperCase()
  const attempts = endpoint.retry_max_attempts ?? endpoint.retryMaxAttempts ?? 8
  const baseDelay = endpoint.retry_base_delay_ms ?? endpoint.retryBaseDelayMs ?? 5000

  if (strategy === 'FIXED') {
    return `Fixed (${attempts} attempts @ ${formatDuration(baseDelay)})`
  }

  const maxDelay = endpoint.retry_max_delay_ms ?? endpoint.retryMaxDelayMs ?? 3600000
  return `Exponential (${attempts} attempts, max ${formatDuration(maxDelay)})`
}
