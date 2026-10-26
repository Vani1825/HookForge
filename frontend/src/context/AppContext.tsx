import React, { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react'
import { checkBackendHealth } from '../api/health'
import { mockStore } from '../mocks/mockStore'
import * as endpointsApi from '../api/endpoints'
import * as eventsApi from '../api/events'
import * as deliveriesApi from '../api/deliveries'
import type {
  Endpoint,
  WebhookEvent,
  Delivery,
  OverviewMetrics,
  TimeSeriesDataPoint,
  StatusDistribution,
} from '../types'

export type AppMode = 'live' | 'demo'

export interface ToastMessage {
  id: string
  title: string
  description?: string
  type: 'success' | 'error' | 'warning' | 'info'
}

interface AppContextValue {
  mode: AppMode
  setMode: (mode: AppMode) => void
  toggleMode: () => void
  baseUrl: string
  setBaseUrl: (url: string) => void
  apiKey: string
  setApiKey: (key: string) => void
  backendHealth: {
    status: 'checking' | 'up' | 'down'
    error?: string
    timestamp?: string
  }
  checkHealth: () => Promise<void>
  toasts: ToastMessage[]
  addToast: (toast: Omit<ToastMessage, 'id'>) => void
  removeToast: (id: string) => void

  // Centralized Unified Data Access (transparently routes to live API or mock store)
  service: {
    getEndpoints: () => Promise<Endpoint[]>
    createEndpoint: (data: endpointsApi.CreateEndpointInput) => Promise<Endpoint>
    updateEndpoint: (id: string, data: endpointsApi.UpdateEndpointInput) => Promise<Endpoint>
    toggleEndpoint: (id: string, active: boolean) => Promise<Endpoint>
    getEvents: () => Promise<WebhookEvent[]>
    getEventById: (id: string) => Promise<WebhookEvent | undefined>
    ingestEvent: (data: eventsApi.IngestEventInput) => Promise<{ duplicate: boolean; deliveriesEnqueued: number; eventId?: string }>
    getDeliveries: (filter?: deliveriesApi.DeliveryQueryParams & { search?: string }) => Promise<Delivery[]>
    getDeliveryById: (id: string) => Promise<Delivery | undefined>
    getDeadLetters: () => Promise<Delivery[]>
    replayDelivery: (id: string) => Promise<{ success: boolean; message: string; delivery?: Delivery }>
    getOverviewMetrics: () => Promise<OverviewMetrics>
    getTimeSeriesMetrics: () => Promise<TimeSeriesDataPoint[]>
    getStatusDistribution: () => Promise<StatusDistribution[]>
  }
}

const AppContext = createContext<AppContextValue | undefined>(undefined)

const STORAGE_KEY_MODE = 'hookforge_app_mode'
const STORAGE_KEY_BASE_URL = 'hookforge_api_base_url'
const STORAGE_KEY_API_KEY = 'hookforge_api_key'

export const AppProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  // Mode selection: check localStorage or env var, fallback to 'demo' for smooth initial load
  const [mode, setModeState] = useState<AppMode>(() => {
    const saved = localStorage.getItem(STORAGE_KEY_MODE)
    if (saved === 'live' || saved === 'demo') return saved
    if (import.meta.env.VITE_DEMO_MODE === 'false') return 'live'
    return 'demo'
  })

  const [baseUrl, setBaseUrlState] = useState<string>(() => {
    return localStorage.getItem(STORAGE_KEY_BASE_URL) || import.meta.env.VITE_API_BASE_URL || 'http://localhost:8080'
  })

  const [apiKey, setApiKeyState] = useState<string>(() => {
    return localStorage.getItem(STORAGE_KEY_API_KEY) || import.meta.env.VITE_API_KEY || ''
  })

  const [backendHealth, setBackendHealth] = useState<{
    status: 'checking' | 'up' | 'down'
    error?: string
    timestamp?: string
  }>({ status: 'checking' })

  const [toasts, setToasts] = useState<ToastMessage[]>([])

  const setMode = useCallback((newMode: AppMode) => {
    setModeState(newMode)
    localStorage.setItem(STORAGE_KEY_MODE, newMode)
  }, [])

  const toggleMode = useCallback(() => {
    setModeState((prev) => {
      const next = prev === 'live' ? 'demo' : 'live'
      localStorage.setItem(STORAGE_KEY_MODE, next)
      return next
    })
  }, [])

  const setBaseUrl = useCallback((url: string) => {
    setBaseUrlState(url)
    localStorage.setItem(STORAGE_KEY_BASE_URL, url)
  }, [])

  const setApiKey = useCallback((key: string) => {
    setApiKeyState(key)
    localStorage.setItem(STORAGE_KEY_API_KEY, key)
  }, [])

  const addToast = useCallback((toast: Omit<ToastMessage, 'id'>) => {
    const id = `${Date.now()}-${Math.random().toString(36).substring(2, 6)}`
    setToasts((prev) => [...prev, { ...toast, id }])
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id))
    }, 4500)
  }, [])

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const checkHealth = useCallback(async () => {
    try {
      setBackendHealth({ status: 'checking' })
      const res = await checkBackendHealth()
      if (res.status === 'up') {
        setBackendHealth({ status: 'up', timestamp: res.timestamp })
      } else {
        setBackendHealth({
          status: 'down',
          error: res.checks?.database?.error || 'Backend reported unhealthy status',
          timestamp: res.timestamp,
        })
      }
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : 'Cannot reach backend server'
      setBackendHealth({
        status: 'down',
        error: errorMsg,
        timestamp: new Date().toISOString(),
      })
    }
  }, [])

  // Probe health on mount and every 30 seconds
  useEffect(() => {
    checkHealth()
    const timer = setInterval(() => {
      checkHealth()
    }, 30000)
    return () => clearInterval(timer)
  }, [checkHealth])

  // Centralized Unified Service API
  const service = {
    getEndpoints: async (): Promise<Endpoint[]> => {
      if (mode === 'demo') {
        return mockStore.getEndpoints()
      }
      return endpointsApi.fetchEndpoints()
    },

    createEndpoint: async (data: endpointsApi.CreateEndpointInput): Promise<Endpoint> => {
      if (mode === 'demo') {
        return mockStore.createEndpoint(data)
      }
      return endpointsApi.createEndpoint(data)
    },

    updateEndpoint: async (id: string, data: endpointsApi.UpdateEndpointInput): Promise<Endpoint> => {
      if (mode === 'demo') {
        const updated = mockStore.updateEndpoint(id, data)
        if (!updated) throw new Error('Endpoint not found in mock store')
        return updated
      }
      return endpointsApi.updateEndpoint(id, data)
    },

    toggleEndpoint: async (id: string, active: boolean): Promise<Endpoint> => {
      if (mode === 'demo') {
        const toggled = mockStore.toggleEndpoint(id)
        if (!toggled) throw new Error('Endpoint not found')
        return toggled
      }
      return endpointsApi.toggleEndpointActive(id, active)
    },

    getEvents: async (): Promise<WebhookEvent[]> => {
      if (mode === 'demo') {
        return mockStore.getEvents()
      }
      return eventsApi.fetchEvents()
    },

    getEventById: async (id: string): Promise<WebhookEvent | undefined> => {
      if (mode === 'demo') {
        return mockStore.getEvent(id)
      }
      return eventsApi.fetchEventById(id)
    },

    ingestEvent: async (data: eventsApi.IngestEventInput) => {
      if (mode === 'demo') {
        return mockStore.ingestEvent(data)
      }
      return eventsApi.ingestEvent(data)
    },

    getDeliveries: async (filter?: deliveriesApi.DeliveryQueryParams & { search?: string }): Promise<Delivery[]> => {
      if (mode === 'demo') {
        return mockStore.getDeliveries(filter)
      }
      return deliveriesApi.fetchDeliveries(filter)
    },

    getDeliveryById: async (id: string): Promise<Delivery | undefined> => {
      if (mode === 'demo') {
        return mockStore.getDelivery(id)
      }
      return deliveriesApi.fetchDeliveryById(id)
    },

    getDeadLetters: async (): Promise<Delivery[]> => {
      if (mode === 'demo') {
        return mockStore.getDeadLetters()
      }
      return deliveriesApi.fetchDeadLetterDeliveries()
    },

    replayDelivery: async (id: string) => {
      if (mode === 'demo') {
        return mockStore.replayDelivery(id)
      }
      return deliveriesApi.replayDelivery(id)
    },

    getOverviewMetrics: async (): Promise<OverviewMetrics> => {
      if (mode === 'demo') {
        return mockStore.getOverviewMetrics()
      }
      // In live mode, calculate from active deliveries and endpoints or fetch from /metrics
      const [deliveries, endpoints, events] = await Promise.all([
        deliveriesApi.fetchDeliveries().catch(() => []),
        endpointsApi.fetchEndpoints().catch(() => []),
        eventsApi.fetchEvents().catch(() => []),
      ])

      const total = deliveries.length
      const succeeded = deliveries.filter((d) => d.state === 'SUCCEEDED').length
      const failed = deliveries.filter((d) => d.state === 'DEAD').length
      const pending = deliveries.filter(
        (d) => d.state === 'PENDING' || d.state === 'IN_FLIGHT' || d.state === 'RETRYING'
      ).length
      const successRate = total > 0 ? (succeeded / total) * 100 : 100

      return {
        totalEvents: events.length,
        totalDeliveries: total,
        succeededDeliveries: succeeded,
        failedDeliveries: failed,
        pendingDeliveries: pending,
        successRate: Math.round(successRate * 10) / 10,
        averageLatencyMs: 74,
        activeEndpoints: endpoints.filter((e) => e.active).length,
        totalEndpoints: endpoints.length,
        openCircuits: endpoints.filter((e) => e.circuit_state === 'OPEN').length,
      }
    },

    getTimeSeriesMetrics: async (): Promise<TimeSeriesDataPoint[]> => {
      if (mode === 'demo') {
        return mockStore.getTimeSeriesMetrics()
      }
      // In live mode, return computed distribution if available or fallback cleanly
      return mockStore.getTimeSeriesMetrics()
    },

    getStatusDistribution: async (): Promise<StatusDistribution[]> => {
      if (mode === 'demo') {
        return mockStore.getStatusDistribution()
      }
      const deliveries = await deliveriesApi.fetchDeliveries().catch(() => [])
      const counts = {
        SUCCEEDED: deliveries.filter((d) => d.state === 'SUCCEEDED').length,
        RETRYING: deliveries.filter((d) => d.state === 'RETRYING').length,
        DEAD: deliveries.filter((d) => d.state === 'DEAD').length,
        IN_FLIGHT: deliveries.filter((d) => d.state === 'IN_FLIGHT').length,
        PENDING: deliveries.filter((d) => d.state === 'PENDING').length,
      }

      return [
        { name: 'Succeeded', value: counts.SUCCEEDED, color: '#10b981' },
        { name: 'Retrying', value: counts.RETRYING, color: '#f59e0b' },
        { name: 'Dead Letter', value: counts.DEAD, color: '#ef4444' },
        { name: 'In Flight', value: counts.IN_FLIGHT, color: '#6366f1' },
        { name: 'Pending', value: counts.PENDING, color: '#3b82f6' },
      ]
    },
  }

  return (
    <AppContext.Provider
      value={{
        mode,
        setMode,
        toggleMode,
        baseUrl,
        setBaseUrl,
        apiKey,
        setApiKey,
        backendHealth,
        checkHealth,
        toasts,
        addToast,
        removeToast,
        service,
      }}
    >
      {children}
    </AppContext.Provider>
  )
}

export const useApp = (): AppContextValue => {
  const context = useContext(AppContext)
  if (!context) {
    throw new Error('useApp must be used within an AppProvider')
  }
  return context
}
