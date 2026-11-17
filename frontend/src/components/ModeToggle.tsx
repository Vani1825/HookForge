import React from 'react'
import { Sparkles, Radio, RefreshCw } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { cn } from '../utils/cn'

interface ModeToggleProps {
  className?: string
  showStatusBadge?: boolean
}

export const ModeToggle: React.FC<ModeToggleProps> = ({
  className,
  showStatusBadge = true,
}) => {
  const { mode, toggleMode, backendHealth, checkHealth } = useApp()

  const isLive = mode === 'live'

  return (
    <div className={cn('flex items-center gap-2', className)}>
      {/* Contextual Status Badge: Visible on wide desktop (xl+), hidden on tablet/mobile to preserve header space */}
      {showStatusBadge && (
        isLive ? (
          <button
            type="button"
            onClick={() => checkHealth()}
            title="Check Live Backend Health"
            className="hidden xl:inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full border border-[#E7E8EC] bg-white shadow-2xs hover:bg-[#F7F6F2] transition-colors cursor-pointer shrink-0"
          >
            <span
              className={cn(
                'w-2 h-2 rounded-full shrink-0',
                backendHealth.status === 'up'
                  ? 'bg-[#159B78] animate-pulse'
                  : backendHealth.status === 'down'
                  ? 'bg-[#E76B64]'
                  : 'bg-[#E5B34B] animate-spin'
              )}
            />
            <span className="text-[#64748B]">
              {backendHealth.status === 'up'
                ? 'API Online'
                : backendHealth.status === 'down'
                ? 'API Offline'
                : 'Checking API...'}
            </span>
            <RefreshCw className="w-2.5 h-2.5 text-[#64748B] hover:text-[#202938]" />
          </button>
        ) : (
          <div
            className="hidden xl:inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full border border-[#DCE5FA] bg-[#EAF0FF] text-[#5277D9] shadow-2xs select-none shrink-0"
            title="Demo Mode is using local simulated fixtures. Live API is bypassed."
          >
            <Sparkles className="w-3 h-3 text-[#5277D9] shrink-0" />
            <span className="font-semibold">Simulated Data</span>
          </div>
        )
      )}

      {/* Mode Switcher Pill */}
      <div
        className="inline-flex items-center p-0.5 rounded-lg border border-[#E7E8EC] bg-[#F7F6F2] shadow-2xs text-xs shrink-0"
        role="group"
        aria-label="Mode Selector"
      >
        <button
          type="button"
          onClick={() => {
            if (isLive) toggleMode()
          }}
          className={cn(
            'flex items-center gap-1 px-2 sm:px-2.5 py-1 rounded-md font-medium transition-all cursor-pointer text-xs',
            !isLive
              ? 'bg-white text-[#202938] shadow-xs border border-[#E7E8EC] font-semibold'
              : 'text-[#64748B] hover:text-[#202938]'
          )}
          title="Switch to Demo Mode (simulated local data)"
        >
          <Sparkles className={cn('w-3.5 h-3.5', !isLive ? 'text-[#5277D9]' : 'text-[#64748B]')} />
          <span>Demo</span>
        </button>

        <button
          type="button"
          onClick={() => {
            if (!isLive) toggleMode()
          }}
          className={cn(
            'flex items-center gap-1 px-2 sm:px-2.5 py-1 rounded-md font-medium transition-all cursor-pointer text-xs',
            isLive
              ? 'bg-white text-[#202938] shadow-xs border border-[#E7E8EC] font-semibold'
              : 'text-[#64748B] hover:text-[#202938]'
          )}
          title="Switch to Live API Mode (connects to backend)"
        >
          <Radio className={cn('w-3.5 h-3.5', isLive ? 'text-[#159B78]' : 'text-[#64748B]')} />
          <span>Live API</span>
        </button>
      </div>
    </div>
  )
}
