/**
 * Centralized API Client for HookForge
 * Handles HTTP requests, authentication headers, error wrapping, and timeouts.
 */

export class ApiError extends Error {
  public status: number
  public details?: unknown

  constructor(message: string, status: number, details?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.details = details
  }
}

/**
 * Safely extract a human-readable error string from any thrown error or response payload.
 * Never returns "[object Object]".
 */
export function formatErrorMessage(err: unknown): string {
  if (!err) return 'An unexpected error occurred'
  if (err instanceof ApiError) {
    if (typeof err.message === 'string' && err.message !== '[object Object]' && err.message.trim()) {
      return err.message
    }
    if (err.details && typeof err.details === 'object') {
      const d = err.details as Record<string, unknown>
      if (typeof d.message === 'string' && d.message.trim()) return d.message
      if (typeof d.error === 'string' && d.error.trim()) return d.error
      if (typeof d.error === 'object' && d.error !== null) {
        const nested = d.error as Record<string, unknown>
        if (typeof nested.message === 'string' && nested.message.trim()) return nested.message
        if (typeof nested.type === 'string') return `Error: ${nested.type}`
      }
      try {
        return JSON.stringify(err.details)
      } catch {
        // fallback
      }
    }
  }
  if (err instanceof Error) {
    if (err.message && err.message !== '[object Object]' && err.message.trim()) {
      return err.message
    }
  }
  if (typeof err === 'object') {
    const obj = err as Record<string, unknown>
    if (typeof obj.message === 'string' && obj.message.trim()) return obj.message
    if (typeof obj.error === 'string' && obj.error.trim()) return obj.error
    if (typeof obj.error === 'object' && obj.error !== null) {
      const nested = obj.error as Record<string, unknown>
      if (typeof nested.message === 'string' && nested.message.trim()) return nested.message
    }
    try {
      return JSON.stringify(err)
    } catch {
      return String(err)
    }
  }
  return String(err)
}

export interface RequestOptions extends RequestInit {
  timeoutMs?: number
  params?: Record<string, string | number | boolean | undefined | null>
}

class ApiClient {
  private getBaseUrl(): string {
    const customBase = localStorage.getItem('hookforge_api_base_url')
    if (customBase && customBase.trim()) return customBase.trim().replace(/\/+$/, '')
    return (import.meta.env.VITE_API_BASE_URL || 'http://localhost:8081').replace(/\/+$/, '')
  }

  private getApiKey(): string | null {
    const customKey = localStorage.getItem('hookforge_api_key')
    if (customKey && customKey.trim()) return customKey.trim()
    return import.meta.env.VITE_API_KEY || null
  }

  public getActiveConfig(): { baseUrl: string; hasApiKey: boolean } {
    return {
      baseUrl: this.getBaseUrl(),
      hasApiKey: Boolean(this.getApiKey()),
    }
  }

  public async request<T>(endpoint: string, options: RequestOptions = {}): Promise<T> {
    const { timeoutMs = 8000, params, headers: customHeaders, ...fetchOptions } = options

    const baseUrl = this.getBaseUrl()
    const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`
    let url = `${baseUrl}${cleanEndpoint}`

    if (params) {
      const searchParams = new URLSearchParams()
      Object.entries(params).forEach(([key, val]) => {
        if (val !== undefined && val !== null && val !== '') {
          searchParams.append(key, String(val))
        }
      })
      const queryString = searchParams.toString()
      if (queryString) {
        url += (url.includes('?') ? '&' : '?') + queryString
      }
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...((customHeaders as Record<string, string>) || {}),
    }

    const apiKey = this.getApiKey()
    if (apiKey) {
      headers['X-Api-Key'] = apiKey
      // Also provide standard Bearer authorization header if preferred
      headers['Authorization'] = `Bearer ${apiKey}`
    }

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const response = await fetch(url, {
        ...fetchOptions,
        headers,
        signal: controller.signal,
      })

      clearTimeout(timeoutId)

      let data: unknown
      const contentType = response.headers.get('content-type')
      if (contentType && contentType.includes('application/json')) {
        try {
          data = await response.json()
        } catch {
          data = null
        }
      } else {
        data = await response.text()
      }

      if (!response.ok) {
        let errorMessage: string

        if (typeof data === 'object' && data !== null) {
          const obj = data as Record<string, unknown>
          if (typeof obj.error === 'string' && obj.error.trim()) {
            errorMessage = typeof obj.message === 'string' && obj.message.trim()
              ? `${obj.error}: ${obj.message}`
              : obj.error
          } else if (typeof obj.error === 'object' && obj.error !== null) {
            const nested = obj.error as Record<string, unknown>
            if (typeof nested.message === 'string' && nested.message.trim()) {
              errorMessage = nested.type ? `[${nested.type}] ${nested.message}` : nested.message
            } else if (typeof nested.type === 'string') {
              errorMessage = `Error type: ${nested.type}`
            } else {
              try {
                errorMessage = JSON.stringify(obj.error)
              } catch {
                errorMessage = `Request failed with status ${response.status}`
              }
            }
          } else if (typeof obj.message === 'string' && obj.message.trim()) {
            errorMessage = obj.message
          } else {
            errorMessage = `Request failed with status ${response.status}`
          }
        } else if (typeof data === 'string' && data.trim()) {
          errorMessage = data
        } else {
          errorMessage = `Request failed with status ${response.status}`
        }

        // Add contextual hints for common HTTP status codes
        if (response.status === 401) {
          errorMessage = `${errorMessage} (Missing or invalid Tenant API Key. Verify settings in Platform Settings).`
        } else if (response.status === 403) {
          errorMessage = `${errorMessage} (Tenant lacks permission to access this resource).`
        } else if (response.status === 404) {
          errorMessage = `${errorMessage} (Resource path not found on backend).`
        }

        throw new ApiError(errorMessage, response.status, data)
      }

      return data as T
    } catch (error: unknown) {
      clearTimeout(timeoutId)

      if (error instanceof ApiError) {
        throw error
      }

      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new ApiError(`Request timed out after ${timeoutMs}ms`, 408)
      }

      const message = error instanceof Error ? error.message : 'Network request failed'
      throw new ApiError(
        `Failed to connect to HookForge backend at ${baseUrl}. Ensure backend is running. (${message})`,
        0,
        error
      )
    }
  }

  public get<T>(endpoint: string, options?: RequestOptions): Promise<T> {
    return this.request<T>(endpoint, { ...options, method: 'GET' })
  }

  public post<T>(endpoint: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>(endpoint, {
      ...options,
      method: 'POST',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  }

  public patch<T>(endpoint: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>(endpoint, {
      ...options,
      method: 'PATCH',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  }

  public delete<T>(endpoint: string, options?: RequestOptions): Promise<T> {
    return this.request<T>(endpoint, { ...options, method: 'DELETE' })
  }
}

export const apiClient = new ApiClient()
