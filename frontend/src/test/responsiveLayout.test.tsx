// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { Sidebar } from '../layouts/Sidebar'
import { Header } from '../layouts/Header'
import { Drawer } from '../components/ui/Drawer'
import { Modal } from '../components/ui/Modal'

// Mock AppContext
vi.mock('../context/AppContext', () => ({
  useApp: () => ({
    mode: 'demo',
    toggleMode: vi.fn(),
    backendHealth: { status: 'up' },
    checkHealth: vi.fn(),
  }),
}))

describe('Responsive UI - Sidebar', () => {
  afterEach(() => {
    cleanup()
    document.body.style.overflow = ''
  })

  it('renders sidebar navigation items correctly', () => {
    render(
      <MemoryRouter>
        <Sidebar isOpen={false} onClose={vi.fn()} isCollapsed={false} />
      </MemoryRouter>
    )

    expect(screen.getByText('Overview')).toBeDefined()
    expect(screen.getByText('Endpoints')).toBeDefined()
    expect(screen.getByText('Deliveries')).toBeDefined()
    expect(screen.getByText('Analytics')).toBeDefined()
  })

  it('sets body overflow to hidden when mobile drawer is open and resets on close', () => {
    const { rerender } = render(
      <MemoryRouter>
        <Sidebar isOpen={true} onClose={vi.fn()} isCollapsed={false} />
      </MemoryRouter>
    )

    expect(document.body.style.overflow).toBe('hidden')

    rerender(
      <MemoryRouter>
        <Sidebar isOpen={false} onClose={vi.fn()} isCollapsed={false} />
      </MemoryRouter>
    )

    expect(document.body.style.overflow).toBe('')
  })

  it('calls onClose when Escape key is pressed while drawer is open', () => {
    const onClose = vi.fn()
    render(
      <MemoryRouter>
        <Sidebar isOpen={true} onClose={onClose} isCollapsed={false} />
      </MemoryRouter>
    )

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('calls onClose when backdrop is clicked', () => {
    const onClose = vi.fn()
    render(
      <MemoryRouter>
        <Sidebar isOpen={true} onClose={onClose} isCollapsed={false} />
      </MemoryRouter>
    )

    const backdrop = document.querySelector('.backdrop-blur-xs')
    expect(backdrop).not.toBeNull()
    if (backdrop) {
      fireEvent.click(backdrop)
      expect(onClose).toHaveBeenCalledTimes(1)
    }
  })

  it('calls onClose when a navigation item is clicked', () => {
    const onClose = vi.fn()
    render(
      <MemoryRouter>
        <Sidebar isOpen={true} onClose={onClose} isCollapsed={false} />
      </MemoryRouter>
    )

    const endpointsLink = screen.getByRole('link', { name: /endpoints/i })
    fireEvent.click(endpointsLink)
    expect(onClose).toHaveBeenCalled()
  })

  it('preserves labels on mobile view even if isCollapsed is true on desktop', () => {
    render(
      <MemoryRouter>
        <Sidebar isOpen={true} onClose={vi.fn()} isCollapsed={true} />
      </MemoryRouter>
    )

    // HookForge brand title should still be present in the DOM for mobile drawer
    const brandTitle = screen.getByText('HookForge')
    expect(brandTitle).toBeDefined()
    // It should have the responsive 'lg:hidden' class when isCollapsed is true
    expect(brandTitle.className).toContain('lg:hidden')

    // Navigation item labels should also be present in DOM
    const overviewLabel = screen.getByText('Overview')
    expect(overviewLabel).toBeDefined()
    expect(overviewLabel.className).toContain('lg:hidden')
  })
})

describe('Responsive UI - Header', () => {
  afterEach(() => {
    cleanup()
  })

  it('renders title and mobile menu button', () => {
    const onOpenMobileMenu = vi.fn()
    render(
      <MemoryRouter initialEntries={['/']}>
        <Header
          onOpenMobileMenu={onOpenMobileMenu}
          onOpenSendEvent={vi.fn()}
          onOpenAddEndpoint={vi.fn()}
          onOpenSearch={vi.fn()}
        />
      </MemoryRouter>
    )

    const menuButton = screen.getByRole('button', { name: /open navigation menu/i })
    expect(menuButton).toBeDefined()
    fireEvent.click(menuButton)
    expect(onOpenMobileMenu).toHaveBeenCalledTimes(1)
  })

  it('triggers search dialog from both desktop and mobile search triggers', () => {
    const onOpenSearch = vi.fn()
    render(
      <MemoryRouter initialEntries={['/']}>
        <Header
          onOpenMobileMenu={vi.fn()}
          onOpenSendEvent={vi.fn()}
          onOpenAddEndpoint={vi.fn()}
          onOpenSearch={onOpenSearch}
        />
      </MemoryRouter>
    )

    const desktopSearchButton = screen.getByRole('button', { name: /open search dialog/i })
    fireEvent.click(desktopSearchButton)
    expect(onOpenSearch).toHaveBeenCalledTimes(1)

    const mobileSearchButton = screen.getByRole('button', { name: /^open search$/i })
    fireEvent.click(mobileSearchButton)
    expect(onOpenSearch).toHaveBeenCalledTimes(2)
  })

  it('toggles mobile overflow menu on small screens and closes on Escape', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <Header
          onOpenMobileMenu={vi.fn()}
          onOpenSendEvent={vi.fn()}
          onOpenAddEndpoint={vi.fn()}
          onOpenSearch={vi.fn()}
        />
      </MemoryRouter>
    )

    const overflowButton = screen.getByRole('button', { name: /more actions/i })
    fireEvent.click(overflowButton)

    // Dropdown content should now be visible
    expect(screen.getByText('Developer Workspace')).toBeDefined()
    expect(screen.getByText('Send Test Event')).toBeDefined()

    // Pressing Escape should close the overflow menu
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByText('Developer Workspace')).toBeNull()
  })
})

describe('Responsive UI - Drawers and Modals', () => {
  afterEach(() => {
    cleanup()
    document.body.style.overflow = ''
  })

  it('Drawer handles mobile full-width and responsive padding', () => {
    render(
      <Drawer isOpen={true} onClose={vi.fn()} title="Test Inspection" width="lg">
        <div>Drawer content</div>
      </Drawer>
    )

    const dialog = screen.getByRole('dialog')
    expect(dialog).toBeDefined()
    expect(dialog.className).toContain('max-w-full')
    expect(dialog.className).toContain('sm:max-w-lg')
    expect(screen.getByText('Test Inspection')).toBeDefined()
  })

  it('Modal renders responsive dialog container and closes on Escape', () => {
    const onClose = vi.fn()
    render(
      <Modal isOpen={true} onClose={onClose} title="Test Modal" maxWidth="md">
        <div>Modal content</div>
      </Modal>
    )

    const dialog = screen.getByRole('dialog')
    expect(dialog).toBeDefined()
    expect(dialog.className).toContain('max-w-md')
    expect(screen.getByText('Test Modal')).toBeDefined()

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
