import React, { useState, useEffect } from 'react'
import { Modal } from './ui/Modal'
import { Input } from './ui/Input'
import { Button } from './ui/Button'
import {
  RetryPolicyConfigForm,
  DEFAULT_RETRY_FORM_DATA,
  validateRetryPolicyForm,
  type RetryPolicyFormData,
  type RetryPolicyFormErrors,
} from './RetryPolicyConfigForm'
import { useApp } from '../context/AppContext'
import { Settings, AlertCircle, Save } from 'lucide-react'
import type { Endpoint } from '../types'

interface EditEndpointModalProps {
  isOpen: boolean
  onClose: () => void
  endpoint: Endpoint | null
  onSuccess: (updated: Endpoint) => void
}

export const EditEndpointModal: React.FC<EditEndpointModalProps> = ({
  isOpen,
  onClose,
  endpoint,
  onSuccess,
}) => {
  const { service, addToast } = useApp()

  const [url, setUrl] = useState('')
  const [rateLimitRps, setRateLimitRps] = useState('10')
  const [description, setDescription] = useState('')
  const [retryData, setRetryData] = useState<RetryPolicyFormData>(DEFAULT_RETRY_FORM_DATA)
  const [retryErrors, setRetryErrors] = useState<RetryPolicyFormErrors>({})
  const [urlError, setUrlError] = useState<string | null>(null)
  const [rateLimitError, setRateLimitError] = useState<string | null>(null)
  const [apiError, setApiError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  // Populate state when endpoint changes or modal opens
  useEffect(() => {
    if (endpoint) {
      setUrl(endpoint.url || '')
      setRateLimitRps(String(endpoint.rate_limit_rps || 10))
      setDescription(endpoint.description || '')

      const strategy = (endpoint.retryStrategy ||
        endpoint.retry_strategy ||
        endpoint.retryPolicy?.strategy ||
        'EXPONENTIAL') as 'EXPONENTIAL' | 'FIXED'

      const maxAttempts =
        endpoint.retryMaxAttempts ??
        endpoint.retry_max_attempts ??
        endpoint.retryPolicy?.maxAttempts ??
        8

      const baseDelayMs =
        endpoint.retryBaseDelayMs ??
        endpoint.retry_base_delay_ms ??
        endpoint.retryPolicy?.baseDelayMs ??
        5000

      const maxDelayMs =
        endpoint.retryMaxDelayMs ??
        endpoint.retry_max_delay_ms ??
        endpoint.retryPolicy?.maxDelayMs ??
        3600000

      const backoffMultiplier =
        endpoint.retryBackoffMultiplier ??
        endpoint.retry_backoff_multiplier ??
        endpoint.retryPolicy?.backoffMultiplier ??
        2.0

      setRetryData({
        retryStrategy: strategy,
        retryMaxAttempts: String(maxAttempts),
        retryBaseDelayMs: String(baseDelayMs),
        retryMaxDelayMs: String(maxDelayMs),
        retryBackoffMultiplier: String(backoffMultiplier),
      })
      setRetryErrors({})
      setUrlError(null)
      setRateLimitError(null)
      setApiError(null)
    }
  }, [endpoint, isOpen])

  const handleRetryChange = (field: keyof RetryPolicyFormData, value: string) => {
    setRetryData((prev) => ({ ...prev, [field]: value }))
    if (retryErrors[field]) {
      setRetryErrors((prev) => ({ ...prev, [field]: undefined }))
    }
  }

  const validate = () => {
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

    const retryValidation = validateRetryPolicyForm(retryData)
    if (!retryValidation.isValid) {
      setRetryErrors(retryValidation.errors)
      valid = false
    } else {
      setRetryErrors({})
    }

    return valid ? retryValidation.cleanValues : null
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!endpoint) return

    const cleanValues = validate()
    if (!cleanValues) return

    setIsLoading(true)
    setApiError(null)

    try {
      const updated = await service.updateEndpoint(endpoint.id, {
        url: url.trim(),
        rate_limit_rps: parseInt(rateLimitRps, 10),
        description: description.trim() || undefined,
        retryStrategy: cleanValues.retryStrategy,
        retryMaxAttempts: cleanValues.retryMaxAttempts,
        retryBaseDelayMs: cleanValues.retryBaseDelayMs,
        retryMaxDelayMs: cleanValues.retryMaxDelayMs,
        retryBackoffMultiplier: cleanValues.retryBackoffMultiplier,
      })

      addToast({
        title: 'Endpoint Updated',
        description: `Configuration and retry policy for ${updated.url} updated successfully.`,
        type: 'success',
      })

      onSuccess(updated)
      onClose()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to update endpoint'
      setApiError(msg)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Edit Endpoint & Retry Policy"
      description={`Update settings and retry backoff behavior for ${endpoint?.url || 'this endpoint'}.`}
      maxWidth="lg"
      footer={
        <div className="flex items-center justify-end gap-2 w-full">
          <Button variant="outline" size="sm" onClick={onClose} disabled={isLoading}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={handleSubmit}
            isLoading={isLoading}
            leftIcon={<Save className="w-3.5 h-3.5" />}
          >
            Save Changes
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

        <div className="flex items-center gap-2 pb-2 border-b border-[#E7E8EC]">
          <Settings className="w-4 h-4 text-[#5277D9]" />
          <h4 className="text-xs font-semibold text-[#202938]">Endpoint Configuration</h4>
        </div>

        <Input
          label="Destination URL *"
          placeholder="https://api.example.com/webhooks/incoming"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          error={urlError || undefined}
          helperText="The HTTPS endpoint where HookForge will deliver POST requests."
          required
          disabled={isLoading}
        />

        <Input
          label="Rate Limit (Requests per Second)"
          type="number"
          min={1}
          max={500}
          value={rateLimitRps}
          onChange={(e) => setRateLimitRps(e.target.value)}
          error={rateLimitError || undefined}
          helperText="Token bucket capacity allocated to this destination (1–500 RPS)."
          disabled={isLoading}
        />

        <Input
          label="Description / Purpose (Optional)"
          placeholder="e.g. Production Billing Notification Receiver"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          helperText="Internal note or identifier."
          disabled={isLoading}
        />

        {/* Retry Policy Configuration Sub-Form */}
        <RetryPolicyConfigForm
          values={retryData}
          errors={retryErrors}
          onChange={handleRetryChange}
          disabled={isLoading}
        />
      </form>
    </Modal>
  )
}
