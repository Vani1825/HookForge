import React, { useState, useEffect, useCallback } from 'react'
import {
  Server,
  Key,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Sparkles,
  Radio,
  Plus,
  Copy,
  Check,
  Building,
  User as UserIcon,
} from 'lucide-react'
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { PageHeader } from '../components/ui/PageHeader'
import { Input } from '../components/ui/Input'
import { ConfirmationDialog } from '../components/ui/ConfirmationDialog'
import { useApp } from '../context/AppContext'
import { useAuth } from '../context/AuthContext'
import { MOCK_TENANT } from '../mocks/mockData'
import * as authApi from '../api/auth'
import type { ApiKeyItem } from '../types/auth'
import { formatRelativeTime } from '../utils/formatters'

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

  const { user, currentWorkspace, workspaces, switchWorkspace } = useAuth()

  const [inputBaseUrl, setInputBaseUrl] = useState(baseUrl)
  const [inputApiKey, setInputApiKey] = useState(apiKey)
  const [isTesting, setIsTesting] = useState(false)
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false)

  // API Key Management State
  const [apiKeys, setApiKeys] = useState<ApiKeyItem[]>([])
  const [isLoadingKeys, setIsLoadingKeys] = useState(false)
  const [newKeyModalOpen, setNewKeyModalOpen] = useState(false)
  const [newKeyName, setNewKeyName] = useState('')
  const [isGeneratingKey, setIsGeneratingKey] = useState(false)
  const [createdKeyRaw, setCreatedKeyRaw] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [keyToRevoke, setKeyToRevoke] = useState<ApiKeyItem | null>(null)

  const loadApiKeys = useCallback(async () => {
    if (mode === 'demo') {
      setApiKeys([
        {
          id: 'demo-key-1',
          name: 'Default Demo Key',
          keyPrefix: 'whkey_demo1234',
          createdAt: new Date(Date.now() - 86400000).toISOString(),
          lastUsedAt: new Date().toISOString(),
          revokedAt: null,
        },
      ])
      return
    }

    setIsLoadingKeys(true)
    try {
      const keys = await authApi.fetchApiKeys()
      setApiKeys(keys)
    } catch {
      // Graceful fallback if unauthenticated or error
      setApiKeys([])
    } finally {
      setIsLoadingKeys(false)
    }
  }, [mode])

  useEffect(() => {
    loadApiKeys()
  }, [loadApiKeys])

  const handleResetSettings = () => {
    const defaultUrl = 'http://localhost:8081'
    const defaultKey = ''
    setInputBaseUrl(defaultUrl)
    setInputApiKey(defaultKey)
    setBaseUrl(defaultUrl)
    setApiKey(defaultKey)
    addToast({
      title: 'Settings Reset',
      description: 'API base URL and authentication key restored to default values.',
      type: 'info',
    })
    checkHealth()
    setResetConfirmOpen(false)
  }

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

  const handleGenerateKey = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newKeyName.trim()) return

    setIsGeneratingKey(true)
    try {
      if (mode === 'demo') {
        const fakeKey = `whkey_${Math.random().toString(36).substring(2)}${Math.random().toString(36).substring(2)}`
        setCreatedKeyRaw(fakeKey)
        setApiKeys((prev) => [
          {
            id: `demo-key-${Date.now()}`,
            name: newKeyName.trim(),
            keyPrefix: fakeKey.substring(0, 12),
            createdAt: new Date().toISOString(),
            lastUsedAt: null,
            revokedAt: null,
          },
          ...prev,
        ])
      } else {
        const res = await authApi.createApiKey(newKeyName.trim())
        setCreatedKeyRaw(res.apiKey)
        await loadApiKeys()
      }
      addToast({
        title: 'API Key Created',
        description: 'New workspace API key generated successfully.',
        type: 'success',
      })
    } catch (err: unknown) {
      addToast({
        title: 'Key Generation Failed',
        description: 'Could not generate API key.',
        type: 'error',
      })
    } finally {
      setIsGeneratingKey(false)
    }
  }

  const handleCopyKey = () => {
    if (!createdKeyRaw) return
    navigator.clipboard.writeText(createdKeyRaw)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
    addToast({
      title: 'Copied to Clipboard',
      description: 'API key copied successfully.',
      type: 'info',
    })
  }

  const handleRevokeKey = async () => {
    if (!keyToRevoke) return
    try {
      if (mode === 'demo') {
        setApiKeys((prev) =>
          prev.map((k) => (k.id === keyToRevoke.id ? { ...k, revokedAt: new Date().toISOString() } : k))
        )
      } else {
        await authApi.revokeApiKey(keyToRevoke.id)
        await loadApiKeys()
      }
      addToast({
        title: 'Key Revoked',
        description: `API key "${keyToRevoke.name}" has been revoked.`,
        type: 'warning',
      })
    } catch {
      addToast({
        title: 'Revocation Failed',
        description: 'Could not revoke API key.',
        type: 'error',
      })
    } finally {
      setKeyToRevoke(null)
    }
  }

  return (
    <div className="space-y-6 text-left max-w-4xl">
      {/* Page Header */}
      <PageHeader
        title="Platform Settings"
        description="Configure backend API endpoints, authentication keys, tenant preferences, and inspect engine tunables."
      />

      {/* Mode Configuration Card */}
      <Card>
        <CardHeader className="bg-[#F7F6F2] border-b border-[#E7E8EC] py-3.5">
          <CardTitle>Environment Operation Mode</CardTitle>
          <p className="text-xs text-[#64748B]">
            Switch between interactive simulated demo data and live backend API communication.
          </p>
        </CardHeader>
        <CardContent className="space-y-4 p-4 sm:p-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div
              onClick={() => setMode('demo')}
              className={`p-4 rounded-xl border-2 transition-all cursor-pointer ${
                mode === 'demo'
                  ? 'border-[#5277D9] bg-[#EAF0FF]/50'
                  : 'border-[#E7E8EC] hover:border-[#D1D5DB] bg-white'
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2 font-semibold text-[#202938] text-sm">
                  <Sparkles className="w-4 h-4 text-[#5277D9]" />
                  <span>Demo Mode</span>
                </div>
                {mode === 'demo' && (
                  <span className="text-2xs font-semibold px-2 py-0.5 rounded-full bg-[#5277D9] text-white">
                    Active
                  </span>
                )}
              </div>
              <p className="text-xs text-[#64748B]">
                Uses in-memory reactive fixtures matching the database schema. Ideal for frontend exploration,
                UI development, and demos when backend is offline.
              </p>
            </div>

            <div
              onClick={() => setMode('live')}
              className={`p-4 rounded-xl border-2 transition-all cursor-pointer ${
                mode === 'live'
                  ? 'border-[#159B78] bg-[#159B78]/10'
                  : 'border-[#E7E8EC] hover:border-[#D1D5DB] bg-white'
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2 font-semibold text-[#202938] text-sm">
                  <Radio className="w-4 h-4 text-[#159B78]" />
                  <span>Live API Mode</span>
                </div>
                {mode === 'live' && (
                  <span className="text-2xs font-semibold px-2 py-0.5 rounded-full bg-[#159B78] text-white">
                    Active
                  </span>
                )}
              </div>
              <p className="text-xs text-[#64748B]">
                Connects directly to the HookForge backend server via HTTP. Communicates with live
                controllers, PostgreSQL queues, and Actuator health probes.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Workspace & Account Details Card */}
      <Card>
        <CardHeader className="bg-[#F7F6F2] border-b border-[#E7E8EC] py-3.5 flex flex-row items-center justify-between">
          <div>
            <CardTitle>Workspace & Account Details</CardTitle>
            <p className="text-xs text-[#64748B]">Active tenant context and role memberships</p>
          </div>
          {currentWorkspace && (
            <span className="text-2xs font-semibold px-2.5 py-1 rounded-full bg-[#EAF0FF] text-[#5277D9] border border-[#DCE5FA]">
              {currentWorkspace.role}
            </span>
          )}
        </CardHeader>
        <CardContent className="space-y-4 text-xs p-4 sm:p-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="p-3 bg-[#F7F6F2] rounded-lg border border-[#E7E8EC]">
              <div className="flex items-center gap-2 text-[#64748B] mb-1">
                <Building className="w-3.5 h-3.5" />
                <span>Current Workspace</span>
              </div>
              <span className="font-semibold text-[#202938] text-sm">
                {currentWorkspace?.name || MOCK_TENANT.name}
              </span>
            </div>

            <div className="p-3 bg-[#F7F6F2] rounded-lg border border-[#E7E8EC]">
              <div className="flex items-center gap-2 text-[#64748B] mb-1">
                <UserIcon className="w-3.5 h-3.5" />
                <span>Signed-in User</span>
              </div>
              <span className="font-semibold text-[#202938]">
                {user ? `${user.fullName} (${user.email})` : 'Developer Admin'}
              </span>
            </div>

            <div className="p-3 bg-[#F7F6F2] rounded-lg border border-[#E7E8EC] sm:col-span-2">
              <span className="text-[#64748B] block mb-1">Workspace Tenant ID</span>
              <span className="font-mono text-2xs text-[#202938] break-all select-all">
                {currentWorkspace?.id || MOCK_TENANT.id}
              </span>
            </div>
          </div>

          {workspaces.length > 1 && (
            <div className="pt-2">
              <label className="text-xs font-semibold text-[#202938] block mb-1.5">
                Switch Active Workspace
              </label>
              <div className="flex flex-wrap gap-2">
                {workspaces.map((ws) => (
                  <button
                    key={ws.id}
                    type="button"
                    onClick={() => switchWorkspace(ws.id)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
                      ws.id === currentWorkspace?.id
                        ? 'bg-[#5277D9] text-white border-[#5277D9]'
                        : 'bg-white text-[#64748B] border-[#E7E8EC] hover:bg-[#F7F6F2]'
                    }`}
                  >
                    {ws.name} ({ws.role})
                  </button>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Workspace API Keys Management Card */}
      <Card>
        <CardHeader className="bg-[#F7F6F2] border-b border-[#E7E8EC] py-3.5 flex flex-row items-center justify-between">
          <div>
            <CardTitle>Workspace API Keys</CardTitle>
            <p className="text-xs text-[#64748B]">
              Authenticate external webhook senders via <code className="font-mono text-[#202938]">Authorization: Bearer &lt;key&gt;</code> or <code className="font-mono text-[#202938]">X-Api-Key</code>
            </p>
          </div>
          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={() => {
              setCreatedKeyRaw(null)
              setNewKeyName('')
              setNewKeyModalOpen(true)
            }}
            leftIcon={<Plus className="w-3.5 h-3.5" />}
          >
            Generate Key
          </Button>
        </CardHeader>
        <CardContent className="p-4 sm:p-5">
          {isLoadingKeys ? (
            <div className="py-6 text-center text-xs text-[#64748B]">Loading workspace API keys...</div>
          ) : apiKeys.length === 0 ? (
            <div className="py-6 text-center text-xs text-[#64748B] space-y-1">
              <p className="font-semibold text-[#202938]">No API Keys Found</p>
              <p>Generate an API key to send webhooks to HookForge endpoints.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-[#F7F6F2] border-b border-[#E7E8EC] text-[#64748B] font-semibold">
                  <tr>
                    <th className="py-2.5 px-3">Key Name</th>
                    <th className="py-2.5 px-3">Prefix</th>
                    <th className="py-2.5 px-3">Created</th>
                    <th className="py-2.5 px-3">Last Used</th>
                    <th className="py-2.5 px-3">Status</th>
                    <th className="py-2.5 px-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E7E8EC]">
                  {apiKeys.map((keyItem) => {
                    const isRevoked = Boolean(keyItem.revokedAt)
                    return (
                      <tr key={keyItem.id} className="hover:bg-[#F7F6F2]/60 transition-colors">
                        <td className="py-2.5 px-3 font-semibold text-[#202938]">{keyItem.name}</td>
                        <td className="py-2.5 px-3 font-mono text-[#64748B]">{keyItem.keyPrefix}••••••••</td>
                        <td className="py-2.5 px-3 text-[#64748B]">{formatRelativeTime(keyItem.createdAt)}</td>
                        <td className="py-2.5 px-3 text-[#64748B]">
                          {keyItem.lastUsedAt ? formatRelativeTime(keyItem.lastUsedAt) : 'Never'}
                        </td>
                        <td className="py-2.5 px-3">
                          <span
                            className={`px-2 py-0.5 rounded-full text-3xs font-semibold ${
                              isRevoked
                                ? 'bg-[#FDF1F0] text-[#E76B64] border border-[#E76B64]/20'
                                : 'bg-[#E8F8F3] text-[#159B78] border border-[#159B78]/20'
                            }`}
                          >
                            {isRevoked ? 'Revoked' : 'Active'}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          {!isRevoked && (
                            <button
                              type="button"
                              onClick={() => setKeyToRevoke(keyItem)}
                              className="text-xs text-[#E76B64] hover:text-[#D9564F] hover:underline cursor-pointer"
                            >
                              Revoke
                            </button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Backend API Connection Configuration */}
      <Card>
        <CardHeader className="bg-[#F7F6F2] border-b border-[#E7E8EC] py-3.5">
          <CardTitle>Backend Server & Dev Credentials</CardTitle>
          <p className="text-xs text-[#64748B]">
            Configure the target server URL and global credentials used for local developer overrides.
          </p>
        </CardHeader>
        <CardContent className="p-4 sm:p-5">
          <form onSubmit={handleSaveConnection} className="space-y-4">
            <Input
              label="Backend Base URL"
              placeholder="http://localhost:8081"
              value={inputBaseUrl}
              onChange={(e) => setInputBaseUrl(e.target.value)}
              helperText="The host and port where your Express server runs (default: http://localhost:8081)."
              leftIcon={<Server className="w-4 h-4 text-[#64748B]" />}
            />

            <Input
              label="Active Workspace API Key Override (Authorization: Bearer)"
              type="password"
              placeholder="whkey_..."
              value={inputApiKey}
              onChange={(e) => setInputApiKey(e.target.value)}
              helperText="Tenant authentication token sent in Authorization headers (verified via SHA-256 hash)."
              leftIcon={<Key className="w-4 h-4 text-[#64748B]" />}
            />

            {/* Health status banner */}
            <div
              className={`p-3.5 rounded-xl border text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                backendHealth.status === 'up'
                  ? 'bg-[#159B78]/10 border-[#159B78]/30 text-[#159B78]'
                  : backendHealth.status === 'down'
                  ? 'bg-[#E76B64]/10 border-[#E76B64]/30 text-[#E76B64]'
                  : 'bg-[#F7F6F2] border-[#E7E8EC] text-[#64748B]'
              }`}
            >
              <div className="flex items-center gap-2 min-w-0">
                {backendHealth.status === 'up' ? (
                  <CheckCircle2 className="w-4 h-4 text-[#159B78] shrink-0" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-[#E76B64] shrink-0" />
                )}
                <span className="leading-relaxed">
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
                className="self-start sm:self-auto shrink-0"
              >
                Test Health
              </Button>
            </div>

            <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-between gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setResetConfirmOpen(true)}
                className="w-full sm:w-auto text-xs text-[#E76B64] hover:text-[#D9564F] hover:bg-[#FDF1F0] hover:border-[#E76B64]/30"
              >
                Reset to Defaults
              </Button>
              <Button type="submit" variant="primary" size="sm" className="w-full sm:w-auto">
                Save API Preferences
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Engine Tunables (From Reference Audit & Config) */}
      <Card>
        <CardHeader>
          <CardTitle>Platform Engine Tunables</CardTitle>
          <p className="text-xs text-[#64748B]">
            Core architecture parameters defined in <code className="text-[#202938] font-mono">src/config/index.js</code>
          </p>
        </CardHeader>
        <CardContent className="p-4 sm:p-5">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
            <div className="p-3 bg-[#F7F6F2] rounded-lg border border-[#E7E8EC] space-y-1">
              <span className="font-semibold text-[#202938]">Retry Policy</span>
              <p className="text-2xs text-[#64748B]">Max attempts: 8</p>
              <p className="text-2xs text-[#64748B]">Base delay: 5s (exponential)</p>
              <p className="text-2xs text-[#64748B]">Max delay ceiling: 1 hour</p>
            </div>

            <div className="p-3 bg-[#F7F6F2] rounded-lg border border-[#E7E8EC] space-y-1">
              <span className="font-semibold text-[#202938]">Dispatcher & Lease</span>
              <p className="text-2xs text-[#64748B]">Poll interval: 500ms</p>
              <p className="text-2xs text-[#64748B]">Batch size: 50 deliveries</p>
              <p className="text-2xs text-[#64748B]">Worker concurrency: 50 slots</p>
              <p className="text-2xs text-[#64748B]">Lease reaper interval: 15s</p>
            </div>

            <div className="p-3 bg-[#F7F6F2] rounded-lg border border-[#E7E8EC] space-y-1">
              <span className="font-semibold text-[#202938]">Circuit Breaker</span>
              <p className="text-2xs text-[#64748B]">Failure threshold: 5 consecutive</p>
              <p className="text-2xs text-[#64748B]">Open duration: 1 minute</p>
              <p className="text-2xs text-[#64748B]">State: Persistent in PostgreSQL</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Generate API Key Modal */}
      {newKeyModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full border border-[#E7E8EC] shadow-2xl overflow-hidden text-[#202938]">
            <div className="p-5 border-b border-[#E7E8EC] bg-[#F7F6F2]/50 flex items-center justify-between">
              <h3 className="font-bold text-sm text-[#202938]">
                {createdKeyRaw ? 'API Key Generated' : 'Generate Workspace API Key'}
              </h3>
              <button
                type="button"
                onClick={() => setNewKeyModalOpen(false)}
                className="text-[#64748B] hover:text-[#202938] text-sm"
              >
                ✕
              </button>
            </div>

            <div className="p-5 space-y-4 text-xs">
              {createdKeyRaw ? (
                <div className="space-y-4">
                  <div className="p-3.5 bg-[#E8F8F3] border border-[#159B78]/30 rounded-xl space-y-2">
                    <div className="flex items-center gap-2 font-semibold text-[#159B78]">
                      <CheckCircle2 className="w-4 h-4" />
                      <span>Key created successfully!</span>
                    </div>
                    <p className="text-[#64748B] leading-relaxed">
                      Copy this API key now. For your security, HookForge only stores a SHA-256 hash and
                      will not display this secret key again.
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      readOnly
                      value={createdKeyRaw}
                      className="flex-1 p-2.5 font-mono text-2xs bg-[#F7F6F2] border border-[#E7E8EC] rounded-lg select-all"
                    />
                    <Button
                      type="button"
                      variant="primary"
                      size="sm"
                      onClick={handleCopyKey}
                      leftIcon={copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    >
                      {copied ? 'Copied' : 'Copy'}
                    </Button>
                  </div>

                  <div className="pt-2 flex justify-end">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setNewKeyModalOpen(false)}
                    >
                      Done
                    </Button>
                  </div>
                </div>
              ) : (
                <form onSubmit={handleGenerateKey} className="space-y-4">
                  <Input
                    label="Key Identifier Name"
                    placeholder="e.g. Production Ingestion Service"
                    value={newKeyName}
                    onChange={(e) => setNewKeyName(e.target.value)}
                    helperText="A recognizable label to distinguish where this key is used."
                    required
                  />

                  <div className="flex items-center justify-end gap-2 pt-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setNewKeyModalOpen(false)}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="submit"
                      variant="primary"
                      size="sm"
                      isLoading={isGeneratingKey}
                      disabled={!newKeyName.trim()}
                    >
                      Generate Key
                    </Button>
                  </div>
                </form>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Dialog for Revoking Key */}
      <ConfirmationDialog
        isOpen={Boolean(keyToRevoke)}
        onClose={() => setKeyToRevoke(null)}
        onConfirm={handleRevokeKey}
        title="Revoke Workspace API Key?"
        description={`Are you sure you want to revoke the key "${keyToRevoke?.name}" (${keyToRevoke?.keyPrefix}••••)? External webhook senders using this key will immediately be rejected with 401 Unauthorized.`}
        confirmText="Revoke API Key"
        cancelText="Cancel"
        variant="danger"
      />

      {/* Confirmation Dialog for Resetting Settings to Defaults */}
      <ConfirmationDialog
        isOpen={resetConfirmOpen}
        onClose={() => setResetConfirmOpen(false)}
        onConfirm={handleResetSettings}
        title="Reset API Configuration?"
        description="Are you sure you want to reset your API connection settings to defaults? This will restore the base URL to http://localhost:8081 and clear your stored API key."
        confirmText="Reset to Defaults"
        cancelText="Cancel"
        variant="warning"
      />
    </div>
  )
}
