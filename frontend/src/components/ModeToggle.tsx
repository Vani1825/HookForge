import React from 'react'
import { Sparkles, Radio, RefreshCw } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { cn } from '../utils/cn'

export const ModeToggle: React.FC = () => {
  const { mode, toggleMode, backendHealth, checkHealth } = useApp()

  const isLive = mode === 'live'

  return (
    <div className="flex items-center gap-2">
      {/* Backend API status ping (in live mode or always for info) */}
      <button
        onClick={() => checkHealth()}
        title="Check Backend Health"
        className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full border bg-white shadow-2xs hover:bg-slate-50 transition-colors cursor-pointer"
      >
        <span
          className={cn(
            'w-2 h-2 rounded-full',
            backendHealth.status === 'up'
              ? 'bg-emerald-500 animate-pulse'
              : backendHealth.status === 'down'
              ? 'bg-rose-500'
              : 'bg-amber-400 animate-spin'
          )}
        />
        <span className="text-slate-600">
          {backendHealth.status === 'up' ? 'API Online' : backendHealth.status === 'down' ? 'API Offline' : 'Checking API...'}
        </span>
        <RefreshCw className="w-2.5 h-2.5 text-slate-400 hover:text-slate-600" />
      </button>

      {/* Mode Switcher Pill */}
      <div
        className="inline-flex items-center p-0.5 rounded-lg border border-slate-200 bg-slate-100 shadow-2xs text-xs"
        role="group"
        aria-label="Mode Selector"
      >
        <button
          type="button"
          onClick={() => {
            if (isLive) toggleMode()
          }}
          className={cn(
            'flex items-center gap-1.5 px-2.5 py-1 rounded-md font-medium transition-all cursor-pointer',
            !isLive
              ? 'bg-white text-slate-900 shadow-xs border border-slate-200/80'
              : 'text-slate-600 hover:text-slate-900'
          )}
        >
          <Sparkles className="w-3.5 h-3.5 text-purple-600" />
          <span>Demo Mode</span>
        </button>

        <button
          type="button"
          onClick={() => {
            if (!isLive) toggleMode()
          }}
          className={cn(
            'flex items-center gap-1.5 px-2.5 py-1 rounded-md font-medium transition-all cursor-pointer',
            isLive
              ? 'bg-white text-slate-900 shadow-xs border border-slate-200/80'
              : 'text-slate-600 hover:text-slate-900'
          )}
        >
          <Radio className="w-3.5 h-3.5 text-emerald-600" />
          <span>Live API</span>
        </button>
      </div>
    </div>
  )
}
