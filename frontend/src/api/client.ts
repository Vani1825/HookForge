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

export interface RequestOptions extends RequestInit {
  timeoutMs?: number
  params?: Record<string, string | number | boolean | undefined | null>
}

class ApiClient {
  private getBaseUrl(): string {
    const customBase = localStorage.getItem('hookforge_api_base_url')
    if (customBase) return customBase.replace(/\/+$/, '')
    return (import.meta.env.VITE_API_BASE_URL || 'http://localhost:8080').replace(/\/+$/, '')
  }

  private getApiKey(): string | null {
    const customKey = localStorage.getItem('hookforge_api_key')
    if (customKey) return customKey
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
        const errorMessage =
          typeof data === 'object' && data !== null && 'error' in data
            ? (data as { error: string }).error
            : typeof data === 'object' && data !== null && 'message' in data
            ? (data as { message: string }).message
            : `Request failed with status ${response.status}`

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
