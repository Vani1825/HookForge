import React, { useState } from 'react'
import {
  Server,
  Key,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Sparkles,
  Radio,
} from 'lucide-react'
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { useApp } from '../context/AppContext'
import { MOCK_TENANT } from '../mocks/mockData'

export const SettingsPage: React.FC = () => {
  const {
    mode,
    setMode,
    baseUrl,
    setBaseUrl,
    apiKey,
    setApiKey,
    backendHealth,
    checkHealth,
    addToast,
  } = useApp()

  const [inputBaseUrl, setInputBaseUrl] = useState(baseUrl)
  const [inputApiKey, setInputApiKey] = useState(apiKey)
  const [isTesting, setIsTesting] = useState(false)

  const handleSaveConnection = (e: React.FormEvent) => {
    e.preventDefault()
    setBaseUrl(inputBaseUrl.trim())
    setApiKey(inputApiKey.trim())
    addToast({
      title: 'Settings Saved',
      description: 'API base URL and authentication key updated.',
      type: 'success',
    })
    checkHealth()
  }

  const handleTestConnection = async () => {
    setIsTesting(true)
    await checkHealth()
    setIsTesting(false)
    addToast({
      title: 'Health Check Complete',
      description:
        backendHealth.status === 'up'
          ? 'Successfully connected to backend /health.'
          : 'Backend /health check failed.',
      type: backendHealth.status === 'up' ? 'success' : 'error',
    })
  }

  return (
    <div className="space-y-6 text-left max-w-4xl">
      {/* Page Header */}
      <div>
        <h2 className="text-xl font-bold text-slate-900 tracking-tight">Platform Settings</h2>
        <p className="text-xs text-slate-500 mt-0.5">
          Configure backend API endpoints, authentication keys, tenant preferences, and inspect engine tunables.
        </p>
      </div>

      {/* Mode Configuration Card */}
      <Card>
        <CardHeader>
          <CardTitle>Environment Operation Mode</CardTitle>
          <p className="text-xs text-slate-500">
            Switch between interactive simulated demo data and live backend API communication.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div
              onClick={() => setMode('demo')}
              className={`p-4 rounded-xl border-2 transition-all cursor-pointer ${
                mode === 'demo'
                  ? 'border-purple-600 bg-purple-50/50'
                  : 'border-slate-200 hover:border-slate-300 bg-white'
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2 font-semibold text-slate-900 text-sm">
                  <Sparkles className="w-4 h-4 text-purple-600" />
                  <span>Demo Mode</span>
                </div>
                {mode === 'demo' && (
                  <span className="text-2xs font-bold px-2 py-0.5 rounded-full bg-purple-600 text-white">
                    Active
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-600">
                Uses in-memory reactive fixtures matching the database schema. Ideal for frontend exploration,
                UI development, and demos when backend is offline.
              </p>
            </div>

            <div
              onClick={() => setMode('live')}
              className={`p-4 rounded-xl border-2 transition-all cursor-pointer ${
                mode === 'live'
                  ? 'border-emerald-600 bg-emerald-50/50'
                  : 'border-slate-200 hover:border-slate-300 bg-white'
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2 font-semibold text-slate-900 text-sm">
                  <Radio className="w-4 h-4 text-emerald-600" />
                  <span>Live API Mode</span>
                </div>
                {mode === 'live' && (
                  <span className="text-2xs font-bold px-2 py-0.5 rounded-full bg-emerald-600 text-white">
                    Active
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-600">
                Connects directly to the HookForge backend server via HTTP. Communicates with live
                controllers, PostgreSQL queues, and Actuator health probes.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Backend API Connection Configuration */}
      <Card>
        <CardHeader>
          <CardTitle>Backend API Configuration</CardTitle>
          <p className="text-xs text-slate-500">
            Configure the target server URL and credentials used for Live API requests.
          </p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSaveConnection} className="space-y-4">
            <Input
              label="Backend Base URL"
              placeholder="http://localhost:8080"
              value={inputBaseUrl}
              onChange={(e) => setInputBaseUrl(e.target.value)}
              helperText="The host and port where your Express server runs (default: http://localhost:8080)."
              leftIcon={<Server className="w-4 h-4 text-slate-400" />}
            />

            <Input
              label="Tenant API Key (X-Api-Key)"
              type="password"
              placeholder="whkey_..."
              value={inputApiKey}
              onChange={(e) => setInputApiKey(e.target.value)}
              helperText="Tenant authentication token sent in the X-Api-Key header (verified via SHA-256 hash)."
              leftIcon={<Key className="w-4 h-4 text-slate-400" />}
            />

            {/* Health status banner */}
            <div
              className={`p-3.5 rounded-xl border text-xs flex items-center justify-between ${
                backendHealth.status === 'up'
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                  : backendHealth.status === 'down'
                  ? 'bg-rose-50 border-rose-200 text-rose-900'
                  : 'bg-slate-50 border-slate-200 text-slate-700'
              }`}
            >
              <div className="flex items-center gap-2">
                {backendHealth.status === 'up' ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                )}
                <span>
                  <strong>Backend Status:</strong>{' '}
                  {backendHealth.status === 'up'
                    ? 'Connected (GET /health responded 200 OK)'
                    : `Offline (${backendHealth.error || 'Server not reachable'})`}
                </span>
              </div>

              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleTestConnection}
                isLoading={isTesting}
                leftIcon={<RefreshCw className="w-3 h-3" />}
              >
                Test Health
              </Button>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button type="submit" variant="primary" size="sm">
                Save API Preferences
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Tenant Metadata */}
      <Card>
        <CardHeader>
          <CardTitle>Tenant & Organization</CardTitle>
          <p className="text-xs text-slate-500">Tenant identifier and registration metadata</p>
        </CardHeader>
        <CardContent className="space-y-3 text-xs">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
              <span className="text-slate-400 block mb-0.5">Tenant Name</span>
              <span className="font-semibold text-slate-900">{MOCK_TENANT.name}</span>
            </div>

            <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
              <span className="text-slate-400 block mb-0.5">Tenant UUID</span>
              <span className="font-mono text-slate-800 break-all">{MOCK_TENANT.id}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Engine Tunables (From Reference Audit & Config) */}
      <Card>
        <CardHeader>
          <CardTitle>Platform Engine Tunables</CardTitle>
          <p className="text-xs text-slate-500">
            Core architecture parameters defined in <code className="text-slate-700">src/config/index.js</code>
          </p>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
            <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 space-y-1">
              <span className="font-semibold text-slate-800">Retry Policy</span>
              <p className="text-2xs text-slate-500">Max attempts: 8</p>
              <p className="text-2xs text-slate-500">Base delay: 5s (exponential)</p>
              <p className="text-2xs text-slate-500">Max delay ceiling: 1 hour</p>
            </div>

            <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 space-y-1">
              <span className="font-semibold text-slate-800">Dispatcher & Lease</span>
              <p className="text-2xs text-slate-500">Poll interval: 500ms</p>
              <p className="text-2xs text-slate-500">Batch size: 50 deliveries</p>
              <p className="text-2xs text-slate-500">Worker concurrency: 50 slots</p>
              <p className="text-2xs text-slate-500">Lease reaper interval: 15s</p>
            </div>

            <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 space-y-1">
              <span className="font-semibold text-slate-800">Circuit Breaker</span>
              <p className="text-2xs text-slate-500">Failure threshold: 5 consecutive</p>
              <p className="text-2xs text-slate-500">Open duration: 1 minute</p>
              <p className="text-2xs text-slate-500">State: Persistent in PostgreSQL</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
