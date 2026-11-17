import React, { useEffect, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { cn } from '../../utils/cn'

export interface ModalProps {
  isOpen: boolean
  onClose: () => void
  title: string
  description?: string
  children: ReactNode
  footer?: ReactNode
  maxWidth?: 'sm' | 'md' | 'lg' | 'xl' | '2xl'
}

export const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  title,
  description,
  children,
  footer,
  maxWidth = 'md',
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

  const maxWidthClasses = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-lg',
    xl: 'max-w-xl',
    '2xl': 'max-w-2xl',
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs transition-opacity animate-fade-in"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal Dialog */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        className={cn(
          'relative w-full bg-white rounded-xl shadow-xl border border-[#E7E8EC] z-10 flex flex-col max-h-[90vh] overflow-hidden',
          maxWidthClasses[maxWidth]
        )}
      >
        {/* Header */}
        <div className="p-5 pb-4 border-b border-[#E7E8EC] flex items-start justify-between">
          <div>
            <h2 id="modal-title" className="text-base font-semibold text-[#202938]">
              {title}
            </h2>
            {description && <p className="text-xs text-[#64748B] mt-1">{description}</p>}
          </div>
          <button
            onClick={onClose}
            aria-label="Close modal"
            className="text-[#64748B] hover:text-[#202938] rounded-lg p-1 hover:bg-[#F7F6F2] transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 overflow-y-auto space-y-4">{children}</div>

        {/* Footer */}
        {footer && (
          <div className="p-4 px-5 bg-[#F7F6F2] border-t border-[#E7E8EC] flex items-center justify-end gap-2">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}
