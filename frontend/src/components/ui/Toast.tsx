import React from 'react'
import { CheckCircle2, AlertTriangle, AlertCircle, Info, X } from 'lucide-react'
import { useApp } from '../../context/AppContext'
import { cn } from '../../utils/cn'

export const ToastContainer: React.FC = () => {
  const { toasts, removeToast } = useApp()

  if (toasts.length === 0) return null

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none">
      {toasts.map((toast) => {
        const icons = {
          success: <CheckCircle2 className="w-5 h-5 text-[#159B78] shrink-0" />,
          warning: <AlertTriangle className="w-5 h-5 text-[#E5B34B] shrink-0" />,
          error: <AlertCircle className="w-5 h-5 text-[#E76B64] shrink-0" />,
          info: <Info className="w-5 h-5 text-[#5277D9] shrink-0" />,
        }

        const borderColors = {
          success: 'border-[#159B78]/30 bg-white',
          warning: 'border-[#E5B34B]/30 bg-white',
          error: 'border-[#E76B64]/30 bg-white',
          info: 'border-[#5277D9]/30 bg-white',
        }

        return (
          <div
            key={toast.id}
            className={cn(
              'pointer-events-auto flex items-start gap-3 p-4 rounded-xl border shadow-lg transition-all animate-slide-up',
              borderColors[toast.type]
            )}
          >
            {icons[toast.type]}
            <div className="flex-1 min-w-0 text-left">
              <h4 className="text-xs font-semibold text-[#202938]">{toast.title}</h4>
              {toast.description && (
                <p className="text-xs text-[#64748B] mt-0.5 line-clamp-2">{toast.description}</p>
              )}
            </div>
            <button
              onClick={() => removeToast(toast.id)}
              className="text-[#64748B] hover:text-[#202938] rounded p-1 hover:bg-[#F7F6F2] transition-colors cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )
      })}
    </div>
  )
}
