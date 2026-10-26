import { describe, it, expect } from 'vitest'
import {
  formatDateTime,
  formatRelativeTime,
  truncateId,
  formatLatency,
  formatStatusCode,
  formatRate,
} from '../utils/formatters'

describe('Formatters Utility', () => {
  it('truncates UUIDs appropriately', () => {
    const uuid = '018f23a1-9a72-7c89-a21b-4395018e69d1'
    expect(truncateId(uuid, 8)).toBe('018f23a1...69d1')
    expect(truncateId('short')).toBe('short')
    expect(truncateId(null)).toBe('—')
  })

  it('formats latencies correctly', () => {
    expect(formatLatency(45)).toBe('45 ms')
    expect(formatLatency(1250)).toBe('1.25 s')
    expect(formatLatency(null)).toBe('—')
  })

  it('categorizes HTTP status codes properly', () => {
    expect(formatStatusCode(200)).toEqual({ text: '200 OK', category: 'success' })
    expect(formatStatusCode(429)).toEqual({ text: '429 Rate Limited', category: 'client-error' })
    expect(formatStatusCode(500)).toEqual({ text: '500 Server Error', category: 'server-error' })
    expect(formatStatusCode(null)).toEqual({ text: 'Network Error / Timeout', category: 'timeout' })
  })

  it('formats percentages safely without division by zero', () => {
    expect(formatRate(99.84)).toBe('99.8%')
    expect(formatRate(0)).toBe('0.0%')
    expect(formatRate(NaN)).toBe('0.0%')
    expect(formatRate(null)).toBe('0.0%')
  })

  it('formats dates cleanly', () => {
    expect(formatDateTime(null)).toBe('—')
    expect(formatDateTime('invalid-date')).toBe('—')
    expect(formatRelativeTime(null)).toBe('—')
    expect(formatRelativeTime(new Date())).toBe('just now')
  })
})
