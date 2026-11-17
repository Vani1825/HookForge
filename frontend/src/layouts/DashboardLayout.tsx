import React, { useState, useEffect } from 'react'
import { Outlet } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { Header } from './Header'
import { ToastContainer } from '../components/ui/Toast'
import { SendEventModal } from '../components/SendEventModal'
import { CreateEndpointModal } from '../components/CreateEndpointModal'
import { GlobalSearchModal } from '../components/GlobalSearchModal'
import { useApp } from '../context/AppContext'
import { Sparkles, AlertCircle, RefreshCw } from 'lucide-react'

export const DashboardLayout: React.FC = () => {
  const { mode, toggleMode, backendHealth, checkHealth } = useApp()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false)
  const [sendEventOpen, setSendEventOpen] = useState(false)
  const [addEndpointOpen, setAddEndpointOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)

  // Global keyboard shortcut: Cmd+K / Ctrl+K opens quick search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setSearchOpen((prev) => !prev)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  return (
    <div className="min-h-screen bg-[#F7F6F2] flex">
      {/* Sidebar Navigation */}
      <Sidebar
        isOpen={mobileMenuOpen}
        onClose={() => setMobileMenuOpen(false)}
        isCollapsed={isSidebarCollapsed}
        onToggleCollapse={() => setIsSidebarCollapsed((prev) => !prev)}
      />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Persistent Demo Mode Banner */}
        {mode === 'demo' ? (
          <div className="bg-[#EAF0FF] border-b border-[#DCE5FA] px-3 sm:px-4 py-2 sm:py-1.5 text-xs text-[#202938] flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 sm:gap-2">
            <div className="flex items-center gap-2">
              <Sparkles className="w-3.5 h-3.5 text-[#5277D9] shrink-0" />
              <span>
                <strong>Demo Mode Active:</strong> Displaying simulated fixtures with full stateful interactions. No network requests are sent to the backend.
              </span>
            </div>
            <button
              onClick={toggleMode}
              className="text-2xs font-semibold text-[#5277D9] hover:text-[#4366C4] underline underline-offset-2 ml-0 sm:ml-2 cursor-pointer shrink-0 self-start sm:self-auto"
            >
              Switch to Live API Mode &rarr;
            </button>
          </div>
        ) : (
          /* Live Mode Status Banner when backend is down */
          backendHealth.status === 'down' && (
            <div className="bg-[#E76B64]/10 border-b border-[#E76B64]/25 px-3 sm:px-4 py-2 text-xs text-[#202938] flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-[#E76B64] shrink-0" />
                <span>
                  <strong>Backend Unavailable:</strong> Unable to connect to HookForge server. (
                  {backendHealth.error || 'Connection refused'}). Switch to Demo Mode to explore with simulated fixtures.
                </span>
              </div>
              <div className="flex items-center gap-2 shrink-0 self-start sm:self-auto">
                <button
                  onClick={() => checkHealth()}
                  className="inline-flex items-center gap-1 text-2xs font-medium text-[#E76B64] hover:text-white bg-[#E76B64]/20 hover:bg-[#E76B64] px-2 py-0.5 rounded cursor-pointer transition-colors"
                >
                  <RefreshCw className="w-2.5 h-2.5" />
                  <span>Retry</span>
                </button>
                <button
                  onClick={toggleMode}
                  className="text-2xs font-semibold text-[#5277D9] hover:text-[#4366C4] underline underline-offset-2 cursor-pointer"
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
          onOpenSearch={() => setSearchOpen(true)}
        />

        {/* Page Viewport */}
        <main className="flex-1 p-3.5 sm:p-6 lg:p-8 max-w-7xl w-full mx-auto min-w-0">
          <Outlet />
        </main>
      </div>

      {/* Global Quick Search Modal */}
      <GlobalSearchModal
        isOpen={searchOpen}
        onClose={() => setSearchOpen(false)}
      />

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
