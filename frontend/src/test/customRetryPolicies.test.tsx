// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { apiClient } from '../api/client'
import {
  createEndpoint,
  updateEndpoint,
  normalizeEndpoint,
} from '../api/endpoints'
import { mockStore } from '../mocks/mockStore'
import { AppProvider } from '../context/AppContext'
import {
  RetryPolicyConfigForm,
  validateRetryPolicyForm,
  DEFAULT_RETRY_FORM_DATA,
} from '../components/RetryPolicyConfigForm'
import { CreateEndpointModal } from '../components/CreateEndpointModal'
import { EditEndpointModal } from '../components/EditEndpointModal'
import { EndpointDetailDrawer } from '../components/EndpointDetailDrawer'
import { EndpointsPage } from '../pages/EndpointsPage'
import type { Endpoint } from '../types'

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

describe('Phase 2, Task 3: Custom Retry Policies (Frontend)', () => {
  afterEach(() => {
    cleanup()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
  })

  describe('1. API Client Contracts & Normalization', () => {
    it('normalizeEndpoint defaults retry policy values when absent', () => {
      const raw = {
        id: 'e1',
        url: 'https://example.com/webhook',
        rate_limit_rps: 10,
      }
      const normalized = normalizeEndpoint(raw)
      expect(normalized.retryStrategy).toBe('EXPONENTIAL')
      expect(normalized.retry_strategy).toBe('EXPONENTIAL')
      expect(normalized.retryMaxAttempts).toBe(8)
      expect(normalized.retry_max_attempts).toBe(8)
      expect(normalized.retryBaseDelayMs).toBe(5000)
      expect(normalized.retry_base_delay_ms).toBe(5000)
      expect(normalized.retryMaxDelayMs).toBe(3600000)
      expect(normalized.retry_max_delay_ms).toBe(3600000)
      expect(normalized.retryBackoffMultiplier).toBe(2.0)
      expect(normalized.retry_backoff_multiplier).toBe(2.0)
      expect(normalized.retryPolicy).toEqual({
        strategy: 'EXPONENTIAL',
        maxAttempts: 8,
        baseDelayMs: 5000,
        maxDelayMs: 3600000,
        backoffMultiplier: 2.0,
      })
    })

    it('normalizeEndpoint parses snake_case and nested retryPolicy correctly', () => {
      const raw = {
        id: 'e2',
        url: 'https://example.com/webhook2',
        retry_strategy: 'FIXED',
        retry_max_attempts: 4,
        retry_base_delay_ms: 3000,
        retry_max_delay_ms: 3000,
        retry_backoff_multiplier: 1.0,
      }
      const normalized = normalizeEndpoint(raw)
      expect(normalized.retryStrategy).toBe('FIXED')
      expect(normalized.retryMaxAttempts).toBe(4)
      expect(normalized.retryBaseDelayMs).toBe(3000)
      expect(normalized.retryPolicy?.strategy).toBe('FIXED')
      expect(normalized.retryPolicy?.maxAttempts).toBe(4)
    })

    it('createEndpoint sends retry policy fields to backend API', async () => {
      const mockBackendResponse = {
        id: 'e-created-1',
        url: 'https://example.com/new-hook',
        retry_strategy: 'EXPONENTIAL',
        retry_max_attempts: 12,
        retry_base_delay_ms: 2000,
        retry_max_delay_ms: 600000,
        retry_backoff_multiplier: 1.5,
      }
      vi.mocked(apiClient.post).mockResolvedValueOnce(mockBackendResponse)

      const result = await createEndpoint({
        url: 'https://example.com/new-hook',
        rate_limit_rps: 20,
        retryStrategy: 'EXPONENTIAL',
        retryMaxAttempts: 12,
        retryBaseDelayMs: 2000,
        retryMaxDelayMs: 600000,
        retryBackoffMultiplier: 1.5,
      })

      expect(apiClient.post).toHaveBeenCalledWith(
        '/endpoints',
        expect.objectContaining({
          url: 'https://example.com/new-hook',
          rate_limit_rps: 20,
          retryStrategy: 'EXPONENTIAL',
          retryMaxAttempts: 12,
          retryBaseDelayMs: 2000,
          retryMaxDelayMs: 600000,
          retryBackoffMultiplier: 1.5,
        })
      )
      expect(result.retryMaxAttempts).toBe(12)
    })

    it('updateEndpoint sends retry policy updates to /endpoints/:id', async () => {
      const mockBackendResponse = {
        id: 'e-updated-1',
        url: 'https://example.com/existing-hook',
        retry_strategy: 'FIXED',
        retry_max_attempts: 5,
        retry_base_delay_ms: 4000,
      }
      vi.mocked(apiClient.patch).mockResolvedValueOnce(mockBackendResponse)

      const result = await updateEndpoint('e-updated-1', {
        retryStrategy: 'FIXED',
        retryMaxAttempts: 5,
        retryBaseDelayMs: 4000,
      })

      expect(apiClient.patch).toHaveBeenCalledWith(
        '/endpoints/e-updated-1',
        expect.objectContaining({
          retryStrategy: 'FIXED',
          retryMaxAttempts: 5,
          retryBaseDelayMs: 4000,
        })
      )
      expect(result.retryStrategy).toBe('FIXED')
    })
  })

  describe('2. Retry Policy Form Validation Logic', () => {
    it('accepts valid exponential policy values', () => {
      const result = validateRetryPolicyForm({
        retryStrategy: 'EXPONENTIAL',
        retryMaxAttempts: '10',
        retryBaseDelayMs: '1000',
        retryMaxDelayMs: '60000',
        retryBackoffMultiplier: '2.5',
      })
      expect(result.isValid).toBe(true)
      expect(result.cleanValues).toEqual({
        retryStrategy: 'EXPONENTIAL',
        retryMaxAttempts: 10,
        retryBaseDelayMs: 1000,
        retryMaxDelayMs: 60000,
        retryBackoffMultiplier: 2.5,
      })
    })

    it('accepts valid fixed policy values', () => {
      const result = validateRetryPolicyForm({
        retryStrategy: 'FIXED',
        retryMaxAttempts: '5',
        retryBaseDelayMs: '3000',
        retryMaxDelayMs: '',
        retryBackoffMultiplier: '',
      })
      expect(result.isValid).toBe(true)
      expect(result.cleanValues.retryStrategy).toBe('FIXED')
      expect(result.cleanValues.retryMaxAttempts).toBe(5)
      expect(result.cleanValues.retryBaseDelayMs).toBe(3000)
    })

    it('rejects out-of-range attempts (< 1 or > 50)', () => {
      const under = validateRetryPolicyForm({
        ...DEFAULT_RETRY_FORM_DATA,
        retryMaxAttempts: '0',
      })
      expect(under.isValid).toBe(false)
      expect(under.errors.retryMaxAttempts).toBeDefined()

      const over = validateRetryPolicyForm({
        ...DEFAULT_RETRY_FORM_DATA,
        retryMaxAttempts: '51',
      })
      expect(over.isValid).toBe(false)
      expect(over.errors.retryMaxAttempts).toBeDefined()
    })

    it('rejects base delay less than 100 ms', () => {
      const result = validateRetryPolicyForm({
        ...DEFAULT_RETRY_FORM_DATA,
        retryBaseDelayMs: '50',
      })
      expect(result.isValid).toBe(false)
      expect(result.errors.retryBaseDelayMs).toBeDefined()
    })

    it('rejects max delay less than base delay in exponential mode', () => {
      const result = validateRetryPolicyForm({
        retryStrategy: 'EXPONENTIAL',
        retryMaxAttempts: '8',
        retryBaseDelayMs: '10000',
        retryMaxDelayMs: '5000',
        retryBackoffMultiplier: '2.0',
      })
      expect(result.isValid).toBe(false)
      expect(result.errors.retryMaxDelayMs).toContain('greater than or equal to base delay')
    })

    it('rejects multiplier out of range (< 1.0 or > 10.0)', () => {
      const low = validateRetryPolicyForm({
        ...DEFAULT_RETRY_FORM_DATA,
        retryBackoffMultiplier: '0.8',
      })
      expect(low.isValid).toBe(false)
      expect(low.errors.retryBackoffMultiplier).toBeDefined()

      const high = validateRetryPolicyForm({
        ...DEFAULT_RETRY_FORM_DATA,
        retryBackoffMultiplier: '12.0',
      })
      expect(high.isValid).toBe(false)
      expect(high.errors.retryBackoffMultiplier).toBeDefined()
    })
  })

  describe('3. RetryPolicyConfigForm Component UI', () => {
    it('renders strategy buttons and controls for exponential mode', () => {
      const onChange = vi.fn()
      render(
        <RetryPolicyConfigForm
          values={DEFAULT_RETRY_FORM_DATA}
          errors={{}}
          onChange={onChange}
        />
      )

      expect(screen.getByText('Custom Retry Policy')).toBeDefined()
      expect(screen.getByText('Exponential Backoff')).toBeDefined()
      expect(screen.getByText('Fixed Delay')).toBeDefined()
      expect(screen.getByTestId('retry-max-attempts')).toBeDefined()
      expect(screen.getByTestId('retry-base-delay')).toBeDefined()
      expect(screen.getByTestId('retry-max-delay')).toBeDefined()
      expect(screen.getByTestId('retry-multiplier')).toBeDefined()
      expect(screen.getByTestId('retry-schedule-preview')).toBeDefined()
    })

    it('hides max delay and multiplier controls when FIXED strategy is active', () => {
      const onChange = vi.fn()
      render(
        <RetryPolicyConfigForm
          values={{
            retryStrategy: 'FIXED',
            retryMaxAttempts: '4',
            retryBaseDelayMs: '2000',
            retryMaxDelayMs: '2000',
            retryBackoffMultiplier: '1.0',
          }}
          errors={{}}
          onChange={onChange}
        />
      )

      expect(screen.getByTestId('retry-max-attempts')).toBeDefined()
      expect(screen.getByTestId('retry-base-delay')).toBeDefined()
      expect(screen.queryByTestId('retry-max-delay')).toBeNull()
      expect(screen.queryByTestId('retry-multiplier')).toBeNull()
    })

    it('triggers onChange when switching strategy', () => {
      const onChange = vi.fn()
      render(
        <RetryPolicyConfigForm
          values={DEFAULT_RETRY_FORM_DATA}
          errors={{}}
          onChange={onChange}
        />
      )

      const fixedBtn = screen.getByTestId('strategy-fixed-btn')
      fireEvent.click(fixedBtn)
      expect(onChange).toHaveBeenCalledWith('retryStrategy', 'FIXED')
    })
  })

  describe('4. CreateEndpointModal with Retry Policy', () => {
    it('creates endpoint with custom retry policy', async () => {
      const onSuccess = vi.fn()
      render(
        <AppProvider>
          <CreateEndpointModal isOpen={true} onClose={() => {}} onSuccess={onSuccess} />
        </AppProvider>
      )

      // Fill in URL
      const urlInput = screen.getByLabelText(/Destination URL/i)
      fireEvent.change(urlInput, { target: { value: 'https://webhook.customer.org/events' } })

      // Change retry attempts
      const attemptsInput = screen.getByLabelText(/Maximum Retry Attempts/i)
      fireEvent.change(attemptsInput, { target: { value: '15' } })

      // Submit
      const submitBtn = screen.getByRole('button', { name: /Create Endpoint/i })
      fireEvent.click(submitBtn)

      await waitFor(() => {
        expect(screen.getByText(/Signing Secret Generated/i)).toBeDefined()
      })
    })

    it('displays validation errors when retry attempts are invalid', async () => {
      render(
        <AppProvider>
          <CreateEndpointModal isOpen={true} onClose={() => {}} onSuccess={() => {}} />
        </AppProvider>
      )

      const urlInput = screen.getByLabelText(/Destination URL/i)
      fireEvent.change(urlInput, { target: { value: 'https://webhook.customer.org/events' } })

      const attemptsInput = screen.getByLabelText(/Maximum Retry Attempts/i)
      fireEvent.change(attemptsInput, { target: { value: '99' } })

      const submitBtn = screen.getByRole('button', { name: /Create Endpoint/i })
      fireEvent.click(submitBtn)

      await waitFor(() => {
        expect(screen.getByText(/Maximum retry attempts must be between 1 and 50/i)).toBeDefined()
      })
    })
  })

  describe('5. EditEndpointModal & EndpointDetailDrawer', () => {
    const mockEndpoint: Endpoint = {
      id: 'ep-test-drawer-1',
      tenant_id: 't1',
      url: 'https://api.payments.com/receiver',
      active: true,
      rate_limit_rps: 30,
      next_seq: 10,
      circuit_state: 'CLOSED',
      circuit_until: null,
      consecutive_failures: 0,
      created_at: new Date().toISOString(),
      description: 'Payments receiver endpoint',
      retry_strategy: 'EXPONENTIAL',
      retryStrategy: 'EXPONENTIAL',
      retry_max_attempts: 12,
      retryMaxAttempts: 12,
      retry_base_delay_ms: 1000,
      retryBaseDelayMs: 1000,
      retry_max_delay_ms: 300000,
      retryMaxDelayMs: 300000,
      retry_backoff_multiplier: 1.8,
      retryBackoffMultiplier: 1.8,
      retryPolicy: {
        strategy: 'EXPONENTIAL',
        maxAttempts: 12,
        baseDelayMs: 1000,
        maxDelayMs: 300000,
        backoffMultiplier: 1.8,
      },
    }

    it('renders detail drawer with full retry policy breakdown', () => {
      const onEdit = vi.fn()
      const onTest = vi.fn()
      const onToggle = vi.fn()

      render(
        <EndpointDetailDrawer
          isOpen={true}
          onClose={() => {}}
          endpoint={mockEndpoint}
          onEdit={onEdit}
          onTest={onTest}
          onToggle={onToggle}
        />
      )

      expect(screen.getByText('Configured Retry Policy')).toBeDefined()
      expect(screen.getAllByText(/12/).length).toBeGreaterThan(0)
      expect(screen.getByText(/1[,0]+ ms/)).toBeDefined()
      expect(screen.getByText(/300[,0]+ ms/)).toBeDefined()
      expect(screen.getByText('1.8x')).toBeDefined()
      expect(screen.getByText('Delivery Behavior Summary')).toBeDefined()
    })

    it('pre-populates edit modal and allows updating retry policy', async () => {
      const liveEndpoint = mockStore.createEndpoint({
        url: 'https://api.payments.com/receiver',
        rate_limit_rps: 30,
        retryStrategy: 'EXPONENTIAL',
        retryMaxAttempts: 12,
        retryBaseDelayMs: 1000,
        retryMaxDelayMs: 300000,
        retryBackoffMultiplier: 1.8,
      })

      const onSuccess = vi.fn()
      render(
        <AppProvider>
          <EditEndpointModal
            isOpen={true}
            onClose={() => {}}
            endpoint={liveEndpoint}
            onSuccess={onSuccess}
          />
        </AppProvider>
      )

      expect(screen.getByDisplayValue('https://api.payments.com/receiver')).toBeDefined()
      const attemptsInput = screen.getByDisplayValue('12')
      expect(attemptsInput).toBeDefined()

      // Change strategy to FIXED
      const fixedBtn = screen.getByTestId('strategy-fixed-btn')
      fireEvent.click(fixedBtn)

      // Change attempts to 6
      fireEvent.change(attemptsInput, { target: { value: '6' } })

      // Save
      const saveBtn = screen.getByRole('button', { name: /Save Changes/i })
      fireEvent.click(saveBtn)

      await waitFor(() => {
        expect(onSuccess).toHaveBeenCalledWith(
          expect.objectContaining({
            retryStrategy: 'FIXED',
            retryMaxAttempts: 6,
          })
        )
      })
    })
  })

  describe('6. EndpointsPage Integration', () => {
    it('displays Retry Policy column in table', async () => {
      render(
        <MemoryRouter>
          <AppProvider>
            <EndpointsPage />
          </AppProvider>
        </MemoryRouter>
      )

      await waitFor(() => {
        expect(screen.getByText('Retry Policy')).toBeDefined()
      })

      // Multiple endpoints should have retry badges
      const expBadges = screen.getAllByText('Exponential')
      expect(expBadges.length).toBeGreaterThan(0)
    })

    it('opens Edit modal when clicking Edit action button', async () => {
      render(
        <MemoryRouter>
          <AppProvider>
            <EndpointsPage />
          </AppProvider>
        </MemoryRouter>
      )

      await waitFor(() => {
        expect(screen.getAllByRole('button', { name: /Edit/i })[0]).toBeDefined()
      })

      const editBtn = screen.getAllByRole('button', { name: /Edit/i })[0]
      fireEvent.click(editBtn)

      await waitFor(() => {
        expect(screen.getByText('Edit Endpoint & Retry Policy')).toBeDefined()
      })
    })

    it('opens Detail drawer when clicking endpoint destination link', async () => {
      render(
        <MemoryRouter>
          <AppProvider>
            <EndpointsPage />
          </AppProvider>
        </MemoryRouter>
      )

      await waitFor(() => {
        expect(screen.getByText('https://api.acmepayments.com/webhooks/v1')).toBeDefined()
      })

      const epLink = screen.getByText('https://api.acmepayments.com/webhooks/v1')
      fireEvent.click(epLink)

      await waitFor(() => {
        expect(screen.getByText('Endpoint Details')).toBeDefined()
        expect(screen.getByText('Configured Retry Policy')).toBeDefined()
      })
    })
  })

  describe('7. MockStore Persistence', () => {
    it('persists custom retry policy upon endpoint creation and updates', () => {
      const ep = mockStore.createEndpoint({
        url: 'https://retry-test.com/hook',
        retryStrategy: 'FIXED',
        retryMaxAttempts: 7,
        retryBaseDelayMs: 2500,
        retryMaxDelayMs: 2500,
        retryBackoffMultiplier: 1.0,
      })

      expect(ep.retryStrategy).toBe('FIXED')
      expect(ep.retryMaxAttempts).toBe(7)
      expect(ep.retryBaseDelayMs).toBe(2500)
      expect(ep.retryPolicy?.strategy).toBe('FIXED')

      const updated = mockStore.updateEndpoint(ep.id, {
        retryStrategy: 'EXPONENTIAL',
        retryMaxAttempts: 14,
        retryBaseDelayMs: 1000,
        retryMaxDelayMs: 60000,
        retryBackoffMultiplier: 2.5,
      })

      expect(updated?.retryStrategy).toBe('EXPONENTIAL')
      expect(updated?.retryMaxAttempts).toBe(14)
      expect(updated?.retryBackoffMultiplier).toBe(2.5)
      expect(updated?.retryPolicy?.backoffMultiplier).toBe(2.5)
    })
  })
})
