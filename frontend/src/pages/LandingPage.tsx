import React from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  Flame,
  Shield,
  Zap,
  RotateCcw,
  CheckCircle2,
  ArrowRight,
  Sparkles,
} from 'lucide-react'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { useApp } from '../context/AppContext'

export const LandingPage: React.FC = () => {
  const navigate = useNavigate()
  const { setMode } = useApp()

  const handleTryDemo = () => {
    setMode('demo')
    navigate('/')
  }

  return (
    <div className="min-h-screen bg-[#F7F6F2] text-[#202938] flex flex-col justify-between">
      {/* Navigation Header */}
      <header className="h-16 bg-white border-b border-[#E7E8EC] px-4 sm:px-8 flex items-center justify-between sticky top-0 z-20">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-[#5277D9] text-white flex items-center justify-center shadow-xs">
            <Flame className="w-5 h-5 text-white" />
          </div>
          <span className="font-bold text-[#202938] tracking-tight text-base">HookForge</span>
          <span className="ml-2 text-3xs font-semibold px-2 py-0.5 rounded-full bg-[#EAF0FF] text-[#5277D9] border border-[#DCE5FA]">
            SaaS Platform
          </span>
        </div>

        <div className="flex items-center gap-2.5">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleTryDemo}
            leftIcon={<Sparkles className="w-3.5 h-3.5 text-[#5277D9]" />}
          >
            Explore Demo
          </Button>
          <Link to="/login">
            <Button variant="outline" size="sm">
              Log In
            </Button>
          </Link>
          <Link to="/register">
            <Button variant="primary" size="sm" rightIcon={<ArrowRight className="w-3.5 h-3.5" />}>
              Get Started
            </Button>
          </Link>
        </div>
      </header>

      {/* Hero Section */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-8 py-12 sm:py-16 space-y-16">
        <section className="text-center space-y-6 max-w-3xl mx-auto">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#EAF0FF] text-[#5277D9] border border-[#DCE5FA] text-xs font-semibold">
            <Zap className="w-3.5 h-3.5 text-[#5277D9]" />
            Enterprise-Grade Multi-Tenant Webhook Management
          </div>

          <h1 className="text-3xl sm:text-5xl font-extrabold tracking-tight text-[#202938] leading-tight">
            Reliable, secure webhooks for modern applications
          </h1>

          <p className="text-sm sm:text-base text-[#64748B] leading-relaxed">
            Manage your webhook lifecycle with automated exponential backoff, circuit breaking,
            dead letter queues, continuous time-series metrics, and robust tenant isolation.
          </p>

          <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
            <Link to="/register">
              <Button variant="primary" size="lg" rightIcon={<ArrowRight className="w-4 h-4" />}>
                Create Your Workspace
              </Button>
            </Link>
            <Button
              variant="outline"
              size="lg"
              onClick={handleTryDemo}
              leftIcon={<Sparkles className="w-4 h-4 text-[#5277D9]" />}
            >
              Interactive Sandbox Demo
            </Button>
          </div>
        </section>

        {/* Feature Highlights Grid */}
        <section className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Card className="p-6 bg-white space-y-3">
            <div className="w-10 h-10 rounded-xl bg-[#EAF0FF] text-[#5277D9] flex items-center justify-center mb-4">
              <Zap className="w-5 h-5" />
            </div>
            <h2 className="text-base font-bold text-[#202938]">High-Throughput Ingestion</h2>
            <p className="text-xs text-[#64748B] leading-relaxed">
              Durable asynchronous event processing backed by PostgreSQL with sub-millisecond
              idempotency locking and HMAC-SHA256 signature verification.
            </p>
          </Card>

          <Card className="p-6 bg-white space-y-3">
            <div className="w-10 h-10 rounded-xl bg-[#FDF8EB] text-[#B8871E] flex items-center justify-center mb-4">
              <RotateCcw className="w-5 h-5" />
            </div>
            <h2 className="text-base font-bold text-[#202938]">Resilience & DLQ Replay</h2>
            <p className="text-xs text-[#64748B] leading-relaxed">
              Configurable exponential backoff with full jitter, circuit breakers to protect unhealthy
              destinations, and manual or bulk dead letter replays.
            </p>
          </Card>

          <Card className="p-6 bg-white space-y-3">
            <div className="w-10 h-10 rounded-xl bg-[#E8F8F3] text-[#159B78] flex items-center justify-center mb-4">
              <Shield className="w-5 h-5" />
            </div>
            <h2 className="text-base font-bold text-[#202938]">Strict Multi-Tenant SaaS</h2>
            <p className="text-xs text-[#64748B] leading-relaxed">
              Every workspace is completely isolated with its own scoped API keys, webhook endpoints,
              delivery logs, and role-based access control.
            </p>
          </Card>
        </section>

        {/* System Capabilities Section */}
        <section className="bg-white border border-[#E7E8EC] rounded-2xl p-6 sm:p-10 space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#E7E8EC] pb-6">
            <div>
              <h2 className="text-lg font-bold text-[#202938]">Production-Ready Webhook Engine</h2>
              <p className="text-xs text-[#64748B]">Designed for high reliability and faculty demonstration at Chitkara University.</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-[#159B78] animate-pulse" />
              <span className="text-xs font-semibold text-[#159B78]">Backend API Online</span>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 text-xs">
            <div className="flex items-start gap-2.5">
              <CheckCircle2 className="w-4 h-4 text-[#159B78] shrink-0 mt-0.5" />
              <span>Full Delivery Inspector & Latency Logs</span>
            </div>
            <div className="flex items-start gap-2.5">
              <CheckCircle2 className="w-4 h-4 text-[#159B78] shrink-0 mt-0.5" />
              <span>Continuous 24h Time-Series Analytics</span>
            </div>
            <div className="flex items-start gap-2.5">
              <CheckCircle2 className="w-4 h-4 text-[#159B78] shrink-0 mt-0.5" />
              <span>Bulk DLQ Replay & Scheduled Deliveries</span>
            </div>
            <div className="flex items-start gap-2.5">
              <CheckCircle2 className="w-4 h-4 text-[#159B78] shrink-0 mt-0.5" />
              <span>Workspace API Key Lifecycle Management</span>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="h-14 bg-white border-t border-[#E7E8EC] px-4 sm:px-8 flex items-center justify-between text-2xs text-[#64748B]">
        <span>HookForge — Chitkara University Academic Project (BEE-II)</span>
        <span>React 19 • Express 5 • PostgreSQL 16 • Docker</span>
      </footer>
    </div>
  )
}
