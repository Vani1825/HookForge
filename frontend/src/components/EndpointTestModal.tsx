import React, { useState, useEffect } from 'react'
import { Modal } from './ui/Modal'
import { Button } from './ui/Button'
import { useApp } from '../context/AppContext'
import { formatErrorMessage } from '../api/client'
import { JsonViewer } from './ui/JsonViewer'
import { CircuitBadge } from './CircuitBadge'
import {
  Play,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ChevronRight,
} from 'lucide-react'
import type { Endpoint, EndpointTestResult, EndpointTestHttpMethod } from '../types'
import { useNavigate } from 'react-router-dom'

interface EndpointTestModalProps {
  isOpen: boolean
  onClose: () => void
  endpoint?: Endpoint | null
}

const HTTP_METHODS: EndpointTestHttpMethod[] = ['POST', 'GET', 'PUT', 'PATCH', 'DELETE', 'HEAD']

const DEFAULT_MODAL_PAYLOAD = JSON.stringify(
  {
    event: 'endpoint.test',
    message: 'HookForge webhook test probe',
    data: { test: true },
  },
  null,
  2
)

export const EndpointTestModal: React.FC<EndpointTestModalProps> = ({
  isOpen,
  onClose,
  endpoint,
}) => {
  const { service, addToast } = useApp()
  const navigate = useNavigate()

  const [endpoints, setEndpoints] = useState<Endpoint[]>([])
  const [selectedEndpointId, setSelectedEndpointId] = useState<string>(endpoint?.id || '')
  const [method, setMethod] = useState<EndpointTestHttpMethod>('POST')
  const [payloadText, setPayloadText] = useState<string>(DEFAULT_MODAL_PAYLOAD)
  const [isTesting, setIsTesting] = useState(false)
  const [result, setResult] = useState<EndpointTestResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'request' | 'response'>('request')

  useEffect(() => {
    if (isOpen) {
      if (endpoint?.id) {
        setSelectedEndpointId(endpoint.id)
      } else {
        service.getEndpoints().then((list) => {
          setEndpoints(list)
          if (list.length > 0 && !selectedEndpointId) {
            setSelectedEndpointId(list[0].id)
          }
        }).catch(() => {})
      }
      setResult(null)
      setError(null)
      setActiveTab('request')
    }
  }, [isOpen, endpoint, service, selectedEndpointId])

  if (!isOpen) return null

  const activeEndpoint = endpoint || endpoints.find((e) => e.id === selectedEndpointId)

  const handleTest = async () => {
    setError(null)
    if (!activeEndpoint && !selectedEndpointId) {
      setError('Please select an endpoint to test.')
      return
    }

    let parsedPayload: unknown = undefined
    if (method !== 'GET' && method !== 'HEAD' && payloadText.trim()) {
      try {
        parsedPayload = JSON.parse(payloadText)
      } catch (e) {
        setError(e instanceof Error ? `Invalid JSON: ${e.message}` : 'Invalid JSON format')
        return
      }
    }

    setIsTesting(true)
    try {
      const res = await service.testEndpoint({
        endpointId: activeEndpoint?.id || selectedEndpointId,
        method,
        payload: parsedPayload,
      })

      setResult(res)
      setActiveTab('response')

      if (res.success) {
        addToast({
          title: 'Test Succeeded',
          description: `Target returned HTTP ${res.statusCode} (${res.latencyMs}ms)`,
          type: 'success',
        })
      } else {
        addToast({
          title: res.statusCode ? `HTTP ${res.statusCode}` : 'Test Failed',
          description: res.error || 'The endpoint returned a non-success response.',
          type: res.statusCode ? 'warning' : 'error',
        })
      }
    } catch (err: unknown) {
      const msg = formatErrorMessage(err)
      setError(msg)
      addToast({
        title: 'Probe Error',
        description: msg,
        type: 'error',
      })
    } finally {
      setIsTesting(false)
    }
  }

  const handleOpenConsole = () => {
    onClose()
    const id = activeEndpoint?.id || selectedEndpointId
    navigate(id ? `/endpoint-testing?endpointId=${id}` : '/endpoint-testing')
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Test Webhook Endpoint"
      description="Send a diagnostic test request to this endpoint to inspect response status and latency."
      maxWidth="2xl"
      footer={
        <div className="flex items-center justify-between w-full">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleOpenConsole}
            rightIcon={<ChevronRight className="w-3.5 h-3.5" />}
          >
            Open Full Console
          </Button>

          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={onClose}>
              Close
            </Button>
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={handleTest}
              isLoading={isTesting}
              leftIcon={<Play className="w-3.5 h-3.5 fill-current" />}
            >
              Run Test
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-4 text-xs">
        {/* Endpoint details summary */}
        {activeEndpoint ? (
          <div className="p-3 bg-[#F7F6F2] rounded-lg border border-[#E7E8EC] space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="font-mono text-2xs font-semibold text-[#202938] truncate max-w-sm">
                {activeEndpoint.url}
              </span>
              <CircuitBadge
                state={activeEndpoint.circuit_state}
                consecutiveFailures={activeEndpoint.consecutive_failures}
              />
            </div>
            <div className="flex items-center gap-2 text-2xs text-[#64748B]">
              <span>Rate limit: {activeEndpoint.rate_limit_rps} RPS</span>
              <span>•</span>
              <span className={activeEndpoint.active ? 'text-[#159B78]' : 'text-gray-500'}>
                {activeEndpoint.active ? 'Active' : 'Paused'}
              </span>
            </div>
          </div>
        ) : (
          <div>
            <label className="block text-2xs font-semibold uppercase tracking-wider text-[#64748B] mb-1">
              Select Endpoint
            </label>
            <select
              value={selectedEndpointId}
              onChange={(e) => setSelectedEndpointId(e.target.value)}
              className="w-full text-xs bg-white border border-[#E7E8EC] rounded-lg px-3 py-2 text-[#202938] focus:outline-none focus:ring-1 focus:ring-[#5277D9]"
            >
              {endpoints.map((ep) => (
                <option key={ep.id} value={ep.id}>
                  {ep.url}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Tab switcher: Request vs Response */}
        <div className="flex items-center gap-2 border-b border-[#E7E8EC]">
          <button
            type="button"
            onClick={() => setActiveTab('request')}
            className={`px-3 py-1.5 font-semibold border-b-2 transition-all cursor-pointer ${
              activeTab === 'request'
                ? 'border-[#5277D9] text-[#5277D9]'
                : 'border-transparent text-[#64748B] hover:text-[#202938]'
            }`}
          >
            Request
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('response')}
            className={`px-3 py-1.5 font-semibold border-b-2 transition-all cursor-pointer flex items-center gap-1 ${
              activeTab === 'response'
                ? 'border-[#5277D9] text-[#5277D9]'
                : 'border-transparent text-[#64748B] hover:text-[#202938]'
            }`}
          >
            <span>Response</span>
            {result && (
              <span
                className={`w-2 h-2 rounded-full ${
                  result.success ? 'bg-[#159B78]' : 'bg-[#E76B64]'
                }`}
              />
            )}
          </button>
        </div>

        {error && (
          <div className="p-3 bg-[#E76B64]/10 border border-[#E76B64]/25 rounded-lg text-xs text-[#E76B64] flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {activeTab === 'request' ? (
          <div className="space-y-3">
            {/* HTTP Method buttons */}
            <div>
              <label className="block text-2xs font-semibold uppercase tracking-wider text-[#64748B] mb-1.5">
                HTTP Method
              </label>
              <div className="flex flex-wrap gap-1.5">
                {HTTP_METHODS.map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMethod(m)}
                    className={`px-2.5 py-1 rounded text-2xs font-mono font-bold transition-all cursor-pointer ${
                      method === m
                        ? 'bg-[#5277D9] text-white'
                        : 'bg-[#F7F6F2] text-[#64748B] hover:bg-[#E7E8EC]'
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>

            {/* JSON Payload (if not GET/HEAD) */}
            {method !== 'GET' && method !== 'HEAD' ? (
              <div>
                <label className="block text-2xs font-semibold uppercase tracking-wider text-[#64748B] mb-1">
                  JSON Payload
                </label>
                <textarea
                  rows={6}
                  value={payloadText}
                  onChange={(e) => setPayloadText(e.target.value)}
                  className="w-full font-mono text-xs bg-[#1E293B] text-slate-100 rounded-lg p-2.5 focus:outline-none focus:ring-1 focus:ring-[#5277D9]"
                />
              </div>
            ) : (
              <div className="p-4 text-center text-xs text-[#64748B] bg-[#F7F6F2] rounded-lg border border-dashed border-[#E7E8EC]">
                {method} requests do not carry a body.
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {!result ? (
              <div className="p-8 text-center text-[#64748B]">
                No test results yet. Click &quot;Run Test&quot; to execute probe.
              </div>
            ) : (
              <div className="space-y-3">
                <div
                  className={`p-3 rounded-lg border flex items-center justify-between ${
                    result.success
                      ? 'bg-[#159B78]/10 border-[#159B78]/25 text-[#159B78]'
                      : result.statusCode !== null
                        ? 'bg-[#D97706]/10 border-[#D97706]/25 text-[#D97706]'
                        : 'bg-[#E76B64]/10 border-[#E76B64]/25 text-[#E76B64]'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    {result.success ? (
                      <CheckCircle2 className="w-5 h-5 shrink-0" />
                    ) : (
                      <XCircle className="w-5 h-5 shrink-0" />
                    )}
                    <span className="font-mono font-bold text-xs">
                      {result.statusCode !== null
                        ? `HTTP ${result.statusCode}`
                        : 'Transport Error'}
                    </span>
                  </div>

                  <span className="font-mono text-2xs px-2 py-0.5 rounded bg-white border border-[#E7E8EC] text-[#202938]">
                    {result.latencyMs} ms
                  </span>
                </div>

                {result.error && (
                  <p className="text-2xs text-[#E76B64] font-medium">{result.error}</p>
                )}

                {result.response?.body && (
                  <div>
                    <span className="text-2xs font-semibold text-[#64748B] block mb-1">
                      Response Body:
                    </span>
                    <JsonViewer data={result.response.body} maxHeight="max-h-56" />
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  )
}
