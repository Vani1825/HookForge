import React, { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react'
import { checkBackendHealth } from '../api/health'
import { mockStore } from '../mocks/mockStore'
import * as endpointsApi from '../api/endpoints'
import * as eventsApi from '../api/events'
import * as deliveriesApi from '../api/deliveries'
import * as metricsApi from '../api/metrics'
import * as templatesApi from '../api/templates'
import type {
  Endpoint,
  WebhookEvent,
  Delivery,
  OverviewMetrics,
  TimeSeriesDataPoint,
  StatusDistribution,
  ScheduleDeliveryInput,
  BulkReplayResult,
  EndpointTestResult,
  WebhookTemplate,
  CreateTemplateInput,
  UpdateTemplateInput,
  TemplateApplyResult,
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
    testEndpoint: (input: endpointsApi.EndpointTestInput) => Promise<EndpointTestResult>
    getEvents: (filter?: eventsApi.EventQueryParams) => Promise<deliveriesApi.PaginatedList<WebhookEvent>>
    getEventById: (id: string) => Promise<WebhookEvent | undefined>
    ingestEvent: (data: eventsApi.IngestEventInput) => Promise<{ duplicate: boolean; deliveriesEnqueued: number; eventId?: string }>
    getDeliveries: (filter?: deliveriesApi.DeliveryQueryParams & { search?: string }) => Promise<deliveriesApi.PaginatedList<Delivery>>
    getDeliveryById: (id: string) => Promise<Delivery | undefined>
    getDeadLetters: () => Promise<Delivery[]>
    replayDelivery: (id: string) => Promise<{ success: boolean; message: string; delivery?: Delivery }>
    scheduleDelivery: (data: ScheduleDeliveryInput) => Promise<Delivery>
    getScheduledDeliveries: (filter?: deliveriesApi.DeliveryQueryParams) => Promise<deliveriesApi.PaginatedList<Delivery>>
    getScheduledDeliveryById: (id: string) => Promise<Delivery | undefined>
    cancelScheduledDelivery: (id: string) => Promise<{ success: boolean; message: string; delivery?: Delivery }>
    bulkReplayDeliveries: (deliveryIds: string[]) => Promise<BulkReplayResult>
    getOverviewMetrics: (filter?: metricsApi.MetricsQueryParams | string) => Promise<OverviewMetrics>
    getTimeSeriesMetrics: (filter?: metricsApi.MetricsQueryParams | string) => Promise<TimeSeriesDataPoint[]>
    getStatusDistribution: (filter?: metricsApi.MetricsQueryParams | string) => Promise<StatusDistribution[]>
    getTemplates: (filter?: templatesApi.TemplateQueryParams) => Promise<WebhookTemplate[]>
    getTemplateById: (id: string) => Promise<WebhookTemplate | undefined>
    createTemplate: (data: CreateTemplateInput) => Promise<WebhookTemplate>
    updateTemplate: (id: string, data: UpdateTemplateInput) => Promise<WebhookTemplate>
    deleteTemplate: (id: string) => Promise<{ success: boolean; id: string; message: string }>
    applyTemplate: (id: string, overrides?: Record<string, unknown>) => Promise<TemplateApplyResult>
    createEndpointFromTemplate: (id: string, overrides?: Record<string, unknown>) => Promise<Endpoint>
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
    const saved = localStorage.getItem(STORAGE_KEY_BASE_URL)
    if (saved && saved.trim()) return saved.trim()
    return import.meta.env.VITE_API_BASE_URL || 'http://localhost:8081'
  })

  const [apiKey, setApiKeyState] = useState<string>(() => {
    const saved = localStorage.getItem(STORAGE_KEY_API_KEY)
    if (saved && saved.trim()) return saved.trim()
    return import.meta.env.VITE_API_KEY || ''
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

    testEndpoint: async (input: endpointsApi.EndpointTestInput): Promise<EndpointTestResult> => {
      if (mode === 'demo') {
        return mockStore.testEndpoint(input)
      }
      return endpointsApi.testEndpoint(input)
    },

    getEvents: async (filter?: eventsApi.EventQueryParams): Promise<deliveriesApi.PaginatedList<WebhookEvent>> => {
      if (mode === 'demo') {
        return mockStore.getEvents(filter)
      }
      return eventsApi.fetchEvents(filter)
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

    getDeliveries: async (filter?: deliveriesApi.DeliveryQueryParams & { search?: string }): Promise<deliveriesApi.PaginatedList<Delivery>> => {
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

    scheduleDelivery: async (data: ScheduleDeliveryInput): Promise<Delivery> => {
      if (mode === 'demo') {
        return mockStore.scheduleDelivery(data)
      }
      return deliveriesApi.scheduleDelivery(data)
    },

    getScheduledDeliveries: async (filter?: deliveriesApi.DeliveryQueryParams): Promise<deliveriesApi.PaginatedList<Delivery>> => {
      if (mode === 'demo') {
        return mockStore.getScheduledDeliveries(filter)
      }
      return deliveriesApi.fetchScheduledDeliveries(filter)
    },

    getScheduledDeliveryById: async (id: string): Promise<Delivery | undefined> => {
      if (mode === 'demo') {
        return mockStore.getDelivery(id)
      }
      return deliveriesApi.fetchScheduledDeliveryById(id)
    },

    cancelScheduledDelivery: async (id: string) => {
      if (mode === 'demo') {
        return mockStore.cancelScheduledDelivery(id)
      }
      return deliveriesApi.cancelScheduledDelivery(id)
    },

    bulkReplayDeliveries: async (deliveryIds: string[]) => {
      if (mode === 'demo') {
        return mockStore.bulkReplayDeliveries(deliveryIds)
      }
      return deliveriesApi.bulkReplayDeliveries(deliveryIds)
    },

    getOverviewMetrics: async (filter?: metricsApi.MetricsQueryParams | string): Promise<OverviewMetrics> => {
      const normalized = typeof filter === 'string' ? { range: filter } : filter
      if (mode === 'demo') {
        return mockStore.getOverviewMetrics(normalized)
      }
      return metricsApi.fetchOverviewMetrics(normalized)
    },

    getTimeSeriesMetrics: async (filter?: metricsApi.MetricsQueryParams | string): Promise<TimeSeriesDataPoint[]> => {
      const normalized = typeof filter === 'string' ? { range: filter } : filter
      if (mode === 'demo') {
        return mockStore.getTimeSeriesMetrics(normalized)
      }
      return metricsApi.fetchTimeSeriesMetrics(normalized)
    },

    getStatusDistribution: async (filter?: metricsApi.MetricsQueryParams | string): Promise<StatusDistribution[]> => {
      const normalized = typeof filter === 'string' ? { range: filter } : filter
      if (mode === 'demo') {
        return mockStore.getStatusDistribution(normalized)
      }
      return metricsApi.fetchStatusDistribution(normalized)
    },

    getTemplates: async (filter?: templatesApi.TemplateQueryParams): Promise<WebhookTemplate[]> => {
      if (mode === 'demo') {
        return mockStore.getTemplates(filter)
      }
      return templatesApi.fetchTemplates(filter)
    },

    getTemplateById: async (id: string): Promise<WebhookTemplate | undefined> => {
      if (mode === 'demo') {
        return mockStore.getTemplate(id)
      }
      return templatesApi.fetchTemplateById(id)
    },

    createTemplate: async (data: CreateTemplateInput): Promise<WebhookTemplate> => {
      if (mode === 'demo') {
        return mockStore.createTemplate(data)
      }
      return templatesApi.createTemplate(data)
    },

    updateTemplate: async (id: string, data: UpdateTemplateInput): Promise<WebhookTemplate> => {
      if (mode === 'demo') {
        const updated = mockStore.updateTemplate(id, data)
        if (!updated) throw new Error('Template not found')
        return updated
      }
      return templatesApi.updateTemplate(id, data)
    },

    deleteTemplate: async (id: string): Promise<{ success: boolean; id: string; message: string }> => {
      if (mode === 'demo') {
        const res = mockStore.deleteTemplate(id)
        if (!res) throw new Error('Template not found')
        return res
      }
      return templatesApi.deleteTemplate(id)
    },

    applyTemplate: async (id: string, overrides?: Record<string, unknown>): Promise<TemplateApplyResult> => {
      if (mode === 'demo') {
        return mockStore.applyTemplate(id, overrides)
      }
      return templatesApi.applyTemplate(id, overrides)
    },

    createEndpointFromTemplate: async (id: string, overrides?: Record<string, unknown>): Promise<Endpoint> => {
      if (mode === 'demo') {
        return mockStore.createEndpointFromTemplate(id, overrides)
      }
      return templatesApi.createEndpointFromTemplate(id, overrides)
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
