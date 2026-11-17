import React from 'react'
import { NavLink } from 'react-router-dom'
import { AlertCircle, ArrowLeft } from 'lucide-react'
import { Button } from '../components/ui/Button'

export const NotFoundPage: React.FC = () => {
  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center text-center p-6 space-y-4">
      <div className="w-16 h-16 rounded-2xl bg-[#EAF0FF] flex items-center justify-center text-[#5277D9] border border-[#DCE5FA] shadow-xs">
        <AlertCircle className="w-8 h-8 text-[#5277D9]" />
      </div>
      <h2 className="text-xl font-bold text-[#202938] tracking-tight">Page Not Found</h2>
      <p className="text-xs text-[#64748B] max-w-sm">
        The page you are looking for does not exist or has been moved in the HookForge navigation hierarchy.
      </p>
      <NavLink to="/">
        <Button variant="primary" size="sm" leftIcon={<ArrowLeft className="w-3.5 h-3.5" />}>
          Back to Dashboard
        </Button>
      </NavLink>
    </div>
  )
}
