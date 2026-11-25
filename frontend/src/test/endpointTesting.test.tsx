// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { apiClient } from '../api/client'
import { testEndpoint, testEndpointById, normalizeTestResult } from '../api/endpoints'
import { mockStore } from '../mocks/mockStore'
import { AppProvider } from '../context/AppContext'
import { EndpointTestingPage } from '../pages/EndpointTestingPage'
import { EndpointTestModal } from '../components/EndpointTestModal'
import { EndpointsPage } from '../pages/EndpointsPage'

vi.mock('../api/client', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
  formatErrorMessage: (err: any) =>
    err?.response?.data?.message || err?.message || 'Network Error',
}))

describe('Phase 2, Task 2: Endpoint Testing (Frontend)', () => {
  afterEach(() => {
    cleanup()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
  })

  describe('1. API Client Contracts & Normalization', () => {
    it('testEndpoint sends POST to /endpoints/:id/test when endpointId is provided', async () => {
      const mockRawResponse = {
        success: true,
        statusCode: 200,
        status_code: 200,
        latencyMs: 42,
        latency_ms: 42,
        error: null,
        request: {
          url: 'https://example.com/webhook',
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          payload: { test: true },
        },
        response: {
          statusCode: 200,
          status_code: 200,
          headers: { 'content-type': 'application/json' },
          body: '{"status":"ok"}',
          sizeBytes: 15,
          size_bytes: 15,
          truncated: false,
        },
        testedAt: '2026-11-20T12:00:00.000Z',
      }

      vi.mocked(apiClient.post).mockResolvedValue(mockRawResponse)

      const result = await testEndpoint({
        endpointId: 'ep-123',
        method: 'POST',
        headers: { 'X-Custom': 'val' },
        payload: { test: true },
      })

      expect(apiClient.post).toHaveBeenCalledWith(
        '/endpoints/ep-123/test',
        expect.objectContaining({
          endpointId: 'ep-123',
          method: 'POST',
          headers: { 'X-Custom': 'val' },
          payload: { test: true },
        })
      )
      expect(result.success).toBe(true)
      expect(result.statusCode).toBe(200)
      expect(result.latencyMs).toBe(42)
      expect(result.response?.body).toBe('{"status":"ok"}')
    })

    it('testEndpoint sends POST to /endpoints/test when testing ad-hoc URL', async () => {
      const mockRawResponse = {
        success: true,
        statusCode: 201,
        latencyMs: 55,
        error: null,
        request: {
          url: 'https://webhook.site/test-uuid',
          method: 'PUT',
          headers: {},
          payload: null,
        },
        response: {
          statusCode: 201,
          headers: {},
          body: 'Created',
          sizeBytes: 7,
          truncated: false,
        },
        testedAt: '2026-11-20T12:00:00.000Z',
      }

      vi.mocked(apiClient.post).mockResolvedValue(mockRawResponse)

      const result = await testEndpoint({
        url: 'https://webhook.site/test-uuid',
        method: 'PUT',
      })

      expect(apiClient.post).toHaveBeenCalledWith(
        '/endpoints/test',
        expect.objectContaining({
          url: 'https://webhook.site/test-uuid',
          method: 'PUT',
        })
      )
      expect(result.success).toBe(true)
      expect(result.statusCode).toBe(201)
      expect(result.request.method).toBe('PUT')
    })

    it('testEndpointById delegates to testEndpoint with endpointId', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({
        success: true,
        statusCode: 200,
        latencyMs: 30,
        request: { url: 'https://example.com', method: 'GET', headers: {}, payload: null },
        response: null,
      })

      const res = await testEndpointById('ep-999', { method: 'GET' })
      expect(apiClient.post).toHaveBeenCalledWith(
        '/endpoints/ep-999/test',
        expect.objectContaining({ endpointId: 'ep-999', method: 'GET' })
      )
      expect(res.success).toBe(true)
    })

    it('normalizeTestResult correctly handles snake_case and null responses', () => {
      const normalized = normalizeTestResult({
        success: false,
        status_code: 504,
        latency_ms: 10000,
        error: 'Gateway Timeout',
        request: { url: 'https://timeout.com', method: 'post' },
        response: null,
        tested_at: '2026-11-20T12:00:00.000Z',
      })

      expect(normalized.success).toBe(false)
      expect(normalized.statusCode).toBe(504)
      expect(normalized.latencyMs).toBe(10000)
      expect(normalized.error).toBe('Gateway Timeout')
      expect(normalized.request.method).toBe('POST')
      expect(normalized.response).toBeNull()
    })
  })

  describe('2. MockStore Offline Simulation', () => {
    it('simulates 200 OK probe in demo mode with response headers and payload', () => {
      const result = mockStore.testEndpoint({
        url: 'https://partner.example.com/webhook',
        method: 'POST',
        payload: { greeting: 'hello' },
      })

      expect(result.success).toBe(true)
      expect(result.statusCode).toBe(200)
      expect(result.latencyMs).toBeGreaterThan(0)
      expect(result.response?.body).toContain('received')
      expect(result.response?.headers['content-type']).toBe('application/json')
      expect(result.request.headers['X-HookForge-Test']).toBe('true')
    })

    it('simulates timeout and error outcomes based on test destination keywords', () => {
      const timeoutRes = mockStore.testEndpoint({
        url: 'https://timeout.example.com/slow',
        method: 'POST',
      })
      expect(timeoutRes.success).toBe(false)
      expect(timeoutRes.statusCode).toBeNull()
      expect(timeoutRes.error).toBe('Timeout')
      expect(timeoutRes.response).toBeNull()

      const errorRes = mockStore.testEndpoint({
        url: 'https://fail.example.com/webhook',
        method: 'POST',
      })
      expect(errorRes.success).toBe(false)
      expect(errorRes.statusCode).toBe(500)
      expect(errorRes.response?.body).toContain('Internal Server Error')
    })
  })

  describe('3. EndpointTestingPage Component', () => {
    it('renders workbench with target selection, method buttons, and empty state', async () => {
      render(
        <AppProvider>
          <MemoryRouter initialEntries={['/endpoint-testing']}>
            <EndpointTestingPage />
          </MemoryRouter>
        </AppProvider>
      )

      await waitFor(() => {
        expect(screen.getByText('Endpoint Testing')).toBeDefined()
        expect(screen.getByText('Target Destination')).toBeDefined()
        expect(screen.getByText('HTTP Method')).toBeDefined()
        expect(screen.getByText('No Test Executed Yet')).toBeDefined()
        expect(screen.getByRole('button', { name: /Run Test Probe/i })).toBeDefined()
      })
    })

    it('allows toggling between Saved Endpoint and Custom URL modes', async () => {
      render(
        <AppProvider>
          <MemoryRouter initialEntries={['/endpoint-testing']}>
            <EndpointTestingPage />
          </MemoryRouter>
        </AppProvider>
      )

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Custom URL/i })).toBeDefined()
      })

      const customUrlBtn = screen.getByRole('button', { name: /Custom URL/i })
      fireEvent.click(customUrlBtn)

      expect(screen.getByPlaceholderText(/https:\/\/webhook\.site/i)).toBeDefined()
      expect(screen.getByPlaceholderText(/whsec_\.\.\./i)).toBeDefined()

      const savedBtn = screen.getByRole('button', { name: /Saved Endpoint/i })
      fireEvent.click(savedBtn)

      expect(screen.getByText(/Select Endpoint/i)).toBeDefined()
    })

    it('allows changing HTTP methods and hides payload editor on GET or HEAD', async () => {
      render(
        <AppProvider>
          <MemoryRouter initialEntries={['/endpoint-testing']}>
            <EndpointTestingPage />
          </MemoryRouter>
        </AppProvider>
      )

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'GET' })).toBeDefined()
      })

      // Click GET method
      const getMethodBtn = screen.getByRole('button', { name: 'GET' })
      fireEvent.click(getMethodBtn)

      expect(
        screen.getByText(/GET requests do not carry a request body/i)
      ).toBeDefined()

      // Switch back to POST
      const postMethodBtn = screen.getByRole('button', { name: 'POST' })
      fireEvent.click(postMethodBtn)

      expect(screen.getByText(/Edit JSON body to dispatch/i)).toBeDefined()
    })

    it('validates JSON payload format and displays error notice for invalid syntax', async () => {
      render(
        <AppProvider>
          <MemoryRouter initialEntries={['/endpoint-testing']}>
            <EndpointTestingPage />
          </MemoryRouter>
        </AppProvider>
      )

      await waitFor(() => {
        expect(screen.getByLabelText(/JSON Payload Textarea/i)).toBeDefined()
      })

      const textarea = screen.getByLabelText(/JSON Payload Textarea/i)
      fireEvent.change(textarea, { target: { value: '{ invalid_json: ' } })

      expect(screen.getByText(/Invalid JSON/i)).toBeDefined()
      const submitBtn = screen.getByRole('button', { name: /Run Test Probe/i }) as HTMLButtonElement
      expect(submitBtn.disabled).toBe(true)
    })

    it('allows adding and removing custom headers', async () => {
      render(
        <AppProvider>
          <MemoryRouter initialEntries={['/endpoint-testing']}>
            <EndpointTestingPage />
          </MemoryRouter>
        </AppProvider>
      )

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Headers/i })).toBeDefined()
      })

      const headersTab = screen.getByRole('button', { name: /Headers/i })
      fireEvent.click(headersTab)

      const addHeaderBtn = screen.getByRole('button', { name: /Add Header/i })
      fireEvent.click(addHeaderBtn)

      const keyInputs = screen.getAllByPlaceholderText('Header Name')
      expect(keyInputs.length).toBeGreaterThanOrEqual(2)

      const removeBtns = screen.getAllByTitle('Remove header')
      fireEvent.click(removeBtns[removeBtns.length - 1])

      const keyInputsAfter = screen.getAllByPlaceholderText('Header Name')
      expect(keyInputsAfter.length).toBe(keyInputs.length - 1)
    })

    it('executes successful test probe and displays HTTP 200, latency, and response tabs', async () => {
      render(
        <AppProvider>
          <MemoryRouter initialEntries={['/endpoint-testing']}>
            <EndpointTestingPage />
          </MemoryRouter>
        </AppProvider>
      )

      // Wait for mock endpoints to load and populate selectedEndpoint
      await waitFor(() => {
        expect(screen.getByText(/Active/i)).toBeDefined()
      })

      const submitBtn = screen.getByRole('button', { name: /Run Test Probe/i })
      fireEvent.click(submitBtn)

      await waitFor(() => {
        expect(screen.getByText(/HTTP 200/i)).toBeDefined()
        expect(screen.getAllByText(/Success/i).length).toBeGreaterThan(0)
        expect(screen.getAllByText(/Response Body/i).length).toBeGreaterThan(0)
        expect(screen.getByText(/Response Headers/i)).toBeDefined()
        expect(screen.getByText(/Request Dispatched/i)).toBeDefined()
      })
    })

    it('displays error details when test returns non-2xx status code', async () => {
      render(
        <AppProvider>
          <MemoryRouter initialEntries={['/endpoint-testing']}>
            <EndpointTestingPage />
          </MemoryRouter>
        </AppProvider>
      )

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Custom URL/i })).toBeDefined()
      })

      // Switch to Custom URL and enter a failing destination
      const customUrlBtn = screen.getByRole('button', { name: /Custom URL/i })
      fireEvent.click(customUrlBtn)

      const urlInput = screen.getByPlaceholderText(/https:\/\/webhook\.site/i)
      fireEvent.change(urlInput, { target: { value: 'https://fail.example.com/webhook' } })

      const submitBtn = screen.getByRole('button', { name: /Run Test Probe/i })
      fireEvent.click(submitBtn)

      await waitFor(() => {
        expect(screen.getByText(/HTTP 500/i)).toBeDefined()
        expect(screen.getByText(/Non-2xx Response/i)).toBeDefined()
      })
    })
  })

  describe('4. EndpointTestModal Component', () => {
    it('renders modal with preselected endpoint and runs test', async () => {
      const mockEndpoint = {
        id: 'ep-test-modal',
        tenant_id: 'tenant-1',
        url: 'https://modal.example.com/hook',
        active: true,
        rate_limit_rps: 15,
        circuit_state: 'CLOSED' as const,
        consecutive_failures: 0,
        created_at: new Date().toISOString(),
      }

      render(
        <AppProvider>
          <MemoryRouter>
            <EndpointTestModal
              isOpen={true}
              onClose={vi.fn()}
              endpoint={mockEndpoint}
            />
          </MemoryRouter>
        </AppProvider>
      )

      expect(screen.getByText('Test Webhook Endpoint')).toBeDefined()
      expect(screen.getByText('https://modal.example.com/hook')).toBeDefined()

      const runBtn = screen.getByRole('button', { name: /Run Test/i })
      fireEvent.click(runBtn)

      await waitFor(() => {
        expect(screen.getByText(/HTTP 200/i)).toBeDefined()
      })
    })
  })

  describe('5. EndpointsPage Integration', () => {
    it('renders Testing Console button in header and Test action on endpoint rows', async () => {
      render(
        <AppProvider>
          <MemoryRouter>
            <EndpointsPage />
          </MemoryRouter>
        </AppProvider>
      )

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Testing Console/i })).toBeDefined()
        const testButtons = screen.getAllByRole('button', { name: /Test/i })
        expect(testButtons.length).toBeGreaterThan(0)
      })
    })
  })
})
