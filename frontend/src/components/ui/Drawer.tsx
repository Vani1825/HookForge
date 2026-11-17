import React, { useEffect, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { cn } from '../../utils/cn'

export interface DrawerProps {
  isOpen: boolean
  onClose: () => void
  title: string
  subtitle?: string
  children: ReactNode
  footer?: ReactNode
  width?: 'md' | 'lg' | 'xl' | '2xl'
}

export const Drawer: React.FC<DrawerProps> = ({
  isOpen,
  onClose,
  title,
  subtitle,
  children,
  footer,
  width = 'lg',
}) => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    if (isOpen) {
      document.body.style.overflow = 'hidden'
      window.addEventListener('keydown', handleKeyDown)
    }
    return () => {
      document.body.style.overflow = 'unset'
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen, onClose])

  if (!isOpen) return null

  const widthClasses = {
    md: 'w-full max-w-full sm:max-w-md',
    lg: 'w-full max-w-full sm:max-w-lg',
    xl: 'w-full max-w-full sm:max-w-xl',
    '2xl': 'w-full max-w-full sm:max-w-2xl',
  }

  return (
    <div className="fixed inset-0 z-50 overflow-hidden">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs transition-opacity duration-200"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Slide-out drawer container */}
      <div className="fixed inset-y-0 right-0 flex max-w-full pl-0 sm:pl-10">
        <div
          role="dialog"
          aria-modal="true"
          className={cn(
            'w-screen bg-white shadow-2xl border-l border-[#E7E8EC] flex flex-col justify-between transform transition duration-300 ease-in-out',
            widthClasses[width]
          )}
        >
          {/* Header */}
          <div className="p-4 sm:p-5 border-b border-[#E7E8EC] flex items-start justify-between bg-[#F7F6F2] gap-2">
            <div className="min-w-0 pr-2">
              <h2 className="text-base font-semibold text-[#202938] truncate">{title}</h2>
              {subtitle && <p className="text-xs text-[#64748B] mt-0.5 truncate">{subtitle}</p>}
            </div>
            <button
              onClick={onClose}
              aria-label="Close drawer"
              className="text-[#64748B] hover:text-[#202938] rounded-lg p-1.5 hover:bg-white transition-colors cursor-pointer shrink-0"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Scrollable Content */}
          <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4 sm:space-y-6">{children}</div>

          {/* Footer */}
          {footer && (
            <div className="p-3 sm:p-4 px-4 sm:px-6 bg-[#F7F6F2] border-t border-[#E7E8EC] flex flex-wrap items-center justify-end gap-2 sm:gap-3">
              {footer}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
