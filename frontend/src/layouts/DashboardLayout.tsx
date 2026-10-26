import React, { useState } from 'react'
import { Outlet } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { Header } from './Header'
import { ToastContainer } from '../components/ui/Toast'
import { SendEventModal } from '../components/SendEventModal'
import { CreateEndpointModal } from '../components/CreateEndpointModal'
import { useApp } from '../context/AppContext'
import { Sparkles, AlertCircle, RefreshCw } from 'lucide-react'

export const DashboardLayout: React.FC = () => {
  const { mode, toggleMode, backendHealth, checkHealth } = useApp()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [sendEventOpen, setSendEventOpen] = useState(false)
  const [addEndpointOpen, setAddEndpointOpen] = useState(false)

  return (
    <div className="min-h-screen bg-slate-50/60 flex">
      {/* Sidebar Navigation */}
      <Sidebar isOpen={mobileMenuOpen} onClose={() => setMobileMenuOpen(false)} />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Persistent Demo Mode Banner */}
        {mode === 'demo' ? (
          <div className="bg-purple-50 border-b border-purple-200/80 px-4 py-1.5 text-xs text-purple-900 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="w-3.5 h-3.5 text-purple-600 shrink-0" />
              <span>
                <strong>Demo Mode Active:</strong> Displaying simulated fixtures with full stateful interactions. No network requests are sent to the backend.
              </span>
            </div>
            <button
              onClick={toggleMode}
              className="text-2xs font-semibold text-purple-700 hover:text-purple-950 underline underline-offset-2 ml-2 cursor-pointer shrink-0"
            >
              Switch to Live API Mode &rarr;
            </button>
          </div>
        ) : (
          /* Live Mode Status Banner when backend is down */
          backendHealth.status === 'down' && (
            <div className="bg-rose-50 border-b border-rose-200 px-4 py-2 text-xs text-rose-900 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                <span>
                  <strong>Backend Unavailable:</strong> Unable to connect to HookForge server. (
                  {backendHealth.error || 'Connection refused'}). Switch to Demo Mode to explore with simulated fixtures.
                </span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => checkHealth()}
                  className="inline-flex items-center gap-1 text-2xs font-medium text-rose-800 hover:text-rose-950 bg-rose-100 px-2 py-0.5 rounded cursor-pointer"
                >
                  <RefreshCw className="w-2.5 h-2.5" />
                  <span>Retry</span>
                </button>
                <button
                  onClick={toggleMode}
                  className="text-2xs font-semibold text-rose-700 hover:text-rose-950 underline underline-offset-2 cursor-pointer"
                >
                  Switch to Demo Mode
                </button>
              </div>
            </div>
          )
        )}

        {/* Global Header */}
        <Header
          onOpenMobileMenu={() => setMobileMenuOpen(true)}
          onOpenSendEvent={() => setSendEventOpen(true)}
          onOpenAddEndpoint={() => setAddEndpointOpen(true)}
        />

        {/* Page Viewport */}
        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-7xl w-full mx-auto">
          <Outlet />
        </main>
      </div>

      {/* Global Modals & Notifications */}
      <SendEventModal
        isOpen={sendEventOpen}
        onClose={() => setSendEventOpen(false)}
        onSuccess={() => {
          // Can refresh active views if needed
        }}
      />

      <CreateEndpointModal
        isOpen={addEndpointOpen}
        onClose={() => setAddEndpointOpen(false)}
        onSuccess={() => {
          // Can refresh active views if needed
        }}
      />

      <ToastContainer />
    </div>
  )
}
