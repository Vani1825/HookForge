// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { LandingPage } from '../pages/LandingPage'
import { LoginPage } from '../pages/LoginPage'
import { RegisterPage } from '../pages/RegisterPage'
import { AuthGuard } from '../components/AuthGuard'
import { AuthProvider } from '../context/AuthContext'
import { AppProvider } from '../context/AppContext'

describe('SaaS Auth Pages', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    localStorage.clear()
  })

  describe('1. LandingPage', () => {
    it('renders landing hero, brand name, and CTAs', () => {
      render(
        <AppProvider>
          <AuthProvider>
            <MemoryRouter>
              <LandingPage />
            </MemoryRouter>
          </AuthProvider>
        </AppProvider>
      )

      expect(screen.getByText('HookForge')).toBeDefined()
      expect(
        screen.getByText('Reliable, secure webhooks for modern applications')
      ).toBeDefined()
      expect(screen.getByText('Create Your Workspace')).toBeDefined()
      expect(screen.getByText('Interactive Sandbox Demo')).toBeDefined()
    })
  })

  describe('2. LoginPage', () => {
    it('renders login form with email and password inputs', () => {
      render(
        <AppProvider>
          <AuthProvider>
            <MemoryRouter>
              <LoginPage />
            </MemoryRouter>
          </AuthProvider>
        </AppProvider>
      )

      expect(screen.getByLabelText(/Work Email/i)).toBeDefined()
      expect(screen.getByLabelText(/Password/i)).toBeDefined()
      expect(screen.getByRole('button', { name: /Sign In to Workspace/i })).toBeDefined()
    })

    it('shows error if fields are submitted empty', async () => {
      render(
        <AppProvider>
          <AuthProvider>
            <MemoryRouter>
              <LoginPage />
            </MemoryRouter>
          </AuthProvider>
        </AppProvider>
      )

      const submitBtn = screen.getByRole('button', { name: /Sign In to Workspace/i })
      const form = submitBtn.closest('form')!
      fireEvent.submit(form)

      await waitFor(() => {
        expect(
          screen.getByText('Please provide both your email address and password.')
        ).toBeDefined()
      })
    })
  })

  describe('3. RegisterPage', () => {
    it('renders registration form fields', () => {
      render(
        <AppProvider>
          <AuthProvider>
            <MemoryRouter>
              <RegisterPage />
            </MemoryRouter>
          </AuthProvider>
        </AppProvider>
      )

      expect(screen.getByLabelText(/Full Name/i)).toBeDefined()
      expect(screen.getByLabelText(/Work Email/i)).toBeDefined()
      expect(screen.getByLabelText(/Workspace \/ Organization Name/i)).toBeDefined()
      expect(screen.getByLabelText(/^Password \(min 8 characters\)/i)).toBeDefined()
      expect(screen.getByLabelText(/Confirm Password/i)).toBeDefined()
    })

    it('validates password mismatch on registration', async () => {
      render(
        <AppProvider>
          <AuthProvider>
            <MemoryRouter>
              <RegisterPage />
            </MemoryRouter>
          </AuthProvider>
        </AppProvider>
      )

      fireEvent.change(screen.getByLabelText(/Full Name/i), { target: { value: 'Jane Doe' } })
      fireEvent.change(screen.getByLabelText(/Work Email/i), { target: { value: 'jane@example.com' } })
      fireEvent.change(screen.getByLabelText(/^Password \(min 8 characters\)/i), { target: { value: 'Password123' } })
      fireEvent.change(screen.getByLabelText(/Confirm Password/i), { target: { value: 'DifferentPassword' } })

      const submitBtn = screen.getByRole('button', { name: /Create Workspace/i })
      fireEvent.click(submitBtn)

      await waitFor(() => {
        expect(screen.getByText('Passwords do not match.')).toBeDefined()
      })
    })
  })

  describe('4. AuthGuard', () => {
    it('permits access in demo mode without blocking', () => {
      render(
        <AppProvider>
          <AuthProvider>
            <MemoryRouter initialEntries={['/dashboard']}>
              <Routes>
                <Route
                  path="/dashboard"
                  element={
                    <AuthGuard>
                      <div>Protected Content Allowed</div>
                    </AuthGuard>
                  }
                />
              </Routes>
            </MemoryRouter>
          </AuthProvider>
        </AppProvider>
      )

      expect(screen.getByText('Protected Content Allowed')).toBeDefined()
    })
  })
})
