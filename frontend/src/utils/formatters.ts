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

export function formatRate(rate: number | undefined | null): string {
  if (rate === undefined || rate === null || isNaN(rate)) return '0.0%'
  return `${rate.toFixed(1)}%`
}

export function copyToClipboard(text: string): Promise<boolean> {
  if (navigator?.clipboard?.writeText) {
    return navigator.clipboard.writeText(text).then(() => true).catch(() => false)
  }
  return Promise.resolve(false)
}
