import React from 'react'
import { NavLink } from 'react-router-dom'
import { AlertCircle, ArrowLeft } from 'lucide-react'
import { Button } from '../components/ui/Button'

export const NotFoundPage: React.FC = () => {
  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center text-center p-6 space-y-4">
      <div className="w-16 h-16 rounded-full bg-slate-100 flex items-center justify-center text-slate-400">
        <AlertCircle className="w-8 h-8 text-slate-500" />
      </div>
      <h2 className="text-xl font-bold text-slate-900">Page Not Found</h2>
      <p className="text-xs text-slate-500 max-w-sm">
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
