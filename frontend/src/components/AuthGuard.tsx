import React from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useApp } from '../context/AppContext'

interface AuthGuardProps {
  children?: React.ReactNode
}

export const AuthGuard: React.FC<AuthGuardProps> = ({ children }) => {
  const { isAuthenticated, isLoading } = useAuth()
  const { mode } = useApp()
  const location = useLocation()

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#F7F6F2] flex items-center justify-center p-4">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-3 border-[#5277D9] border-t-transparent rounded-full animate-spin" />
          <span className="text-xs text-[#64748B] font-medium tracking-wide">
            Verifying secure session...
          </span>
        </div>
      </div>
    )
  }

  if (!isAuthenticated && mode !== 'demo') {
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  return <>{children}</>
}
