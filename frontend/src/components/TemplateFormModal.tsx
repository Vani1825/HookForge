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
import { AlertCircle, Plus, Trash2, Code2, ShieldAlert } from 'lucide-react'
import type { WebhookTemplate } from '../types'

interface HeaderRow {
  id: string
  key: string
  value: string
}

interface TemplateFormModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: (template: WebhookTemplate) => void
  template?: WebhookTemplate | null // null for Create, populated for Edit
}

const HTTP_METHODS = ['POST', 'PUT', 'PATCH', 'GET', 'DELETE']

export const TemplateFormModal: React.FC<TemplateFormModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  template,
}) => {
  const { service, addToast } = useApp()
  const isEditing = Boolean(template)
  const isSystem = Boolean(template?.is_system || template?.isSystem)

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [httpMethod, setHttpMethod] = useState('POST')
  const [url, setUrl] = useState('')
  const [headers, setHeaders] = useState<HeaderRow[]>([])
  const [defaultPayload, setDefaultPayload] = useState('')
  const [rateLimitRps, setRateLimitRps] = useState('10')
  const [retryData, setRetryData] = useState<RetryPolicyFormData>(DEFAULT_RETRY_FORM_DATA)
  const [retryErrors, setRetryErrors] = useState<RetryPolicyFormErrors>({})
  const [isLoading, setIsLoading] = useState(false)

  // Validation errors
  const [nameError, setNameError] = useState<string | null>(null)
  const [rateLimitError, setRateLimitError] = useState<string | null>(null)
  const [payloadError, setPayloadError] = useState<string | null>(null)
  const [apiError, setApiError] = useState<string | null>(null)

  useEffect(() => {
    if (isOpen) {
      if (template) {
        setName(template.name || '')
        setDescription(template.description || '')
        setHttpMethod((template.http_method || template.httpMethod || 'POST').toUpperCase())
        setUrl(template.url || '')
        setRateLimitRps(String(template.rate_limit_rps || template.rateLimitRps || 10))

        // Populate headers
        const rawHeaders = template.custom_headers || template.customHeaders || {}
        const rows = Object.entries(rawHeaders).map(([k, v], idx) => ({
          id: `h-${idx}-${Date.now()}`,
          key: k,
          value: String(v),
        }))
        setHeaders(rows)

        // Populate payload
        const rawPayload =
          template.default_payload !== undefined
            ? template.default_payload
            : template.defaultPayload
        if (rawPayload !== undefined && rawPayload !== null) {
          try {
            setDefaultPayload(
              typeof rawPayload === 'string'
                ? rawPayload
                : JSON.stringify(rawPayload, null, 2)
            )
          } catch {
            setDefaultPayload(String(rawPayload))
          }
        } else {
          setDefaultPayload('')
        }

        // Populate retry settings
        setRetryData({
          retryStrategy:
            template.retry_strategy || template.retryStrategy || 'EXPONENTIAL',
          retryMaxAttempts: String(
            template.retry_max_attempts ?? template.retryMaxAttempts ?? 8
          ),
          retryBaseDelayMs: String(
            template.retry_base_delay_ms ?? template.retryBaseDelayMs ?? 5000
          ),
          retryMaxDelayMs: String(
            template.retry_max_delay_ms ?? template.retryMaxDelayMs ?? 3600000
          ),
          retryBackoffMultiplier: String(
            template.retry_backoff_multiplier ??
              template.retryBackoffMultiplier ??
              2.0
          ),
        })
      } else {
        setName('')
        setDescription('')
        setHttpMethod('POST')
        setUrl('')
        setHeaders([
          { id: 'default-header', key: 'Content-Type', value: 'application/json' },
        ])
        setDefaultPayload('')
        setRateLimitRps('10')
        setRetryData(DEFAULT_RETRY_FORM_DATA)
      }

      setNameError(null)
      setRateLimitError(null)
      setPayloadError(null)
      setRetryErrors({})
      setApiError(null)
    }
  }, [isOpen, template])

  const handleAddHeader = () => {
    setHeaders((prev) => [...prev, { id: `h-${Date.now()}`, key: '', value: '' }])
  }

  const handleHeaderChange = (id: string, field: 'key' | 'value', val: string) => {
    setHeaders((prev) =>
      prev.map((h) => (h.id === id ? { ...h, [field]: val } : h))
    )
  }

  const handleRemoveHeader = (id: string) => {
    setHeaders((prev) => prev.filter((h) => h.id !== id))
  }

  const handleRetryChange = (field: keyof RetryPolicyFormData, val: string) => {
    setRetryData((prev) => ({ ...prev, [field]: val }))
    if (retryErrors[field]) {
      setRetryErrors((prev) => ({ ...prev, [field]: undefined }))
    }
  }

  const validate = () => {
    let valid = true
    setNameError(null)
    setRateLimitError(null)
    setPayloadError(null)
    setApiError(null)

    const trimmedName = name.trim()
    if (!trimmedName) {
      setNameError('Template name is required.')
      valid = false
    } else if (trimmedName.length > 100) {
      setNameError('Template name cannot exceed 100 characters.')
      valid = false
    }

    const rps = parseInt(rateLimitRps, 10)
    if (isNaN(rps) || rps < 1 || rps > 500) {
      setRateLimitError('Rate limit must be between 1 and 500 RPS.')
      valid = false
    }

    if (defaultPayload.trim()) {
      try {
        JSON.parse(defaultPayload.trim())
      } catch {
        setPayloadError('Default payload must be valid JSON syntax.')
        valid = false
      }
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
    if (isSystem) return

    const cleanRetry = validate()
    if (!cleanRetry) return

    setIsLoading(true)
    setApiError(null)

    // Assemble custom headers dictionary
    const customHeaders: Record<string, string> = {}
    for (const h of headers) {
      const k = h.key.trim()
      if (k) {
        customHeaders[k] = h.value
      }
    }

    // Assemble payload
    let parsedPayload: any = null
    if (defaultPayload.trim()) {
      try {
        parsedPayload = JSON.parse(defaultPayload.trim())
      } catch {
        parsedPayload = defaultPayload.trim()
      }
    }

    try {
      if (isEditing && template) {
        const updated = await service.updateTemplate(template.id, {
          name: name.trim(),
          description: description.trim() || undefined,
          httpMethod,
          url: url.trim() || undefined,
          customHeaders,
          defaultPayload: parsedPayload,
          rateLimitRps: parseInt(rateLimitRps, 10),
          retryStrategy: cleanRetry.retryStrategy,
          retryMaxAttempts: cleanRetry.retryMaxAttempts,
          retryBaseDelayMs: cleanRetry.retryBaseDelayMs,
          retryMaxDelayMs: cleanRetry.retryMaxDelayMs,
          retryBackoffMultiplier: cleanRetry.retryBackoffMultiplier,
        })

        addToast({
          title: 'Template Updated',
          description: `Template "${updated.name}" updated successfully.`,
          type: 'success',
        })
        onSuccess(updated)
        onClose()
      } else {
        const created = await service.createTemplate({
          name: name.trim(),
          description: description.trim() || undefined,
          httpMethod,
          url: url.trim() || undefined,
          customHeaders,
          defaultPayload: parsedPayload,
          rateLimitRps: parseInt(rateLimitRps, 10),
          retryStrategy: cleanRetry.retryStrategy,
          retryMaxAttempts: cleanRetry.retryMaxAttempts,
          retryBaseDelayMs: cleanRetry.retryBaseDelayMs,
          retryMaxDelayMs: cleanRetry.retryMaxDelayMs,
          retryBackoffMultiplier: cleanRetry.retryBackoffMultiplier,
        })

        addToast({
          title: 'Template Created',
          description: `Custom template "${created.name}" created successfully.`,
          type: 'success',
        })
        onSuccess(created)
        onClose()
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to save template'
      setApiError(msg)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isEditing ? 'Edit Webhook Template' : 'Create Webhook Template'}
      description={
        isEditing
          ? 'Modify settings for your custom webhook template.'
          : 'Define a reusable configuration to streamline endpoint creation.'
      }
      maxWidth="xl"
      footer={
        <div className="flex items-center justify-end gap-2 w-full">
          <Button variant="outline" size="sm" onClick={onClose} disabled={isLoading}>
            Cancel
          </Button>
          {!isSystem && (
            <Button
              variant="primary"
              size="sm"
              onClick={handleSubmit}
              isLoading={isLoading}
            >
              {isEditing ? 'Save Changes' : 'Create Template'}
            </Button>
          )}
        </div>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4 text-left max-h-[72vh] overflow-y-auto px-1 pr-2">
        {isSystem && (
          <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-2 text-xs text-amber-800">
            <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold">Predefined System Template</span>
              <p className="mt-0.5">
                System templates are managed by HookForge and cannot be edited or deleted.
                You can apply this template to an endpoint and customize all settings there.
              </p>
            </div>
          </div>
        )}

        {apiError && (
          <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg flex items-center gap-2 text-xs text-rose-700">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
            <span>{apiError}</span>
          </div>
        )}

        {/* Template Name */}
        <Input
          label="Template Name *"
          placeholder="e.g. Stripe Webhook Listener"
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={nameError || undefined}
          helperText="A descriptive title for this webhook template (max 100 characters)."
          required
          disabled={isLoading || isSystem}
        />

        {/* Description */}
        <div className="space-y-1">
          <label className="text-xs font-semibold text-stone-800">
            Description (Optional)
          </label>
          <textarea
            className="w-full px-3 py-2 text-xs rounded-lg border border-stone-200 focus:outline-none focus:ring-2 focus:ring-stone-900/10 focus:border-stone-900 bg-white disabled:bg-stone-50 disabled:text-stone-400 resize-none h-18"
            placeholder="Explain what this template configures and when to use it..."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={isLoading || isSystem}
          />
        </div>

        {/* Method & Rate Limit in 2 columns */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-xs font-semibold text-stone-800">
              HTTP Method
            </label>
            <select
              className="w-full h-9 px-3 text-xs rounded-lg border border-stone-200 focus:outline-none focus:ring-2 focus:ring-stone-900/10 focus:border-stone-900 bg-white font-mono font-medium disabled:bg-stone-50"
              value={httpMethod}
              onChange={(e) => setHttpMethod(e.target.value)}
              disabled={isLoading || isSystem}
            >
              {HTTP_METHODS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>

          <Input
            label="Rate Limit (RPS)"
            type="number"
            min={1}
            max={500}
            value={rateLimitRps}
            onChange={(e) => setRateLimitRps(e.target.value)}
            error={rateLimitError || undefined}
            helperText="Allowed requests per second (1–500)."
            disabled={isLoading || isSystem}
          />
        </div>

        {/* Target URL placeholder */}
        <Input
          label="Destination URL (Optional / Placeholder)"
          placeholder="https://api.example.com/webhook"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          helperText="Predefined or placeholder URL to prefill when applying this template."
          disabled={isLoading || isSystem}
        />

        {/* Custom Headers Row Editor */}
        <div className="space-y-2 pt-2 border-t border-stone-200">
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold text-stone-800 flex items-center gap-1.5">
              <Code2 className="w-3.5 h-3.5 text-stone-500" />
              Custom Headers
            </label>
            {!isSystem && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleAddHeader}
                leftIcon={<Plus className="w-3 h-3" />}
                disabled={isLoading}
              >
                Add Header
              </Button>
            )}
          </div>

          {headers.length === 0 ? (
            <p className="text-xs text-stone-400 italic">No custom headers added.</p>
          ) : (
            <div className="space-y-2">
              {headers.map((h) => (
                <div key={h.id} className="flex items-center gap-2">
                  <input
                    type="text"
                    className="flex-1 px-2.5 py-1.5 text-xs font-mono rounded-lg border border-stone-200 focus:outline-none focus:border-stone-900 bg-white disabled:bg-stone-50"
                    placeholder="Header name (e.g. X-Api-Key)"
                    value={h.key}
                    onChange={(e) => handleHeaderChange(h.id, 'key', e.target.value)}
                    disabled={isLoading || isSystem}
                  />
                  <input
                    type="text"
                    className="flex-1 px-2.5 py-1.5 text-xs font-mono rounded-lg border border-stone-200 focus:outline-none focus:border-stone-900 bg-white disabled:bg-stone-50"
                    placeholder="Value (e.g. Bearer token)"
                    value={h.value}
                    onChange={(e) => handleHeaderChange(h.id, 'value', e.target.value)}
                    disabled={isLoading || isSystem}
                  />
                  {!isSystem && (
                    <button
                      type="button"
                      onClick={() => handleRemoveHeader(h.id)}
                      className="p-1.5 text-stone-400 hover:text-rose-600 rounded transition-colors"
                      title="Remove header"
                      disabled={isLoading}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Default Payload */}
        <div className="space-y-1 pt-2 border-t border-stone-200">
          <label className="text-xs font-semibold text-stone-800">
            Default Payload Template (Optional JSON)
          </label>
          <textarea
            className={`w-full px-3 py-2 text-xs font-mono rounded-lg border focus:outline-none bg-stone-900 text-stone-100 disabled:opacity-70 resize-none h-24 ${
              payloadError ? 'border-rose-400' : 'border-stone-800'
            }`}
            placeholder='{ "event": "sample.event", "data": {} }'
            value={defaultPayload}
            onChange={(e) => setDefaultPayload(e.target.value)}
            disabled={isLoading || isSystem}
          />
          {payloadError && (
            <p className="text-xs text-rose-600 font-medium">{payloadError}</p>
          )}
        </div>

        {/* Retry Policy Sub-form */}
        <div className="pt-2 border-t border-stone-200">
          <RetryPolicyConfigForm
            values={retryData}
            errors={retryErrors}
            onChange={handleRetryChange}
            disabled={isLoading || isSystem}
          />
        </div>
      </form>
    </Modal>
  )
}

