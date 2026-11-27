import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AppProvider } from './context/AppContext'
import { NotificationProvider } from './context/NotificationContext'
import { AuthProvider } from './context/AuthContext'
import { AuthGuard } from './components/AuthGuard'
import { DashboardLayout } from './layouts/DashboardLayout'
import { LandingPage } from './pages/LandingPage'
import { LoginPage } from './pages/LoginPage'
import { RegisterPage } from './pages/RegisterPage'
import { DashboardPage } from './pages/DashboardPage'
import { EndpointsPage } from './pages/EndpointsPage'
import { EndpointTestingPage } from './pages/EndpointTestingPage'
import { TemplatesPage } from './pages/TemplatesPage'
import { EventsPage } from './pages/EventsPage'
import { DeliveriesPage } from './pages/DeliveriesPage'
import { ScheduledDeliveriesPage } from './pages/ScheduledDeliveriesPage'
import { DeadLettersPage } from './pages/DeadLettersPage'
import { ReplayPage } from './pages/ReplayPage'
import { AnalyticsPage } from './pages/AnalyticsPage'
import { SettingsPage } from './pages/SettingsPage'
import { RedisMonitoringPage } from './pages/RedisMonitoringPage'
import { NotFoundPage } from './pages/NotFoundPage'

export function App() {
  return (
    <AppProvider>
      <AuthProvider>
        <BrowserRouter>
          <NotificationProvider>
            <Routes>
              {/* Public SaaS Auth Routes */}
              <Route path="/landing" element={<LandingPage />} />
              <Route path="/login" element={<LoginPage />} />
              <Route path="/register" element={<RegisterPage />} />

              {/* Protected Dashboard Routes wrapped in AuthGuard */}
              <Route
                path="/"
                element={
                  <AuthGuard>
                    <DashboardLayout />
                  </AuthGuard>
                }
              >
                <Route index element={<DashboardPage />} />
                <Route path="dashboard" element={<Navigate to="/" replace />} />
                <Route path="endpoints" element={<EndpointsPage />} />
                <Route path="templates" element={<TemplatesPage />} />
                <Route path="endpoint-testing" element={<EndpointTestingPage />} />
                <Route path="events" element={<EventsPage />} />
                <Route path="deliveries" element={<DeliveriesPage />} />
                <Route path="scheduled-deliveries" element={<ScheduledDeliveriesPage />} />
                <Route path="dead-letters" element={<DeadLettersPage />} />
                <Route path="replay" element={<ReplayPage />} />
                <Route path="analytics" element={<AnalyticsPage />} />
                <Route path="monitoring" element={<RedisMonitoringPage />} />
                <Route path="redis" element={<Navigate to="/monitoring" replace />} />
                <Route path="settings" element={<SettingsPage />} />
                <Route path="*" element={<NotFoundPage />} />
              </Route>
            </Routes>
          </NotificationProvider>
        </BrowserRouter>
      </AuthProvider>
    </AppProvider>
  )
}

export default App
