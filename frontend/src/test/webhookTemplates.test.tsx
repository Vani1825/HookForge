// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { apiClient } from '../api/client'
import {
  fetchTemplates,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  applyTemplate,
  createEndpointFromTemplate,
  normalizeTemplate,
} from '../api/templates'
import { mockStore } from '../mocks/mockStore'
import { AppProvider } from '../context/AppContext'
import { TemplateDetailDrawer } from '../components/TemplateDetailDrawer'
import { TemplateFormModal } from '../components/TemplateFormModal'
import { CreateEndpointModal } from '../components/CreateEndpointModal'
import { TemplatesPage } from '../pages/TemplatesPage'
import type { WebhookTemplate } from '../types'

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

const sampleSystemTemplate: WebhookTemplate = {
  id: '00000000-0000-4000-8000-000000000001',
  tenant_id: null,
  tenantId: null,
  name: 'Slack Incoming Webhook',
  description: 'Deliver notifications and alerts to Slack channels via incoming webhooks',
  http_method: 'POST',
  httpMethod: 'POST',
  url: 'https://hooks.slack.com/services/PLACEHOLDER',
  custom_headers: {
    'Content-Type': 'application/json',
    Authorization: '[REDACTED]',
  },
  customHeaders: {
    'Content-Type': 'application/json',
    Authorization: '[REDACTED]',
  },
  default_payload: { text: 'Slack Alert' },
  defaultPayload: { text: 'Slack Alert' },
  rate_limit_rps: 1,
  rateLimitRps: 1,
  retry_strategy: 'EXPONENTIAL',
  retryStrategy: 'EXPONENTIAL',
  retry_max_attempts: 8,
  retryMaxAttempts: 8,
  retry_base_delay_ms: 5000,
  retryBaseDelayMs: 5000,
  retry_max_delay_ms: 3600000,
  retryMaxDelayMs: 3600000,
  retry_backoff_multiplier: 2.0,
  retryBackoffMultiplier: 2.0,
  retry_policy: {
    strategy: 'EXPONENTIAL',
    maxAttempts: 8,
    baseDelayMs: 5000,
    maxDelayMs: 3600000,
    backoffMultiplier: 2.0,
  },
  retryPolicy: {
    strategy: 'EXPONENTIAL',
    maxAttempts: 8,
    baseDelayMs: 5000,
    maxDelayMs: 3600000,
    backoffMultiplier: 2.0,
  },
  is_system: true,
  isSystem: true,
  created_at: new Date().toISOString(),
  createdAt: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
}

const sampleCustomTemplate: WebhookTemplate = {
  id: 'tmpl-cust-001',
  tenant_id: 'tenant-123',
  tenantId: 'tenant-123',
  name: 'Custom Order Processor',
  description: 'Internal microservice orders hook',
  http_method: 'PUT',
  httpMethod: 'PUT',
  url: 'https://orders.internal.net/sync',
  custom_headers: { 'X-Custom-Secret': '[REDACTED]', 'X-App': 'Store' },
  customHeaders: { 'X-Custom-Secret': '[REDACTED]', 'X-App': 'Store' },
  default_payload: { order_id: '123' },
  defaultPayload: { order_id: '123' },
  rate_limit_rps: 50,
  rateLimitRps: 50,
  retry_strategy: 'FIXED',
  retryStrategy: 'FIXED',
  retry_max_attempts: 4,
  retryMaxAttempts: 4,
  retry_base_delay_ms: 2000,
  retryBaseDelayMs: 2000,
  retry_max_delay_ms: 2000,
  retryMaxDelayMs: 2000,
  retry_backoff_multiplier: 1.0,
  retryBackoffMultiplier: 1.0,
  is_system: false,
  isSystem: false,
  created_at: new Date().toISOString(),
  createdAt: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
}

describe('Phase 2 – Vani\'s Task 1: Webhook Templates (Frontend)', () => {
  afterEach(() => {
    cleanup()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
  })

  describe('1. API Client Contracts & Normalization', () => {
    it('normalizeTemplate correctly parses dual camelCase & snake_case fields', () => {
      const raw = {
        id: 't-1',
        name: 'Test Template',
        http_method: 'post',
        rate_limit_rps: 20,
        retry_strategy: 'FIXED',
        retry_max_attempts: 5,
        retry_base_delay_ms: 1000,
        retry_max_delay_ms: 1000,
        retry_backoff_multiplier: 1.0,
        is_system: true,
      }

      const normalized = normalizeTemplate(raw)
      expect(normalized.id).toBe('t-1')
      expect(normalized.name).toBe('Test Template')
      expect(normalized.httpMethod).toBe('POST')
      expect(normalized.http_method).toBe('POST')
      expect(normalized.rateLimitRps).toBe(20)
      expect(normalized.rate_limit_rps).toBe(20)
      expect(normalized.retryStrategy).toBe('FIXED')
      expect(normalized.retry_strategy).toBe('FIXED')
      expect(normalized.isSystem).toBe(true)
      expect(normalized.is_system).toBe(true)
    })

    it('fetchTemplates passes type and search query parameters', async () => {
      vi.mocked(apiClient.get).mockResolvedValueOnce([sampleSystemTemplate])

      const list = await fetchTemplates({ type: 'system', search: 'slack' })
      expect(apiClient.get).toHaveBeenCalledWith('/templates', {
        params: { type: 'system', search: 'slack' },
      })
      expect(list).toHaveLength(1)
      expect(list[0].name).toBe('Slack Incoming Webhook')
    })

    it('createTemplate sends POST request and returns normalized template', async () => {
      vi.mocked(apiClient.post).mockResolvedValueOnce(sampleCustomTemplate)

      const res = await createTemplate({
        name: 'Custom Order Processor',
        httpMethod: 'PUT',
        rateLimitRps: 50,
      })

      expect(apiClient.post).toHaveBeenCalledWith(
        '/templates',
        expect.objectContaining({ name: 'Custom Order Processor' })
      )
      expect(res.name).toBe('Custom Order Processor')
      expect(res.httpMethod).toBe('PUT')
    })

    it('updateTemplate sends PATCH request', async () => {
      vi.mocked(apiClient.patch).mockResolvedValueOnce({
        ...sampleCustomTemplate,
        name: 'Updated Order Processor',
      })

      const res = await updateTemplate(sampleCustomTemplate.id, {
        name: 'Updated Order Processor',
      })

      expect(apiClient.patch).toHaveBeenCalledWith(
        `/templates/${sampleCustomTemplate.id}`,
        { name: 'Updated Order Processor' }
      )
      expect(res.name).toBe('Updated Order Processor')
    })

    it('deleteTemplate sends DELETE request', async () => {
      vi.mocked(apiClient.delete).mockResolvedValueOnce({
        success: true,
        id: sampleCustomTemplate.id,
        message: 'Deleted',
      })

      const res = await deleteTemplate(sampleCustomTemplate.id)
      expect(apiClient.delete).toHaveBeenCalledWith(
        `/templates/${sampleCustomTemplate.id}`
      )
      expect(res.success).toBe(true)
    })

    it('applyTemplate sends POST request to /templates/:id/apply', async () => {
      vi.mocked(apiClient.post).mockResolvedValueOnce({
        templateId: sampleSystemTemplate.id,
        templateName: sampleSystemTemplate.name,
        url: 'https://overridden.example.com',
        httpMethod: 'POST',
        customHeaders: { 'Content-Type': 'application/json' },
        rateLimitRps: 1,
        retryStrategy: 'EXPONENTIAL',
        retryMaxAttempts: 8,
      })

      const res = await applyTemplate(sampleSystemTemplate.id, {
        url: 'https://overridden.example.com',
      })

      expect(apiClient.post).toHaveBeenCalledWith(
        `/templates/${sampleSystemTemplate.id}/apply`,
        { url: 'https://overridden.example.com' }
      )
      expect(res.url).toBe('https://overridden.example.com')
      expect(res.retryStrategy).toBe('EXPONENTIAL')
    })

    it('createEndpointFromTemplate sends POST request to /templates/:id/create-endpoint', async () => {
      vi.mocked(apiClient.post).mockResolvedValueOnce({
        id: 'new-ep-id',
        url: 'https://created.example.com',
        secret: 'whsec_secret123',
        active: true,
      })

      const res = await createEndpointFromTemplate(sampleSystemTemplate.id, {
        url: 'https://created.example.com',
      })

      expect(apiClient.post).toHaveBeenCalledWith(
        `/templates/${sampleSystemTemplate.id}/create-endpoint`,
        { url: 'https://created.example.com' }
      )
      expect(res.id).toBe('new-ep-id')
      expect(res.secret).toBe('whsec_secret123')
    })
  })

  describe('2. Mock Store Templates Integration', () => {
    it('contains all 5 predefined system templates', () => {
      const templates = mockStore.getTemplates()
      const systemTemplates = templates.filter((t) => t.is_system)

      expect(systemTemplates.length).toBeGreaterThanOrEqual(5)
      const names = systemTemplates.map((t) => t.name)
      expect(names).toContain('Slack Incoming Webhook')
      expect(names).toContain('Discord Webhook')
      expect(names).toContain('Stripe Events Handler')
      expect(names).toContain('PagerDuty Incident Webhook')
      expect(names).toContain('Generic JSON Webhook')
    })

    it('filters templates by type=system and type=custom in mockStore', () => {
      const systemList = mockStore.getTemplates({ type: 'system' })
      expect(systemList.every((t) => t.is_system)).toBe(true)

      const customList = mockStore.getTemplates({ type: 'custom' })
      expect(customList.every((t) => !t.is_system)).toBe(true)
    })

    it('supports creating, editing, and deleting custom templates in mockStore', () => {
      const created = mockStore.createTemplate({
        name: 'Unit Test Template',
        description: 'Test description',
        httpMethod: 'POST',
        rateLimitRps: 15,
        retryStrategy: 'FIXED',
        retryMaxAttempts: 3,
        retryBaseDelayMs: 1500,
        retryMaxDelayMs: 1500,
        retryBackoffMultiplier: 1.0,
      })

      expect(created.name).toBe('Unit Test Template')
      expect(created.is_system).toBe(false)
      expect(created.rate_limit_rps).toBe(15)

      const updated = mockStore.updateTemplate(created.id, {
        name: 'Updated Unit Test Template',
        rateLimitRps: 30,
      })

      expect(updated?.name).toBe('Updated Unit Test Template')
      expect(updated?.rate_limit_rps).toBe(30)

      const deleteRes = mockStore.deleteTemplate(created.id)
      expect(deleteRes?.success).toBe(true)
      expect(mockStore.getTemplate(created.id)).toBeUndefined()
    })

    it('protects system templates from modification and deletion in mockStore', () => {
      const slackTemplate = mockStore
        .getTemplates()
        .find((t) => t.name === 'Slack Incoming Webhook')!

      expect(() =>
        mockStore.updateTemplate(slackTemplate.id, { name: 'New Slack' })
      ).toThrow('System templates cannot be modified or deleted')

      expect(() => mockStore.deleteTemplate(slackTemplate.id)).toThrow(
        'System templates cannot be modified or deleted'
      )
    })

    it('applyTemplate in mockStore redacts sensitive headers', () => {
      const template = mockStore.createTemplate({
        name: 'Secret Template',
        customHeaders: {
          Authorization: 'Bearer super-secret-token',
          'X-Api-Key': 'key-12345',
          'Content-Type': 'application/json',
        },
      })

      const applied = mockStore.applyTemplate(template.id)
      expect(applied.customHeaders['Content-Type']).toBe('application/json')
      expect(applied.customHeaders.Authorization).toBe('[REDACTED]')
      expect(applied.customHeaders['X-Api-Key']).toBe('[REDACTED]')

      mockStore.deleteTemplate(template.id)
    })
  })

  describe('3. TemplateDetailDrawer Component', () => {
    it('renders system template details, retry policy, and handles redacted headers safely', () => {
      const handleApply = vi.fn()
      const handleClose = vi.fn()

      render(
        <TemplateDetailDrawer
          isOpen={true}
          onClose={handleClose}
          template={sampleSystemTemplate}
          onApply={handleApply}
        />
      )

      expect(screen.getByText('Slack Incoming Webhook')).toBeDefined()
      expect(screen.getByText('System Template')).toBeDefined()
      expect(screen.getByText('POST')).toBeDefined()
      expect(screen.getByText('1 RPS')).toBeDefined()
      expect(screen.getByText('Exponential Backoff')).toBeDefined()
      expect(screen.getByText('[REDACTED]')).toBeDefined()

      const applyBtn = screen.getByRole('button', { name: /apply template/i })
      fireEvent.click(applyBtn)
      expect(handleApply).toHaveBeenCalledWith(sampleSystemTemplate)
    })

    it('shows Edit and Delete buttons only for custom templates', () => {
      const handleEdit = vi.fn()
      const handleDelete = vi.fn()

      const { rerender } = render(
        <TemplateDetailDrawer
          isOpen={true}
          onClose={vi.fn()}
          template={sampleSystemTemplate}
          onApply={vi.fn()}
          onEdit={handleEdit}
          onDelete={handleDelete}
        />
      )

      expect(screen.queryByRole('button', { name: /^edit$/i })).toBeNull()
      expect(screen.queryByRole('button', { name: /^delete$/i })).toBeNull()

      rerender(
        <TemplateDetailDrawer
          isOpen={true}
          onClose={vi.fn()}
          template={sampleCustomTemplate}
          onApply={vi.fn()}
          onEdit={handleEdit}
          onDelete={handleDelete}
        />
      )

      expect(screen.getByRole('button', { name: /^edit$/i })).toBeDefined()
      expect(screen.getByRole('button', { name: /^delete$/i })).toBeDefined()
    })
  })

  describe('4. TemplateFormModal Component', () => {
    it('validates template name requirement and boundaries', async () => {
      const handleSuccess = vi.fn()
      render(
        <AppProvider>
          <TemplateFormModal
            isOpen={true}
            onClose={vi.fn()}
            onSuccess={handleSuccess}
            template={null}
          />
        </AppProvider>
      )

      const submitBtn = screen.getByRole('button', { name: /create template/i })
      fireEvent.click(submitBtn)

      expect(await screen.findByText('Template name is required.')).toBeDefined()
      expect(handleSuccess).not.toHaveBeenCalled()
    })

    it('populates fields and disables editing for system templates', () => {
      render(
        <AppProvider>
          <TemplateFormModal
            isOpen={true}
            onClose={vi.fn()}
            onSuccess={vi.fn()}
            template={sampleSystemTemplate}
          />
        </AppProvider>
      )

      expect((screen.getByDisplayValue('Slack Incoming Webhook') as HTMLInputElement).disabled).toBe(true)
      expect(screen.getByText(/predefined system template/i)).toBeDefined()
      expect(screen.queryByRole('button', { name: /save changes/i })).toBeNull()
    })
  })

  describe('5. CreateEndpointModal with Template Prefill', () => {
    it('prefills destination URL, rate limit, and retry policy from initialTemplate', () => {
      render(
        <AppProvider>
          <CreateEndpointModal
            isOpen={true}
            onClose={vi.fn()}
            onSuccess={vi.fn()}
            initialTemplate={sampleSystemTemplate}
          />
        </AppProvider>
      )

      expect(
        screen.getByText(/applying template: slack incoming webhook/i)
      ).toBeDefined()

      const urlInput = screen.getByLabelText(/destination url/i) as HTMLInputElement
      expect(urlInput.value).toBe('https://hooks.slack.com/services/PLACEHOLDER')

      const rateLimitInput = screen.getByLabelText(/rate limit/i) as HTMLInputElement
      expect(rateLimitInput.value).toBe('1')

      // Retry policy prefilled from template (sampleSystemTemplate has 8 attempts)
      const attemptsInput = screen.getByLabelText(/maximum retry attempts/i) as HTMLInputElement
      expect(attemptsInput.value).toBe('8')
      const expBtn = screen.getByTestId('strategy-exponential-btn')
      expect(expBtn).toBeDefined()
    })

    it('allows customizing all settings before creating endpoint', async () => {
      const handleSuccess = vi.fn()
      render(
        <AppProvider>
          <CreateEndpointModal
            isOpen={true}
            onClose={vi.fn()}
            onSuccess={handleSuccess}
            initialTemplate={sampleSystemTemplate}
          />
        </AppProvider>
      )

      const urlInput = screen.getByLabelText(/destination url/i) as HTMLInputElement
      fireEvent.change(urlInput, {
        target: { value: 'https://hooks.slack.com/services/CUSTOM_HOOK_123' },
      })
      expect(urlInput.value).toBe('https://hooks.slack.com/services/CUSTOM_HOOK_123')

      const rateLimitInput = screen.getByLabelText(/rate limit/i) as HTMLInputElement
      fireEvent.change(rateLimitInput, { target: { value: '15' } })
      expect(rateLimitInput.value).toBe('15')

      const submitBtn = screen.getByRole('button', { name: /create endpoint/i })
      fireEvent.click(submitBtn)

      await waitFor(() => {
        expect(screen.getByText(/signing secret generated/i)).toBeDefined()
      })
    })
  })

  describe('6. TemplatesPage Integration', () => {
    it('renders all templates and filters by system and custom tabs', async () => {
      render(
        <AppProvider>
          <MemoryRouter>
            <TemplatesPage />
          </MemoryRouter>
        </AppProvider>
      )

      await waitFor(() => {
        expect(screen.getByText('Slack Incoming Webhook')).toBeDefined()
      })

      expect(screen.getByText('Discord Webhook')).toBeDefined()
      expect(screen.getByText('Stripe Events Handler')).toBeDefined()
      expect(screen.getByText('PagerDuty Incident Webhook')).toBeDefined()
      expect(screen.getByText('Generic JSON Webhook')).toBeDefined()

      // Click System tab
      const systemTab = screen.getByRole('button', { name: /system \(/i })
      fireEvent.click(systemTab)
      expect(screen.getByText('Slack Incoming Webhook')).toBeDefined()

      // Click Custom tab
      const customTab = screen.getByRole('button', { name: /custom \(/i })
      fireEvent.click(customTab)

      // Search box filter
      const allTab = screen.getByRole('button', { name: /all \(/i })
      fireEvent.click(allTab)

      const searchInput = screen.getByPlaceholderText(/search templates/i)
      fireEvent.change(searchInput, { target: { value: 'discord' } })

      expect(screen.getByText('Discord Webhook')).toBeDefined()
      expect(screen.queryByText('Stripe Events Handler')).toBeNull()
    })

    it('opens Apply Template modal when clicking Apply button on card', async () => {
      render(
        <AppProvider>
          <MemoryRouter>
            <TemplatesPage />
          </MemoryRouter>
        </AppProvider>
      )

      await waitFor(() => {
        expect(screen.getByText('Slack Incoming Webhook')).toBeDefined()
      })

      const applyButtons = screen.getAllByRole('button', { name: /apply/i })
      fireEvent.click(applyButtons[0])

      await waitFor(() => {
        expect(screen.getByText(/applying template:/i)).toBeDefined()
      })
    })
  })
})

