import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AppProvider } from './context/AppContext'
import { DashboardLayout } from './layouts/DashboardLayout'
import { DashboardPage } from './pages/DashboardPage'
import { EndpointsPage } from './pages/EndpointsPage'
import { EventsPage } from './pages/EventsPage'
import { DeliveriesPage } from './pages/DeliveriesPage'
import { DeadLettersPage } from './pages/DeadLettersPage'
import { ReplayPage } from './pages/ReplayPage'
import { AnalyticsPage } from './pages/AnalyticsPage'
import { SettingsPage } from './pages/SettingsPage'
import { NotFoundPage } from './pages/NotFoundPage'

export function App() {
  return (
    <AppProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<DashboardLayout />}>
            <Route index element={<DashboardPage />} />
            <Route path="dashboard" element={<Navigate to="/" replace />} />
            <Route path="endpoints" element={<EndpointsPage />} />
            <Route path="events" element={<EventsPage />} />
            <Route path="deliveries" element={<DeliveriesPage />} />
            <Route path="dead-letters" element={<DeadLettersPage />} />
            <Route path="replay" element={<ReplayPage />} />
            <Route path="analytics" element={<AnalyticsPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AppProvider>
  )
}

export default App
