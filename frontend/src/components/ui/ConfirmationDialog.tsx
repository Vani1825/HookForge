import React, { useEffect, useState, type ReactNode } from 'react'
import {
  AlertTriangle,
  AlertCircle,
  Info,
  Trash2,
  X,
} from 'lucide-react'
import { Button } from './Button'
import { cn } from '../../utils/cn'

export type ConfirmationVariant = 'danger' | 'warning' | 'neutral'

export interface ConfirmationDialogProps {
  isOpen: boolean
  onClose: () => void
  onConfirm: () => void | Promise<void>
  title: string
  description?: string
  confirmText?: string
  cancelText?: string
  variant?: ConfirmationVariant
  isLoading?: boolean
  error?: string | null
  icon?: ReactNode
  confirmButtonVariant?: 'primary' | 'danger' | 'outline' | 'secondary'
  children?: ReactNode
}

export const ConfirmationDialog: React.FC<ConfirmationDialogProps> = ({
  isOpen,
  onClose,
  onConfirm,
  title,
  description,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  variant = 'danger',
  isLoading: externalIsLoading,
  error: externalError,
  icon,
  confirmButtonVariant,
  children,
}) => {
  const [internalLoading, setInternalLoading] = useState(false)
  const [internalError, setInternalError] = useState<string | null>(null)

  const isLoading = externalIsLoading !== undefined ? externalIsLoading : internalLoading
  const error = externalError !== undefined ? externalError : internalError

  // Reset internal state when dialog opens or closes
  useEffect(() => {
    if (!isOpen) {
      setInternalLoading(false)
      setInternalError(null)
    }
  }, [isOpen])

  // Handle Escape key and body scroll lock
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isLoading) {
        onClose()
      }
    }

    if (isOpen) {
      document.body.style.overflow = 'hidden'
      window.addEventListener('keydown', handleKeyDown)
    }

    return () => {
      document.body.style.overflow = 'unset'
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen, isLoading, onClose])

  if (!isOpen) return null

  const handleBackdropClick = () => {
    if (!isLoading) {
      onClose()
    }
  }

  const handleConfirmClick = async () => {
    if (isLoading) return

    try {
      setInternalLoading(true)
      setInternalError(null)
      await onConfirm()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Operation failed. Please try again.'
      setInternalError(msg)
    } finally {
      setInternalLoading(false)
    }
  }

  const getVariantStyles = () => {
    switch (variant) {
      case 'danger':
        return {
          iconBg: 'bg-[#FDF1F0] text-[#E76B64] border border-[#E76B64]/20',
          defaultIcon: <Trash2 className="w-5 h-5 text-[#E76B64]" />,
          btnVariant: 'danger' as const,
        }
      case 'warning':
        return {
          iconBg: 'bg-[#FDF8EB] text-[#B48418] border border-[#E5B34B]/30',
          defaultIcon: <AlertTriangle className="w-5 h-5 text-[#B48418]" />,
          btnVariant: 'primary' as const,
          customConfirmClass:
            'bg-[#E5B34B] hover:bg-[#D4A23A] text-white border border-[#E5B34B] focus-visible:ring-[#E5B34B]',
        }
      case 'neutral':
      default:
        return {
          iconBg: 'bg-[#EAF0FF] text-[#5277D9] border border-[#5277D9]/20',
          defaultIcon: <Info className="w-5 h-5 text-[#5277D9]" />,
          btnVariant: 'primary' as const,
        }
    }
  }

  const { iconBg, defaultIcon, btnVariant, customConfirmClass } = getVariantStyles()
  const resolvedButtonVariant = confirmButtonVariant || btnVariant

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs transition-opacity animate-fade-in"
        onClick={handleBackdropClick}
        aria-hidden="true"
      />

      {/* Confirmation Dialog Box */}
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirmation-dialog-title"
        aria-describedby="confirmation-dialog-description"
        className="relative w-full max-w-md bg-white rounded-2xl shadow-2xl border border-[#E7E8EC] z-10 flex flex-col my-auto overflow-hidden animate-scale-up text-left"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header with Variant Icon & Close Button */}
        <div className="p-4 sm:p-5 pb-0 flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <div
              className={cn(
                'w-10 h-10 rounded-xl flex items-center justify-center shrink-0 shadow-2xs',
                iconBg
              )}
            >
              {icon || defaultIcon}
            </div>
            <div className="min-w-0 pt-0.5">
              <h2
                id="confirmation-dialog-title"
                className="text-base font-bold text-[#202938] leading-tight"
              >
                {title}
              </h2>
            </div>
          </div>

          <button
            onClick={onClose}
            disabled={isLoading}
            aria-label="Close dialog"
            className="text-[#64748B] hover:text-[#202938] rounded-lg p-1.5 hover:bg-[#F7F6F2] transition-colors cursor-pointer shrink-0 disabled:opacity-40 disabled:pointer-events-none"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-4 sm:p-5 space-y-3">
          {description && (
            <p
              id="confirmation-dialog-description"
              className="text-xs text-[#64748B] leading-relaxed"
            >
              {description}
            </p>
          )}

          {/* Error Message Alert */}
          {error && (
            <div
              role="alert"
              className="p-3 bg-[#FDF1F0] border border-[#E76B64]/25 rounded-xl flex items-start gap-2 text-xs text-[#E76B64] animate-fade-in"
            >
              <AlertCircle className="w-4 h-4 text-[#E76B64] shrink-0 mt-0.5" />
              <span className="leading-relaxed flex-1">{error}</span>
            </div>
          )}

          {/* Optional Children/Body Slot */}
          {children && <div className="pt-1">{children}</div>}
        </div>

        {/* Footer Actions */}
        <div className="p-4 sm:p-5 pt-3 bg-[#F7F6F2] border-t border-[#E7E8EC] flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onClose}
            disabled={isLoading}
            className="w-full sm:w-auto text-xs"
          >
            {cancelText}
          </Button>

          <Button
            type="button"
            variant={resolvedButtonVariant}
            size="sm"
            onClick={handleConfirmClick}
            disabled={isLoading}
            isLoading={isLoading}
            className={cn('w-full sm:w-auto text-xs font-semibold', customConfirmClass)}
          >
            {confirmText}
          </Button>
        </div>
      </div>
    </div>
  )
}
