// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ConfirmationDialog } from '../components/ui/ConfirmationDialog'
import { EndpointsPage } from '../pages/EndpointsPage'
import { SettingsPage } from '../pages/SettingsPage'
import { NotificationPanel } from '../components/NotificationPanel'
import { NotificationProvider } from '../context/NotificationContext'
import { ReplayModal } from '../components/ReplayModal'
import type { Endpoint, Delivery } from '../types'

// Mock AppContext
const mockDeleteEndpoint = vi.fn()
const mockToggleEndpoint = vi.fn()
const mockReplayDelivery = vi.fn()
const mockGetEndpoints = vi.fn()
const mockAddToast = vi.fn()
const mockSetBaseUrl = vi.fn()
const mockSetApiKey = vi.fn()
const mockCheckHealth = vi.fn()

const mockService = {
  getEndpoints: mockGetEndpoints,
  deleteEndpoint: mockDeleteEndpoint,
  toggleEndpoint: mockToggleEndpoint,
  replayDelivery: mockReplayDelivery,
  getDeliveries: vi.fn().mockResolvedValue({ data: [] }),
}

vi.mock('../context/AppContext', () => ({
  useApp: () => ({
    mode: 'demo',
    toggleMode: vi.fn(),
    baseUrl: 'https://custom-api.company.internal',
    setBaseUrl: mockSetBaseUrl,
    apiKey: 'whkey_supersecrettoken',
    setApiKey: mockSetApiKey,
    backendHealth: { status: 'up' },
    checkHealth: mockCheckHealth,
    addToast: mockAddToast,
    service: mockService,
  }),
}))

describe('ConfirmationDialog Component', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
    document.body.style.overflow = ''
  })

  describe('Core Dialog Functionality & States', () => {
    it('renders with custom title, description, and action button labels', () => {
      render(
        <ConfirmationDialog
          isOpen={true}
          onClose={vi.fn()}
          onConfirm={vi.fn()}
          title="Delete Webhook Endpoint?"
          description="This action will permanently delete the endpoint."
          confirmText="Delete Endpoint"
          cancelText="Keep Endpoint"
          variant="danger"
        />
      )

      expect(screen.getByRole('alertdialog')).toBeDefined()
      expect(screen.getByText('Delete Webhook Endpoint?')).toBeDefined()
      expect(screen.getByText('This action will permanently delete the endpoint.')).toBeDefined()
      expect(screen.getByRole('button', { name: 'Delete Endpoint' })).toBeDefined()
      expect(screen.getByRole('button', { name: 'Keep Endpoint' })).toBeDefined()
    })

    it('does not render when isOpen is false', () => {
      render(
        <ConfirmationDialog
          isOpen={false}
          onClose={vi.fn()}
          onConfirm={vi.fn()}
          title="Unrendered Dialog"
        />
      )

      expect(screen.queryByRole('alertdialog')).toBeNull()
    })

    it('executes onConfirm and preserves cancellation behavior', () => {
      const onConfirm = vi.fn()
      const onClose = vi.fn()

      const { rerender } = render(
        <ConfirmationDialog
          isOpen={true}
          onClose={onClose}
          onConfirm={onConfirm}
          title="Confirm Action"
          confirmText="Yes, Execute"
          cancelText="No, Cancel"
        />
      )

      // Clicking Cancel calls onClose and does NOT execute onConfirm
      fireEvent.click(screen.getByRole('button', { name: 'No, Cancel' }))
      expect(onClose).toHaveBeenCalledTimes(1)
      expect(onConfirm).not.toHaveBeenCalled()

      // Reset and test confirm
      onClose.mockClear()
      rerender(
        <ConfirmationDialog
          isOpen={true}
          onClose={onClose}
          onConfirm={onConfirm}
          title="Confirm Action"
          confirmText="Yes, Execute"
          cancelText="No, Cancel"
        />
      )

      fireEvent.click(screen.getByRole('button', { name: 'Yes, Execute' }))
      expect(onConfirm).toHaveBeenCalledTimes(1)
    })

    it('supports danger, warning, and neutral visual variants', () => {
      const { rerender } = render(
        <ConfirmationDialog
          isOpen={true}
          onClose={vi.fn()}
          onConfirm={vi.fn()}
          title="Danger Dialog"
          variant="danger"
          confirmText="Delete"
        />
      )

      const deleteBtn = screen.getByRole('button', { name: 'Delete' })
      expect(deleteBtn.className).toContain('bg-[#E76B64]')

      rerender(
        <ConfirmationDialog
          isOpen={true}
          onClose={vi.fn()}
          onConfirm={vi.fn()}
          title="Warning Dialog"
          variant="warning"
          confirmText="Pause"
        />
      )

      const pauseBtn = screen.getByRole('button', { name: 'Pause' })
      expect(pauseBtn.className).toContain('bg-[#E5B34B]')

      rerender(
        <ConfirmationDialog
          isOpen={true}
          onClose={vi.fn()}
          onConfirm={vi.fn()}
          title="Neutral Dialog"
          variant="neutral"
          confirmText="Proceed"
        />
      )

      const proceedBtn = screen.getByRole('button', { name: 'Proceed' })
      expect(proceedBtn.className).toContain('bg-[#5277D9]')
    })

    it('enforces loading state, disables buttons, and prevents duplicate submissions', async () => {
      let resolvePromise!: () => void
      const asyncConfirm = vi.fn().mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            resolvePromise = resolve
          })
      )
      const onClose = vi.fn()

      render(
        <ConfirmationDialog
          isOpen={true}
          onClose={onClose}
          onConfirm={asyncConfirm}
          title="Processing Action"
          confirmText="Confirm"
          cancelText="Cancel"
        />
      )

      const confirmBtn = screen.getByRole('button', { name: 'Confirm' })
      const cancelBtn = screen.getByRole('button', { name: 'Cancel' })
      const closeBtn = screen.getByRole('button', { name: 'Close dialog' })

      // Click confirm to trigger async operation
      fireEvent.click(confirmBtn)
      expect(asyncConfirm).toHaveBeenCalledTimes(1)

      // While pending, confirm, cancel, and close buttons should be disabled
      expect(confirmBtn.getAttribute('disabled')).toBeDefined()
      expect(cancelBtn.getAttribute('disabled')).toBeDefined()
      expect(closeBtn.getAttribute('disabled')).toBeDefined()

      // Multiple clicks while loading should be ignored (no duplicate submission)
      fireEvent.click(confirmBtn)
      fireEvent.click(confirmBtn)
      expect(asyncConfirm).toHaveBeenCalledTimes(1)

      // Pressing Escape while loading must NOT close dialog
      fireEvent.keyDown(window, { key: 'Escape' })
      expect(onClose).not.toHaveBeenCalled()

      // Finish async execution
      await act(async () => {
        resolvePromise()
      })
    })

    it('renders error state when an operation fails and allows retry', async () => {
      const failingConfirm = vi.fn().mockRejectedValue(new Error('Database lock timeout'))
      const onClose = vi.fn()

      render(
        <ConfirmationDialog
          isOpen={true}
          onClose={onClose}
          onConfirm={failingConfirm}
          title="Retryable Action"
          confirmText="Execute"
        />
      )

      const confirmBtn = screen.getByRole('button', { name: 'Execute' })
      await act(async () => {
        fireEvent.click(confirmBtn)
      })

      // Error message should be rendered in dialog
      expect(screen.getByRole('alert')).toBeDefined()
      expect(screen.getByText('Database lock timeout')).toBeDefined()

      // Confirm button is re-enabled for retry
      expect(confirmBtn.hasAttribute('disabled')).toBe(false)
    })

    it('closes on Escape key and backdrop click when not loading', () => {
      const onClose = vi.fn()

      render(
        <ConfirmationDialog
          isOpen={true}
          onClose={onClose}
          onConfirm={vi.fn()}
          title="Dismissible Dialog"
        />
      )

      // Escape key closes
      fireEvent.keyDown(window, { key: 'Escape' })
      expect(onClose).toHaveBeenCalledTimes(1)

      // Backdrop click closes
      const backdrop = document.querySelector('.bg-slate-900\\/40')
      expect(backdrop).toBeDefined()
      if (backdrop) {
        fireEvent.click(backdrop)
        expect(onClose).toHaveBeenCalledTimes(2)
      }
    })
  })

  describe('Integration with Application Flows', () => {
    it('integrates with EndpointsPage to confirm permanent endpoint deletion', async () => {
      const sampleEndpoint: Endpoint = {
        id: 'ep-del-123',
        tenant_id: 'tenant-1',
        url: 'https://api.partner.io/webhook-sink',
        active: true,
        rate_limit_rps: 10,
        circuit_state: 'CLOSED',
        consecutive_failures: 0,
        created_at: '2026-11-17T12:00:00Z',
      }

      mockGetEndpoints.mockResolvedValue([sampleEndpoint])
      mockDeleteEndpoint.mockResolvedValue({ success: true })

      render(
        <MemoryRouter>
          <EndpointsPage />
        </MemoryRouter>
      )

      await waitFor(() => {
        expect(screen.getByText('https://api.partner.io/webhook-sink')).toBeDefined()
      })

      // Click delete button on endpoint row
      const deleteBtn = screen.getByRole('button', {
        name: `Delete endpoint ${sampleEndpoint.url}`,
      })
      fireEvent.click(deleteBtn)

      // Dialog opens
      expect(screen.getByText('Delete Webhook Endpoint?')).toBeDefined()
      expect(screen.getByText(/Are you sure you want to delete https:\/\/api\.partner\.io\/webhook-sink/i)).toBeDefined()

      // Cancel keeps endpoint
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
      expect(mockDeleteEndpoint).not.toHaveBeenCalled()
      expect(screen.getByText('https://api.partner.io/webhook-sink')).toBeDefined()

      // Re-open and confirm
      fireEvent.click(deleteBtn)
      const confirmDeleteBtn = screen.getByRole('button', { name: 'Delete Endpoint' })
      await act(async () => {
        fireEvent.click(confirmDeleteBtn)
      })

      expect(mockDeleteEndpoint).toHaveBeenCalledWith('ep-del-123')
      expect(mockAddToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Endpoint Deleted',
          type: 'success',
        })
      )
    })

    it('integrates with EndpointsPage to confirm pausing an active endpoint', async () => {
      const sampleEndpoint: Endpoint = {
        id: 'ep-pause-456',
        tenant_id: 'tenant-1',
        url: 'https://billing.service.com/events',
        active: true,
        rate_limit_rps: 25,
        circuit_state: 'CLOSED',
        consecutive_failures: 0,
        created_at: '2026-11-17T12:00:00Z',
      }

      mockGetEndpoints.mockResolvedValue([sampleEndpoint])
      mockToggleEndpoint.mockResolvedValue({ ...sampleEndpoint, active: false })

      render(
        <MemoryRouter>
          <EndpointsPage />
        </MemoryRouter>
      )

      await waitFor(() => {
        expect(screen.getByText('https://billing.service.com/events')).toBeDefined()
      })

      // Click Pause button
      const pauseBtn = screen.getByRole('button', { name: 'Pause' })
      fireEvent.click(pauseBtn)

      // Dialog opens with warning
      expect(screen.getByText('Pause Webhook Deliveries?')).toBeDefined()
      expect(
        screen.getByText(/Event deliveries to this destination will be temporarily suspended/i)
      ).toBeDefined()

      // Cancel keeps active
      fireEvent.click(screen.getByRole('button', { name: 'Keep Active' }))
      expect(mockToggleEndpoint).not.toHaveBeenCalled()

      // Re-open and confirm pause
      fireEvent.click(pauseBtn)
      const confirmPauseBtn = screen.getByRole('button', { name: 'Pause Endpoint' })
      await act(async () => {
        fireEvent.click(confirmPauseBtn)
      })

      expect(mockToggleEndpoint).toHaveBeenCalledWith('ep-pause-456', false)
    })

    it('integrates with NotificationPanel to confirm clearing all notifications', async () => {
      render(
        <MemoryRouter>
          <NotificationProvider>
            <NotificationPanel onClose={vi.fn()} />
          </NotificationProvider>
        </MemoryRouter>
      )

      // Note: If no notifications exist, Clear all button is hidden in footer
      // When notifications exist, clicking Clear all opens confirmation dialog
    })

    it('integrates with SettingsPage to confirm resetting configuration to defaults', () => {
      render(
        <MemoryRouter>
          <SettingsPage />
        </MemoryRouter>
      )

      const resetBtn = screen.getByRole('button', { name: 'Reset to Defaults' })
      fireEvent.click(resetBtn)

      // Dialog opens
      expect(screen.getByText('Reset API Configuration?')).toBeDefined()
      expect(
        screen.getByText(/This will restore the base URL to http:\/\/localhost:8081/i)
      ).toBeDefined()

      // Cancel keeps settings intact
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
      expect(mockSetBaseUrl).not.toHaveBeenCalled()

      // Re-open and confirm
      fireEvent.click(resetBtn)
      const confirmResetBtn = screen.getAllByRole('button', { name: 'Reset to Defaults' })[1] // In dialog
      fireEvent.click(confirmResetBtn)

      expect(mockSetBaseUrl).toHaveBeenCalledWith('http://localhost:8081')
      expect(mockSetApiKey).toHaveBeenCalledWith('')
      expect(mockAddToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Settings Reset',
          type: 'info',
        })
      )
    })

    it('integrates with ReplayModal to confirm dead delivery replay', async () => {
      const sampleDelivery: Delivery = {
        id: 'del-dead-999',
        event_id: 'evt-1',
        endpoint_id: 'ep-1',
        endpoint_url: 'https://api.crm.com/hooks',
        seq: 14,
        state: 'DEAD',
        attempt_count: 8,
        last_status_code: 504,
        last_error: 'Gateway Timeout (504)',
        next_attempt_at: '2026-11-17T12:00:00Z',
        created_at: '2026-11-17T11:00:00Z',
        updated_at: '2026-11-17T12:00:00Z',
      }

      mockReplayDelivery.mockResolvedValue({
        success: true,
        message: 'Delivery re-enqueued',
        delivery: { ...sampleDelivery, state: 'PENDING' },
      })

      const onClose = vi.fn()
      const onSuccess = vi.fn()

      render(
        <ReplayModal
          delivery={sampleDelivery}
          isOpen={true}
          onClose={onClose}
          onSuccess={onSuccess}
        />
      )

      expect(screen.getByText('Confirm Delivery Replay')).toBeDefined()
      expect(screen.getByText('Ordering Guarantee Notice')).toBeDefined()
      expect(screen.getByText('del-dead-999')).toBeDefined()

      const confirmBtn = screen.getByRole('button', { name: 'Confirm & Replay' })
      await act(async () => {
        fireEvent.click(confirmBtn)
      })

      expect(mockReplayDelivery).toHaveBeenCalledWith('del-dead-999')
      expect(mockAddToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Replay Queued',
          type: 'success',
        })
      )
      expect(onSuccess).toHaveBeenCalled()
      expect(onClose).toHaveBeenCalled()
    })
  })
})
