import React, { useState } from 'react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import { Flame, Mail, Lock, ArrowRight, Sparkles, AlertCircle } from 'lucide-react'
import { Card, CardContent } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { useAuth } from '../context/AuthContext'
import { useApp } from '../context/AppContext'
import { formatErrorMessage } from '../api/client'

export const LoginPage: React.FC = () => {
  const navigate = useNavigate()
  const location = useLocation()
  const { login } = useAuth()
  const { setMode } = useApp()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const from = (location.state as any)?.from?.pathname || '/'

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email.trim() || !password) {
      setError('Please provide both your email address and password.')
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      await login({ email: email.trim(), password })
      navigate(from, { replace: true })
    } catch (err: unknown) {
      setError(formatErrorMessage(err))
    } finally {
      setIsLoading(false)
    }
  }

  const handleDemoMode = () => {
    setMode('demo')
    navigate('/', { replace: true })
  }

  return (
    <div className="min-h-screen bg-[#F7F6F2] flex flex-col justify-between p-4 sm:p-6 text-[#202938]">
      {/* Top Header */}
      <div className="flex items-center justify-between max-w-5xl w-full mx-auto">
        <Link to="/" className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-[#5277D9] text-white flex items-center justify-center shadow-xs">
            <Flame className="w-5 h-5 text-white" />
          </div>
          <span className="font-bold text-[#202938] tracking-tight text-base">HookForge</span>
        </Link>

        <Button
          variant="ghost"
          size="sm"
          onClick={handleDemoMode}
          leftIcon={<Sparkles className="w-3.5 h-3.5 text-[#5277D9]" />}
        >
          Explore Demo Mode
        </Button>
      </div>

      {/* Login Card Form */}
      <div className="max-w-md w-full mx-auto my-8">
        <Card className="bg-white border border-[#E7E8EC] shadow-sm rounded-2xl overflow-hidden">
          <div className="p-6 border-b border-[#E7E8EC] bg-[#F7F6F2]/50 text-center space-y-1">
            <h1 className="text-xl font-bold text-[#202938]">Welcome to HookForge</h1>
            <p className="text-xs text-[#64748B]">Sign in to your multi-tenant workspace</p>
          </div>

          <CardContent className="p-6 space-y-5">
            {error && (
              <div className="p-3 bg-[#FDF1F0] border border-[#E76B64]/30 rounded-xl flex items-start gap-2.5 text-xs text-[#E76B64]">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5 text-left">
                <label className="text-xs font-semibold text-[#202938]" htmlFor="login-email">
                  Work Email
                </label>
                <Input
                  id="login-email"
                  type="email"
                  placeholder="name@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  leftIcon={<Mail className="w-4 h-4 text-[#64748B]" />}
                  required
                />
              </div>

              <div className="space-y-1.5 text-left">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-[#202938]" htmlFor="login-password">
                    Password
                  </label>
                </div>
                <Input
                  id="login-password"
                  type="password"
                  placeholder="••••••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  leftIcon={<Lock className="w-4 h-4 text-[#64748B]" />}
                  required
                />
              </div>

              <Button
                type="submit"
                variant="primary"
                size="md"
                className="w-full justify-center mt-2"
                isLoading={isLoading}
                rightIcon={<ArrowRight className="w-4 h-4" />}
              >
                Sign In to Workspace
              </Button>
            </form>

            <div className="pt-2 border-t border-[#E7E8EC] text-center space-y-3">
              <p className="text-xs text-[#64748B]">
                Don&apos;t have an account yet?{' '}
                <Link to="/register" className="font-semibold text-[#5277D9] hover:underline">
                  Create a workspace
                </Link>
              </p>

              <button
                type="button"
                onClick={handleDemoMode}
                className="text-xs text-[#64748B] hover:text-[#202938] flex items-center justify-center gap-1 mx-auto cursor-pointer"
              >
                <Sparkles className="w-3.5 h-3.5 text-[#5277D9]" />
                <span>Bypass authentication and use local demo mode</span>
              </button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Footer */}
      <footer className="text-center text-2xs text-[#64748B]">
        HookForge SaaS Webhook Management • Chitkara University Academic Project
      </footer>
    </div>
  )
}
