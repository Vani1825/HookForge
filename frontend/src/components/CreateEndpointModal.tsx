import React, { useState } from 'react'
import { Modal } from './ui/Modal'
import { Input } from './ui/Input'
import { Button } from './ui/Button'
import { useApp } from '../context/AppContext'
import { copyToClipboard } from '../utils/formatters'
import { KeyRound, ShieldAlert, Check, Copy, AlertCircle } from 'lucide-react'
import type { Endpoint } from '../types'

interface CreateEndpointModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: (newEndpoint: Endpoint) => void
}

export const CreateEndpointModal: React.FC<CreateEndpointModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
}) => {
  const { service, addToast } = useApp()

  const [url, setUrl] = useState('')
  const [rateLimitRps, setRateLimitRps] = useState('10')
  const [description, setDescription] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [urlError, setUrlError] = useState<string | null>(null)
  const [rateLimitError, setRateLimitError] = useState<string | null>(null)
  const [apiError, setApiError] = useState<string | null>(null)

  // Secret display phase once created
  const [createdEndpoint, setCreatedEndpoint] = useState<Endpoint | null>(null)
  const [copiedSecret, setCopiedSecret] = useState(false)

  const handleReset = () => {
    setUrl('')
    setRateLimitRps('10')
    setDescription('')
    setUrlError(null)
    setRateLimitError(null)
    setApiError(null)
    setCreatedEndpoint(null)
    setCopiedSecret(false)
    onClose()
  }

  const validate = (): boolean => {
    let valid = true
    setUrlError(null)
    setRateLimitError(null)
    setApiError(null)

    if (!url.trim()) {
      setUrlError('Destination URL is required.')
      valid = false
    } else {
      try {
        const parsed = new URL(url.trim())
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
          setUrlError('URL must use http:// or https:// protocol.')
          valid = false
        }
      } catch {
        setUrlError('Please enter a valid, well-formed URL (e.g. https://api.example.com/webhook).')
        valid = false
      }
    }

    const rps = parseInt(rateLimitRps, 10)
    if (isNaN(rps) || rps < 1 || rps > 500) {
      setRateLimitError('Rate limit must be between 1 and 500 requests per second.')
      valid = false
    }

    return valid
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!validate()) return

    setIsLoading(true)
    setApiError(null)

    try {
      const endpoint = await service.createEndpoint({
        url: url.trim(),
        rate_limit_rps: parseInt(rateLimitRps, 10),
        description: description.trim() || undefined,
      })

      addToast({
        title: 'Endpoint Created',
        description: `Webhook destination ${endpoint.url} added successfully.`,
        type: 'success',
      })

      if (endpoint.secret) {
        setCreatedEndpoint(endpoint)
      } else {
        onSuccess(endpoint)
        handleReset()
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to create endpoint'
      setApiError(message)
    } finally {
      setIsLoading(false)
    }
  }

  const handleCopySecret = async () => {
    if (!createdEndpoint?.secret) return
    const ok = await copyToClipboard(createdEndpoint.secret)
    if (ok) {
      setCopiedSecret(true)
      setTimeout(() => setCopiedSecret(false), 2000)
    }
  }

  // If secret view is active, show the one-time secret modal
  if (createdEndpoint && createdEndpoint.secret) {
    return (
      <Modal
        isOpen={isOpen}
        onClose={() => {
          onSuccess(createdEndpoint)
          handleReset()
        }}
        title="Signing Secret Generated"
        description="Save your HMAC webhook signing secret immediately."
        maxWidth="lg"
        footer={
          <Button
            variant="primary"
            onClick={() => {
              onSuccess(createdEndpoint)
              handleReset()
            }}
          >
            I have saved the secret
          </Button>
        }
      >
        <div className="space-y-4">
          <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-3">
            <ShieldAlert className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div className="text-xs text-amber-900 space-y-1">
              <p className="font-semibold">Important Security Notice</p>
              <p>
                HookForge computes an HMAC-SHA256 signature using this secret for all deliveries sent
                to <strong>{createdEndpoint.url}</strong>.
              </p>
              <p className="font-medium text-amber-950">
                This secret is shown only once and cannot be retrieved later.
              </p>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-700">Webhook HMAC Secret</label>
            <div className="flex items-center gap-2">
              <div className="flex-1 p-2.5 font-mono text-xs bg-slate-100 rounded-lg border border-slate-300 text-slate-900 break-all select-all font-semibold">
                {createdEndpoint.secret}
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={handleCopySecret}
                leftIcon={copiedSecret ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
              >
                {copiedSecret ? 'Copied' : 'Copy'}
              </Button>
            </div>
          </div>
        </div>
      </Modal>
    )
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleReset}
      title="Add Webhook Endpoint"
      description="Register a new destination URL to receive webhook event dispatches."
      maxWidth="md"
      footer={
        <div className="flex items-center justify-end gap-2 w-full">
          <Button variant="outline" size="sm" onClick={handleReset} disabled={isLoading}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={handleSubmit}
            isLoading={isLoading}
            leftIcon={<KeyRound className="w-3.5 h-3.5" />}
          >
            Create Endpoint
          </Button>
        </div>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4 text-left">
        {apiError && (
          <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg flex items-center gap-2 text-xs text-rose-700">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
            <span>{apiError}</span>
          </div>
        )}

        <Input
          label="Destination URL *"
          placeholder="https://api.example.com/webhooks/incoming"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          error={urlError || undefined}
          helperText="The HTTPS endpoint where HookForge will deliver POST requests."
          required
        />

        <Input
          label="Rate Limit (Requests per Second)"
          type="number"
          min={1}
          max={500}
          value={rateLimitRps}
          onChange={(e) => setRateLimitRps(e.target.value)}
          error={rateLimitError || undefined}
          helperText="Token bucket capacity allocated to this destination (default: 10 RPS)."
        />

        <Input
          label="Description / Purpose (Optional)"
          placeholder="e.g. Production Billing Notification Receiver"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          helperText="Internal identifier or note for your engineering team."
        />
      </form>
    </Modal>
  )
}
