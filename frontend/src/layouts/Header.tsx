import { Menu, Plus, Send } from 'lucide-react'
import { ModeToggle } from '../components/ModeToggle'
import { Button } from '../components/ui/Button'
import { useLocation } from 'react-router-dom'

interface HeaderProps {
  onOpenMobileMenu: () => void
  onOpenSendEvent: () => void
  onOpenAddEndpoint: () => void
}

export const Header: React.FC<HeaderProps> = ({
  onOpenMobileMenu,
  onOpenSendEvent,
  onOpenAddEndpoint,
}) => {
  const location = useLocation()

  const getPageTitle = (pathname: string) => {
    switch (pathname) {
      case '/':
        return 'System Overview'
      case '/endpoints':
        return 'Webhook Endpoints'
      case '/events':
        return 'Event Explorer'
      case '/deliveries':
        return 'Delivery Pipeline'
      case '/dead-letters':
        return 'Dead Letter Deliveries'
      case '/replay':
        return 'Replay Queue'
      case '/analytics':
        return 'Delivery Analytics'
      case '/settings':
        return 'Platform Settings'
      default:
        return 'HookForge'
    }
  }

  const title = getPageTitle(location.pathname)

  return (
    <header className="h-16 bg-white border-b border-slate-200/90 px-4 sm:px-6 flex items-center justify-between gap-4 sticky top-0 z-30">
      {/* Left: Mobile Toggle & Page Title */}
      <div className="flex items-center gap-3">
        <button
          onClick={onOpenMobileMenu}
          className="lg:hidden p-2 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-lg cursor-pointer"
          aria-label="Open sidebar"
        >
          <Menu className="w-5 h-5" />
        </button>

        <div className="flex flex-col">
          <div className="flex items-center gap-2 text-2xs text-slate-400">
            <span>HookForge</span>
            <span>/</span>
            <span className="text-slate-600 font-medium">{title}</span>
          </div>
          <h1 className="text-base font-bold text-slate-900 tracking-tight leading-none mt-0.5">
            {title}
          </h1>
        </div>
      </div>

      {/* Right: Quick Actions & Mode Toggle */}
      <div className="flex items-center gap-2 sm:gap-3">
        {/* Quick Dispatch Event button */}
        <Button
          variant="outline"
          size="sm"
          onClick={onOpenSendEvent}
          leftIcon={<Send className="w-3.5 h-3.5 text-slate-500" />}
          className="hidden md:inline-flex"
        >
          Send Event
        </Button>

        {/* Quick Add Endpoint button */}
        <Button
          variant="primary"
          size="sm"
          onClick={onOpenAddEndpoint}
          leftIcon={<Plus className="w-3.5 h-3.5" />}
        >
          <span className="hidden sm:inline">Add Endpoint</span>
          <span className="sm:hidden">Add</span>
        </Button>

        <div className="h-5 w-px bg-slate-200 hidden sm:block mx-1" />

        {/* Live / Demo Mode Switcher */}
        <ModeToggle />
      </div>
    </header>
  )
}
