import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import {
  FlaskConical,
  Play,
  RotateCw,
  Globe2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
  Layers,
  Copy,
  Check,
  Plus,
  Trash2,
  Code2,
  FileText,
  Sliders,
  ExternalLink,
  ShieldCheck,
  Zap,
} from 'lucide-react'
import { PageHeader } from '../components/ui/PageHeader'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { CircuitBadge } from '../components/CircuitBadge'
import { JsonViewer } from '../components/ui/JsonViewer'
import { EmptyState } from '../components/ui/EmptyState'
import { useApp } from '../context/AppContext'
import { formatErrorMessage } from '../api/client'
import { formatDateTime, truncateId, copyToClipboard } from '../utils/formatters'
import type { Endpoint, EndpointTestResult, EndpointTestHttpMethod } from '../types'

interface HeaderRow {
  id: string
  key: string
  value: string
}

const DEFAULT_SAMPLE_PAYLOAD = JSON.stringify(
  {
    event: 'endpoint.test',
    timestamp: new Date().toISOString(),
    message: 'HookForge webhook endpoint diagnostic probe',
    data: {
      test: true,
      ping: 'pong',
      sampleId: 'sample_99182',
    },
  },
  null,
  2
)

const HTTP_METHODS: EndpointTestHttpMethod[] = ['POST', 'GET', 'PUT', 'PATCH', 'DELETE', 'HEAD']

export const EndpointTestingPage: React.FC = () => {
  const { service, mode, addToast } = useApp()
  const [searchParams, setSearchParams] = useSearchParams()
  const queryEndpointId = searchParams.get('endpointId') || ''

  // Endpoints state
  const [endpoints, setEndpoints] = useState<Endpoint[]>([])
  const [isLoadingEndpoints, setIsLoadingEndpoints] = useState(true)

  // Target selection state: 'saved' | 'adhoc'
  const [targetType, setTargetType] = useState<'saved' | 'adhoc'>('saved')
  const [selectedEndpointId, setSelectedEndpointId] = useState<string>(queryEndpointId)
  const [customUrl, setCustomUrl] = useState<string>('')
  const [customSecret, setCustomSecret] = useState<string>('')

  // Request configuration
  const [method, setMethod] = useState<EndpointTestHttpMethod>('POST')
  const [activeConfigTab, setActiveConfigTab] = useState<'payload' | 'headers' | 'options'>('payload')
  const [headers, setHeaders] = useState<HeaderRow[]>([
    { id: '1', key: 'Content-Type', value: 'application/json' },
  ])
  const [payloadText, setPayloadText] = useState<string>(DEFAULT_SAMPLE_PAYLOAD)
  const [timeoutMs, setTimeoutMs] = useState<number>(10000)

  // Execution & results state
  const [isTesting, setIsTesting] = useState(false)
  const [testResult, setTestResult] = useState<EndpointTestResult | null>(null)
  const [executionError, setExecutionError] = useState<string | null>(null)
  const [copiedHeaders, setCopiedHeaders] = useState(false)
  const [activeResultTab, setActiveResultTab] = useState<'body' | 'headers' | 'request'>('body')

  // Load available endpoints
  const loadEndpoints = useCallback(async () => {
    setIsLoadingEndpoints(true)
    try {
      const data = await service.getEndpoints()
      setEndpoints(data)
      if (!selectedEndpointId && data.length > 0) {
        setSelectedEndpointId(queryEndpointId || data[0].id)
      }
    } catch (err: unknown) {
      addToast({
        title: 'Failed to load endpoints',
        description: formatErrorMessage(err),
        type: 'error',
      })
    } finally {
      setIsLoadingEndpoints(false)
    }
  }, [service, queryEndpointId, selectedEndpointId, addToast])

  useEffect(() => {
    loadEndpoints()
  }, [loadEndpoints, mode])

  // Sync endpoint selection with query params
  useEffect(() => {
    if (queryEndpointId) {
      setSelectedEndpointId(queryEndpointId)
      setTargetType('saved')
    }
  }, [queryEndpointId])

  const selectedEndpoint = useMemo(() => {
    return endpoints.find((ep) => ep.id === selectedEndpointId)
  }, [endpoints, selectedEndpointId])

  // JSON payload validation
  const payloadValidation = useMemo(() => {
    if (method === 'GET' || method === 'HEAD') {
      return { isValid: true, error: null }
    }
    const trimmed = payloadText.trim()
    if (!trimmed) {
      return { isValid: true, error: null }
    }
    try {
      JSON.parse(trimmed)
      return { isValid: true, error: null }
    } catch (e) {
      return {
        isValid: false,
        error: `Invalid JSON: ${e instanceof Error ? e.message : 'Malformed payload syntax'}`,
      }
    }
  }, [payloadText, method])

  // Headers management
  const handleAddHeader = () => {
    setHeaders((prev) => [
      ...prev,
      { id: String(Date.now()), key: '', value: '' },
    ])
  }

  const handleRemoveHeader = (id: string) => {
    setHeaders((prev) => prev.filter((h) => h.id !== id))
  }

  const handleHeaderChange = (id: string, field: 'key' | 'value', val: string) => {
    setHeaders((prev) =>
      prev.map((h) => (h.id === id ? { ...h, [field]: val } : h))
    )
  }

  const handlePrettifyJson = () => {
    try {
      const parsed = JSON.parse(payloadText)
      setPayloadText(JSON.stringify(parsed, null, 2))
    } catch {
      // Keep as-is if invalid
    }
  }

  const handleLoadSamplePayload = () => {
    setPayloadText(DEFAULT_SAMPLE_PAYLOAD)
  }

  // Execute test probe
  const handleExecuteTest = async () => {
    setExecutionError(null)

    // Form validations
    if (targetType === 'saved') {
      if (!selectedEndpointId) {
        setExecutionError('Please select an endpoint to test.')
        return
      }
    } else {
      if (!customUrl.trim()) {
        setExecutionError('Please enter a target URL.')
        return
      }
      try {
        const parsed = new URL(customUrl.trim())
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
          setExecutionError('Target URL must use HTTP or HTTPS protocol.')
          return
        }
      } catch {
        setExecutionError('Please enter a valid, well-formed URL (e.g. https://api.example.com/webhook).')
        return
      }
    }

    if (!payloadValidation.isValid) {
      setExecutionError('Please correct the JSON payload error before sending.')
      return
    }

    // Build headers object
    const headersMap: Record<string, string> = {}
    for (const h of headers) {
      if (h.key.trim()) {
        headersMap[h.key.trim()] = h.value
      }
    }

    // Parse payload
    let parsedPayload: unknown = null
    if (method !== 'GET' && method !== 'HEAD' && payloadText.trim()) {
      try {
        parsedPayload = JSON.parse(payloadText)
      } catch {
        parsedPayload = payloadText
      }
    }

    setIsTesting(true)
    try {
      const testInput = {
        endpointId: targetType === 'saved' ? selectedEndpointId : undefined,
        url: targetType === 'adhoc' ? customUrl.trim() : undefined,
        secret: targetType === 'adhoc' && customSecret.trim() ? customSecret.trim() : undefined,
        method,
        headers: Object.keys(headersMap).length > 0 ? headersMap : undefined,
        payload: parsedPayload !== null ? parsedPayload : undefined,
        timeoutMs,
      }

      const res = await service.testEndpoint(testInput)
      setTestResult(res)

      if (res.success) {
        addToast({
          title: 'Endpoint Test Succeeded',
          description: `Target returned HTTP ${res.statusCode} in ${res.latencyMs}ms.`,
          type: 'success',
        })
      } else if (res.statusCode !== null) {
        addToast({
          title: `Endpoint Returned HTTP ${res.statusCode}`,
          description: 'The receiver returned a non-2xx response status.',
          type: 'warning',
        })
      } else {
        addToast({
          title: 'Endpoint Test Failed',
          description: res.error || 'Connection failed or timed out.',
          type: 'error',
        })
      }
    } catch (err: unknown) {
      const msg = formatErrorMessage(err)
      setExecutionError(msg)
      addToast({
        title: 'Test Dispatch Error',
        description: msg,
        type: 'error',
      })
    } finally {
      setIsTesting(false)
    }
  }

  const handleCopyAllHeaders = async (hdrs: Record<string, string>) => {
    const text = Object.entries(hdrs)
      .map(([k, v]) => `${k}: ${v}`)
      .join('\n')
    const success = await copyToClipboard(text)
    if (success) {
      setCopiedHeaders(true)
      setTimeout(() => setCopiedHeaders(false), 2000)
    }
  }

  return (
    <div className="space-y-6 text-left max-w-7xl mx-auto">
      {/* Page Header */}
      <PageHeader
        title="Endpoint Testing"
        description="Send real-time diagnostic probes to verify webhook receiver status, headers, latency, and payload handling without creating production delivery records."
        actions={
          <div className="flex items-center gap-2">
            <Link to="/endpoints">
              <Button variant="outline" size="sm" leftIcon={<Globe2 className="w-3.5 h-3.5" />}>
                All Endpoints
              </Button>
            </Link>
            <Button
              variant="outline"
              size="sm"
              onClick={loadEndpoints}
              isLoading={isLoadingEndpoints}
              leftIcon={<RotateCw className="w-3.5 h-3.5" />}
            >
              Refresh
            </Button>
          </div>
        }
      />

      {/* Main Two-Column Workbench */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Request Configuration (5 cols) */}
        <div className="lg:col-span-5 space-y-5">
          <Card className="p-5 bg-white space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-[#E7E8EC]">
              <div className="flex items-center gap-2">
                <span className="p-1.5 rounded-md bg-[#5277D9]/10 text-[#5277D9]">
                  <Sliders className="w-4 h-4" />
                </span>
                <h3 className="text-sm font-semibold text-[#202938]">Target Destination</h3>
              </div>

              {/* Target Type Selector */}
              <div className="inline-flex rounded-lg p-0.5 bg-[#F7F6F2] border border-[#E7E8EC]">
                <button
                  type="button"
                  onClick={() => setTargetType('saved')}
                  className={`px-2.5 py-1 text-2xs font-semibold rounded-md transition-all cursor-pointer ${
                    targetType === 'saved'
                      ? 'bg-white text-[#202938] shadow-xs'
                      : 'text-[#64748B] hover:text-[#202938]'
                  }`}
                >
                  Saved Endpoint
                </button>
                <button
                  type="button"
                  onClick={() => setTargetType('adhoc')}
                  className={`px-2.5 py-1 text-2xs font-semibold rounded-md transition-all cursor-pointer ${
                    targetType === 'adhoc'
                      ? 'bg-white text-[#202938] shadow-xs'
                      : 'text-[#64748B] hover:text-[#202938]'
                  }`}
                >
                  Custom URL
                </button>
              </div>
            </div>

            {/* Target Input based on mode */}
            {targetType === 'saved' ? (
              <div className="space-y-3">
                <div>
                  <label className="block text-2xs font-semibold uppercase tracking-wider text-[#64748B] mb-1.5">
                    Select Endpoint
                  </label>
                  <select
                    value={selectedEndpointId}
                    onChange={(e) => {
                      setSelectedEndpointId(e.target.value)
                      setSearchParams({ endpointId: e.target.value })
                    }}
                    className="w-full text-xs bg-white border border-[#E7E8EC] rounded-lg px-3 py-2 text-[#202938] focus:outline-none focus:ring-1 focus:ring-[#5277D9] cursor-pointer"
                  >
                    {endpoints.length === 0 ? (
                      <option value="">No endpoints configured</option>
                    ) : (
                      endpoints.map((ep) => (
                        <option key={ep.id} value={ep.id}>
                          {ep.url} ({truncateId(ep.id, 8)})
                        </option>
                      ))
                    )}
                  </select>
                </div>

                {/* Selected Endpoint Card Details */}
                {selectedEndpoint && (
                  <div className="p-3 bg-[#F7F6F2] rounded-lg border border-[#E7E8EC] space-y-2 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-2xs text-[#202938] truncate max-w-[240px]">
                        {selectedEndpoint.url}
                      </span>
                      <a
                        href={selectedEndpoint.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[#64748B] hover:text-[#5277D9]"
                        title="Open URL"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-[#E7E8EC]/70 text-2xs">
                      {selectedEndpoint.active ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-semibold bg-[#159B78]/10 text-[#159B78] border border-[#159B78]/25">
                          <span className="w-1.5 h-1.5 rounded-full bg-[#159B78]" /> Active
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-semibold bg-gray-100 text-gray-600">
                          Paused
                        </span>
                      )}

                      <CircuitBadge
                        state={selectedEndpoint.circuit_state}
                        consecutiveFailures={selectedEndpoint.consecutive_failures}
                      />

                      <span className="font-semibold text-[#64748B]">
                        {selectedEndpoint.rate_limit_rps} RPS
                      </span>

                      <span className="inline-flex items-center gap-1 text-[#64748B] font-mono">
                        <ShieldCheck className="w-3 h-3 text-[#159B78]" />
                        Signed
                      </span>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                <div>
                  <label className="block text-2xs font-semibold uppercase tracking-wider text-[#64748B] mb-1.5">
                    Target Webhook URL
                  </label>
                  <Input
                    placeholder="https://webhook.site/your-id or https://api.mycorp.com/events"
                    value={customUrl}
                    onChange={(e) => setCustomUrl(e.target.value)}
                  />
                  <p className="mt-1 text-3xs text-[#64748B]">
                    Protected by HookForge SSRF validation (private IPs and cloud metadata are blocked).
                  </p>
                </div>

                <div>
                  <label className="block text-2xs font-semibold uppercase tracking-wider text-[#64748B] mb-1.5">
                    Signing Secret (Optional)
                  </label>
                  <Input
                    placeholder="whsec_... (optional HMAC-SHA256 secret)"
                    value={customSecret}
                    onChange={(e) => setCustomSecret(e.target.value)}
                  />
                </div>
              </div>
            )}
          </Card>

          {/* HTTP Method & Request Editor */}
          <Card className="p-5 bg-white space-y-4">
            <div className="space-y-2">
              <label className="block text-2xs font-semibold uppercase tracking-wider text-[#64748B]">
                HTTP Method
              </label>
              <div className="flex flex-wrap gap-1.5">
                {HTTP_METHODS.map((m) => {
                  const isSelected = method === m
                  return (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setMethod(m)}
                      className={`px-3 py-1.5 rounded-md text-xs font-bold font-mono transition-all cursor-pointer ${
                        isSelected
                          ? m === 'GET'
                            ? 'bg-[#159B78] text-white shadow-xs'
                            : m === 'POST'
                              ? 'bg-[#5277D9] text-white shadow-xs'
                              : m === 'DELETE'
                                ? 'bg-[#E76B64] text-white shadow-xs'
                                : 'bg-[#D97706] text-white shadow-xs'
                          : 'bg-[#F7F6F2] text-[#64748B] hover:bg-[#E7E8EC] hover:text-[#202938]'
                      }`}
                    >
                      {m}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Request Tabs */}
            <div className="space-y-3 pt-2">
              <div className="flex items-center gap-1 border-b border-[#E7E8EC] text-xs">
                <button
                  type="button"
                  onClick={() => setActiveConfigTab('payload')}
                  disabled={method === 'GET' || method === 'HEAD'}
                  className={`px-3 py-2 font-semibold border-b-2 transition-all cursor-pointer ${
                    method === 'GET' || method === 'HEAD'
                      ? 'border-transparent text-gray-300 cursor-not-allowed'
                      : activeConfigTab === 'payload'
                        ? 'border-[#5277D9] text-[#5277D9]'
                        : 'border-transparent text-[#64748B] hover:text-[#202938]'
                  }`}
                >
                  <span className="flex items-center gap-1.5">
                    <Code2 className="w-3.5 h-3.5" />
                    JSON Payload
                    {(method === 'GET' || method === 'HEAD') && (
                      <span className="text-3xs text-gray-400">(N/A)</span>
                    )}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveConfigTab('headers')}
                  className={`px-3 py-2 font-semibold border-b-2 transition-all cursor-pointer ${
                    activeConfigTab === 'headers'
                      ? 'border-[#5277D9] text-[#5277D9]'
                      : 'border-transparent text-[#64748B] hover:text-[#202938]'
                  }`}
                >
                  <span className="flex items-center gap-1.5">
                    <Layers className="w-3.5 h-3.5" />
                    Headers ({headers.filter((h) => h.key.trim()).length})
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveConfigTab('options')}
                  className={`px-3 py-2 font-semibold border-b-2 transition-all cursor-pointer ${
                    activeConfigTab === 'options'
                      ? 'border-[#5277D9] text-[#5277D9]'
                      : 'border-transparent text-[#64748B] hover:text-[#202938]'
                  }`}
                >
                  <span className="flex items-center gap-1.5">
                    <Sliders className="w-3.5 h-3.5" />
                    Options
                  </span>
                </button>
              </div>

              {/* Tab 1: Payload Editor */}
              {activeConfigTab === 'payload' && (
                <div className="space-y-2">
                  {method === 'GET' || method === 'HEAD' ? (
                    <div className="p-6 text-center text-xs text-[#64748B] bg-[#F7F6F2] rounded-lg border border-dashed border-[#E7E8EC]">
                      {method} requests do not carry a request body according to standard HTTP semantics.
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center justify-between text-2xs text-[#64748B]">
                        <span>Edit JSON body to dispatch</span>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={handlePrettifyJson}
                            className="text-[#5277D9] hover:underline cursor-pointer font-medium"
                          >
                            Prettify
                          </button>
                          <span>•</span>
                          <button
                            type="button"
                            onClick={handleLoadSamplePayload}
                            className="text-[#5277D9] hover:underline cursor-pointer font-medium"
                          >
                            Reset Sample
                          </button>
                        </div>
                      </div>

                      <div className="relative">
                        <textarea
                          aria-label="JSON Payload Textarea"
                          rows={8}
                          value={payloadText}
                          onChange={(e) => setPayloadText(e.target.value)}
                          className={`w-full font-mono text-xs bg-[#1E293B] text-slate-100 rounded-lg p-3 focus:outline-none focus:ring-1 transition-all ${
                            payloadValidation.isValid
                              ? 'focus:ring-[#5277D9] border-transparent'
                              : 'border border-[#E76B64] focus:ring-[#E76B64]'
                          }`}
                          placeholder="{\n  &quot;key&quot;: &quot;value&quot;\n}"
                        />
                      </div>

                      {!payloadValidation.isValid && (
                        <div className="flex items-center gap-1.5 text-2xs text-[#E76B64]">
                          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                          <span>{payloadValidation.error}</span>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* Tab 2: Custom Headers Editor */}
              {activeConfigTab === 'headers' && (
                <div className="space-y-3">
                  <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                    {headers.map((h) => (
                      <div key={h.id} className="flex items-center gap-2">
                        <input
                          type="text"
                          placeholder="Header Name"
                          value={h.key}
                          onChange={(e) => handleHeaderChange(h.id, 'key', e.target.value)}
                          className="w-1/2 text-xs bg-[#F7F6F2] border border-[#E7E8EC] rounded px-2.5 py-1.5 text-[#202938] font-mono focus:outline-none focus:ring-1 focus:ring-[#5277D9]"
                        />
                        <input
                          type="text"
                          placeholder="Header Value"
                          value={h.value}
                          onChange={(e) => handleHeaderChange(h.id, 'value', e.target.value)}
                          className="w-1/2 text-xs bg-[#F7F6F2] border border-[#E7E8EC] rounded px-2.5 py-1.5 text-[#202938] font-mono focus:outline-none focus:ring-1 focus:ring-[#5277D9]"
                        />
                        <button
                          type="button"
                          onClick={() => handleRemoveHeader(h.id)}
                          className="text-[#64748B] hover:text-[#E76B64] p-1 cursor-pointer"
                          title="Remove header"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>

                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleAddHeader}
                    leftIcon={<Plus className="w-3 h-3" />}
                  >
                    Add Header
                  </Button>
                </div>
              )}

              {/* Tab 3: Options / Timeout */}
              {activeConfigTab === 'options' && (
                <div className="space-y-3">
                  <div>
                    <label className="block text-2xs font-semibold uppercase tracking-wider text-[#64748B] mb-1">
                      Request Timeout (milliseconds)
                    </label>
                    <Input
                      type="number"
                      min={500}
                      max={30000}
                      step={500}
                      value={String(timeoutMs)}
                      onChange={(e) => setTimeoutMs(Number(e.target.value) || 10000)}
                    />
                    <p className="mt-1 text-3xs text-[#64748B]">
                      Request will fail with a timeout outcome if destination takes longer than this threshold.
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Error notice */}
            {executionError && (
              <div className="p-3 bg-[#E76B64]/10 border border-[#E76B64]/25 rounded-lg text-xs text-[#E76B64] flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{executionError}</span>
              </div>
            )}

            {/* Action Button */}
            <div className="pt-2">
              <Button
                variant="primary"
                size="md"
                onClick={handleExecuteTest}
                isLoading={isTesting}
                disabled={isTesting || (!payloadValidation.isValid && method !== 'GET' && method !== 'HEAD')}
                leftIcon={<Play className="w-4 h-4 fill-current" />}
                className="w-full justify-center text-xs font-semibold py-2.5 shadow-sm"
              >
                {isTesting ? 'Dispatching Probe...' : 'Run Test Probe'}
              </Button>
            </div>
          </Card>
        </div>

        {/* Right Column: Response & Diagnostics Inspector (7 cols) */}
        <div className="lg:col-span-7 space-y-5">
          <Card className="p-5 bg-white min-h-[460px] flex flex-col">
            <div className="flex items-center justify-between pb-3 border-b border-[#E7E8EC]">
              <div className="flex items-center gap-2">
                <span className="p-1.5 rounded-md bg-[#159B78]/10 text-[#159B78]">
                  <FlaskConical className="w-4 h-4" />
                </span>
                <h3 className="text-sm font-semibold text-[#202938]">Response Inspector</h3>
              </div>

              {testResult && (
                <div className="flex items-center gap-2">
                  <span className="text-3xs text-[#64748B]">
                    Tested at: {formatDateTime(testResult.testedAt)}
                  </span>
                </div>
              )}
            </div>

            {/* Inspector Body */}
            <div className="flex-1 flex flex-col pt-3">
              {isTesting ? (
                <div className="flex-1 flex flex-col items-center justify-center p-8 space-y-3 text-center">
                  <div className="w-10 h-10 rounded-full border-3 border-[#5277D9]/20 border-t-[#5277D9] animate-spin" />
                  <p className="text-xs font-semibold text-[#202938]">
                    Dispatching live test probe to endpoint...
                  </p>
                  <p className="text-2xs text-[#64748B] font-mono">
                    Verifying SSL, IP pinning, HMAC signature, and response
                  </p>
                </div>
              ) : !testResult ? (
                <div className="flex-1 flex flex-col items-center justify-center p-8">
                  <EmptyState
                    icon={<Zap className="w-8 h-8 text-[#5277D9]" />}
                    title="No Test Executed Yet"
                    description="Configure your target endpoint, method, headers, and JSON payload on the left, then click 'Run Test Probe' to inspect live status codes, headers, and responses."
                  />
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Status & Latency Banner */}
                  <div
                    className={`p-4 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                      testResult.success
                        ? 'bg-[#159B78]/10 border-[#159B78]/25'
                        : testResult.statusCode !== null
                          ? 'bg-[#D97706]/10 border-[#D97706]/25'
                          : 'bg-[#E76B64]/10 border-[#E76B64]/25'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      {testResult.success ? (
                        <CheckCircle2 className="w-6 h-6 text-[#159B78] shrink-0" />
                      ) : (
                        <XCircle className="w-6 h-6 text-[#E76B64] shrink-0" />
                      )}
                      <div>
                        <div className="flex items-center gap-2">
                          <span
                            className={`font-mono font-bold text-sm ${
                              testResult.success
                                ? 'text-[#159B78]'
                                : testResult.statusCode !== null
                                  ? 'text-[#D97706]'
                                  : 'text-[#E76B64]'
                            }`}
                          >
                            {testResult.statusCode !== null
                              ? `HTTP ${testResult.statusCode}`
                              : 'Network / Transport Error'}
                          </span>
                          <span className="text-2xs font-semibold text-[#64748B]">
                            {testResult.success
                              ? 'Success'
                              : testResult.statusCode !== null
                                ? 'Non-2xx Response'
                                : 'Failed'}
                          </span>
                        </div>
                        {testResult.error && (
                          <p className="text-2xs font-medium text-[#E76B64] mt-0.5">
                            {testResult.error}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-3 text-xs self-start sm:self-auto">
                      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white border border-[#E7E8EC] font-mono font-semibold text-[#202938] shadow-2xs">
                        <Clock className="w-3.5 h-3.5 text-[#5277D9]" />
                        {testResult.latencyMs} ms
                      </span>

                      {testResult.response?.sizeBytes !== undefined && (
                        <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-white border border-[#E7E8EC] font-mono font-semibold text-[#64748B] shadow-2xs">
                          {testResult.response.sizeBytes} B
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Truncation notice */}
                  {testResult.response?.truncated && (
                    <div className="p-3 bg-[#D97706]/10 border border-[#D97706]/25 rounded-lg text-2xs text-[#D97706] flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 shrink-0" />
                      <span>
                        The receiver response body exceeded the safe diagnostic capture limit (64 KB) and was safely truncated.
                      </span>
                    </div>
                  )}

                  {/* Result Detail Tabs */}
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 border-b border-[#E7E8EC] text-xs">
                      <button
                        type="button"
                        onClick={() => setActiveResultTab('body')}
                        className={`px-3 py-2 font-semibold border-b-2 transition-all cursor-pointer ${
                          activeResultTab === 'body'
                            ? 'border-[#5277D9] text-[#5277D9]'
                            : 'border-transparent text-[#64748B] hover:text-[#202938]'
                        }`}
                      >
                        <span className="flex items-center gap-1.5">
                          <Code2 className="w-3.5 h-3.5" />
                          Response Body
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setActiveResultTab('headers')}
                        className={`px-3 py-2 font-semibold border-b-2 transition-all cursor-pointer ${
                          activeResultTab === 'headers'
                            ? 'border-[#5277D9] text-[#5277D9]'
                            : 'border-transparent text-[#64748B] hover:text-[#202938]'
                        }`}
                      >
                        <span className="flex items-center gap-1.5">
                          <Layers className="w-3.5 h-3.5" />
                          Response Headers ({Object.keys(testResult.response?.headers || {}).length})
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setActiveResultTab('request')}
                        className={`px-3 py-2 font-semibold border-b-2 transition-all cursor-pointer ${
                          activeResultTab === 'request'
                            ? 'border-[#5277D9] text-[#5277D9]'
                            : 'border-transparent text-[#64748B] hover:text-[#202938]'
                        }`}
                      >
                        <span className="flex items-center gap-1.5">
                          <FileText className="w-3.5 h-3.5" />
                          Request Dispatched
                        </span>
                      </button>
                    </div>

                    {/* Result Tab 1: Response Body */}
                    {activeResultTab === 'body' && (
                      <div>
                        {testResult.response?.body ? (
                          <JsonViewer
                            data={testResult.response.body}
                            title="Receiver Response Body"
                            maxHeight="max-h-96"
                          />
                        ) : (
                          <div className="p-6 text-center text-xs text-[#64748B] bg-[#F7F6F2] rounded-lg border border-dashed border-[#E7E8EC]">
                            No response body returned from target server.
                          </div>
                        )}
                      </div>
                    )}

                    {/* Result Tab 2: Response Headers */}
                    {activeResultTab === 'headers' && (
                      <div className="space-y-2">
                        {testResult.response?.headers &&
                        Object.keys(testResult.response.headers).length > 0 ? (
                          <>
                            <div className="flex justify-end">
                              <button
                                type="button"
                                onClick={() =>
                                  handleCopyAllHeaders(testResult.response?.headers || {})
                                }
                                className="inline-flex items-center gap-1 text-2xs text-[#5277D9] hover:underline cursor-pointer"
                              >
                                {copiedHeaders ? (
                                  <>
                                    <Check className="w-3 h-3 text-[#159B78]" />
                                    <span>Copied!</span>
                                  </>
                                ) : (
                                  <>
                                    <Copy className="w-3 h-3" />
                                    <span>Copy Headers</span>
                                  </>
                                )}
                              </button>
                            </div>
                            <div className="overflow-x-auto border border-[#E7E8EC] rounded-lg">
                              <table className="w-full text-left text-xs">
                                <thead className="bg-[#F7F6F2] border-b border-[#E7E8EC] text-2xs text-[#64748B] font-semibold">
                                  <tr>
                                    <th className="py-2 px-3 w-1/3">Header Name</th>
                                    <th className="py-2 px-3">Value</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-[#E7E8EC] font-mono text-2xs">
                                  {Object.entries(testResult.response.headers).map(
                                    ([k, v]) => (
                                      <tr key={k} className="hover:bg-[#F7F6F2]/50">
                                        <td className="py-2 px-3 font-semibold text-[#202938]">
                                          {k}
                                        </td>
                                        <td className="py-2 px-3 text-[#64748B] break-all">
                                          {v}
                                        </td>
                                      </tr>
                                    )
                                  )}
                                </tbody>
                              </table>
                            </div>
                          </>
                        ) : (
                          <div className="p-6 text-center text-xs text-[#64748B] bg-[#F7F6F2] rounded-lg border border-dashed border-[#E7E8EC]">
                            No response headers captured.
                          </div>
                        )}
                      </div>
                    )}

                    {/* Result Tab 3: Request Dispatched */}
                    {activeResultTab === 'request' && (
                      <div className="space-y-3">
                        <div className="p-3 bg-[#F7F6F2] rounded-lg border border-[#E7E8EC] space-y-2 text-xs">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-2xs px-2 py-0.5 rounded bg-[#5277D9] text-white font-mono">
                              {testResult.request.method}
                            </span>
                            <span className="font-mono text-2xs text-[#202938] break-all">
                              {testResult.request.url}
                            </span>
                          </div>

                          <div className="pt-2 border-t border-[#E7E8EC]">
                            <span className="text-3xs font-semibold uppercase tracking-wider text-[#64748B] block mb-1">
                              Request Headers Dispatched:
                            </span>
                            <div className="space-y-1 font-mono text-3xs text-[#64748B]">
                              {Object.entries(testResult.request.headers).map(([k, v]) => (
                                <div key={k} className="flex gap-2">
                                  <span className="text-[#202938] font-semibold">{k}:</span>
                                  <span className="break-all">{v}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>

                        {Boolean(testResult.request.payload) && (
                          <div>
                            <span className="text-3xs font-semibold uppercase tracking-wider text-[#64748B] block mb-1">
                              Dispatched Payload:
                            </span>
                            <JsonViewer
                              data={testResult.request.payload}
                              title="Dispatched Payload"
                              maxHeight="max-h-60"
                            />
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}
