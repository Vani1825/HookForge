import React, { useState } from 'react'
import { Drawer } from './ui/Drawer'
import { Button } from './ui/Button'
import { formatDateTime, formatDuration, copyToClipboard } from '../utils/formatters'
import type { WebhookTemplate } from '../types'
import {
  BookmarkCheck,
  Copy,
  Check,
  RotateCcw,
  Edit3,
  Trash2,
  Shield,
  Code2,
  FileJson,
  Zap,
  Globe2,
} from 'lucide-react'

interface TemplateDetailDrawerProps {
  isOpen: boolean
  onClose: () => void
  template: WebhookTemplate | null
  onApply: (template: WebhookTemplate) => void
  onEdit?: (template: WebhookTemplate) => void
  onDelete?: (template: WebhookTemplate) => void
}

export const TemplateDetailDrawer: React.FC<TemplateDetailDrawerProps> = ({
  isOpen,
  onClose,
  template,
  onApply,
  onEdit,
  onDelete,
}) => {
  const [copiedId, setCopiedId] = useState(false)

  if (!template) return null

  const handleCopyId = async () => {
    const ok = await copyToClipboard(template.id)
    if (ok) {
      setCopiedId(true)
      setTimeout(() => setCopiedId(false), 2000)
    }
  }

  const strategy = (
    template.retry_strategy ||
    template.retryStrategy ||
    template.retry_policy?.strategy ||
    template.retryPolicy?.strategy ||
    'EXPONENTIAL'
  ).toUpperCase() as 'EXPONENTIAL' | 'FIXED'

  const maxAttempts =
    template.retry_max_attempts ??
    template.retryMaxAttempts ??
    template.retry_policy?.maxAttempts ??
    template.retryPolicy?.maxAttempts ??
    8

  const baseDelayMs =
    template.retry_base_delay_ms ??
    template.retryBaseDelayMs ??
    template.retry_policy?.baseDelayMs ??
    template.retryPolicy?.baseDelayMs ??
    5000

  const maxDelayMs =
    template.retry_max_delay_ms ??
    template.retryMaxDelayMs ??
    template.retry_policy?.maxDelayMs ??
    template.retryPolicy?.maxDelayMs ??
    (strategy === 'FIXED' ? baseDelayMs : 3600000)

  const backoffMultiplier =
    template.retry_backoff_multiplier ??
    template.retryBackoffMultiplier ??
    template.retry_policy?.backoffMultiplier ??
    template.retryPolicy?.backoffMultiplier ??
    (strategy === 'FIXED' ? 1.0 : 2.0)

  const isSystem = Boolean(template.is_system || template.isSystem)
  const headers = template.custom_headers || template.customHeaders || {}
  const headerKeys = Object.keys(headers)

  const payload =
    template.default_payload !== undefined
      ? template.default_payload
      : template.defaultPayload

  let formattedPayload: string | null = null
  if (payload !== undefined && payload !== null) {
    try {
      formattedPayload =
        typeof payload === 'string'
          ? JSON.stringify(JSON.parse(payload), null, 2)
          : JSON.stringify(payload, null, 2)
    } catch {
      formattedPayload = String(payload)
    }
  }

  return (
    <Drawer
      isOpen={isOpen}
      onClose={onClose}
      title={template.name}
      subtitle={isSystem ? 'Predefined System Template' : 'User Custom Template'}
      width="xl"
      footer={
        <div className="flex items-center justify-between w-full">
          <div className="flex items-center gap-2">
            {!isSystem && onEdit && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  onClose()
                  onEdit(template)
                }}
                leftIcon={<Edit3 className="w-3.5 h-3.5" />}
              >
                Edit
              </Button>
            )}
            {!isSystem && onDelete && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  onClose()
                  onDelete(template)
                }}
                leftIcon={<Trash2 className="w-3.5 h-3.5 text-rose-500" />}
                className="text-rose-600 hover:bg-rose-50 border-rose-200"
              >
                Delete
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>
              Close
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                onClose()
                onApply(template)
              }}
              leftIcon={<BookmarkCheck className="w-3.5 h-3.5" />}
            >
              Apply Template
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-6 text-left">
        {/* Type & Identity Banner */}
        <div className="flex items-center justify-between p-3.5 bg-stone-50 rounded-xl border border-stone-200/80">
          <div className="flex items-center gap-2.5">
            <span
              className={`px-2.5 py-1 text-xs font-semibold rounded-md border ${
                isSystem
                  ? 'bg-purple-50 text-purple-700 border-purple-200'
                  : 'bg-emerald-50 text-emerald-700 border-emerald-200'
              }`}
            >
              {isSystem ? 'System Template' : 'Custom Template'}
            </span>
            <span className="px-2 py-0.5 text-xs font-mono font-bold bg-stone-100 text-stone-800 rounded border border-stone-200">
              {template.http_method || template.httpMethod || 'POST'}
            </span>
          </div>

          <div className="flex items-center gap-1.5 text-xs text-stone-500 font-mono">
            <span>{template.id.slice(0, 13)}...</span>
            <button
              onClick={handleCopyId}
              className="p-1 hover:bg-stone-200/60 rounded transition-colors text-stone-600"
              title="Copy Template ID"
            >
              {copiedId ? (
                <Check className="w-3.5 h-3.5 text-emerald-600" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
            </button>
          </div>
        </div>

        {/* Description */}
        {template.description && (
          <div className="space-y-1">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-stone-500">
              Description
            </h4>
            <p className="text-sm text-stone-700 leading-relaxed bg-white p-3 rounded-lg border border-stone-200">
              {template.description}
            </p>
          </div>
        )}

        {/* Destination URL */}
        <div className="space-y-1">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-stone-500">
            Target Destination URL
          </h4>
          <div className="flex items-center gap-2 p-2.5 bg-stone-50 rounded-lg border border-stone-200 font-mono text-xs text-stone-800">
            <Globe2 className="w-4 h-4 text-stone-400 shrink-0" />
            <span className="break-all">
              {template.url || '(Prompted upon applying template)'}
            </span>
          </div>
        </div>

        {/* Configuration Summary Badges */}
        <div className="grid grid-cols-2 gap-3">
          <div className="p-3 bg-white border border-stone-200 rounded-lg">
            <div className="flex items-center gap-2 text-stone-500 text-xs font-medium">
              <Zap className="w-3.5 h-3.5 text-amber-500" />
              <span>Rate Limit</span>
            </div>
            <div className="text-base font-bold text-stone-800 mt-1">
              {template.rate_limit_rps || template.rateLimitRps || 10} RPS
            </div>
          </div>

          <div className="p-3 bg-white border border-stone-200 rounded-lg">
            <div className="flex items-center gap-2 text-stone-500 text-xs font-medium">
              <RotateCcw className="w-3.5 h-3.5 text-indigo-500" />
              <span>Retry Strategy</span>
            </div>
            <div className="text-base font-bold text-stone-800 mt-1">
              {strategy === 'FIXED' ? 'Fixed Delay' : 'Exponential Backoff'}
            </div>
          </div>
        </div>

        {/* Retry Policy Configuration Box */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <RotateCcw className="w-4 h-4 text-indigo-600" />
            <h4 className="text-xs font-semibold uppercase tracking-wider text-stone-700">
              Retry Policy Configuration
            </h4>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs bg-stone-50 p-3.5 rounded-xl border border-stone-200">
            <div className="p-2 bg-white rounded border border-stone-200">
              <span className="text-stone-500 block text-[11px]">Max Attempts</span>
              <span className="font-bold text-stone-800 text-sm mt-0.5 block">
                {maxAttempts}
              </span>
            </div>

            <div className="p-2 bg-white rounded border border-stone-200">
              <span className="text-stone-500 block text-[11px]">Base Delay</span>
              <span className="font-bold text-stone-800 text-sm mt-0.5 block">
                {formatDuration(baseDelayMs)}
              </span>
            </div>

            <div className="p-2 bg-white rounded border border-stone-200">
              <span className="text-stone-500 block text-[11px]">Max Delay</span>
              <span className="font-bold text-stone-800 text-sm mt-0.5 block">
                {formatDuration(maxDelayMs)}
              </span>
            </div>

            <div className="p-2 bg-white rounded border border-stone-200">
              <span className="text-stone-500 block text-[11px]">Multiplier</span>
              <span className="font-bold text-stone-800 text-sm mt-0.5 block">
                {strategy === 'FIXED' ? '1.0x (Fixed)' : `${backoffMultiplier}x`}
              </span>
            </div>
          </div>
        </div>

        {/* Custom Headers */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Code2 className="w-4 h-4 text-stone-600" />
              <h4 className="text-xs font-semibold uppercase tracking-wider text-stone-700">
                Custom Headers ({headerKeys.length})
              </h4>
            </div>
          </div>

          {headerKeys.length === 0 ? (
            <p className="text-xs text-stone-400 italic bg-stone-50 p-3 rounded-lg border border-stone-200">
              No custom headers defined for this template.
            </p>
          ) : (
            <div className="border border-stone-200 rounded-lg overflow-hidden bg-white text-xs">
              <div className="grid grid-cols-2 bg-stone-100/80 px-3 py-2 font-semibold text-stone-600 border-b border-stone-200">
                <span>Header Name</span>
                <span>Header Value</span>
              </div>
              <div className="divide-y divide-stone-100">
                {headerKeys.map((key) => {
                  const val = String(headers[key])
                  const isRedacted = val === '[REDACTED]'
                  return (
                    <div key={key} className="grid grid-cols-2 px-3 py-2 items-center gap-2 font-mono">
                      <span className="font-semibold text-stone-800 break-all">{key}</span>
                      <span className="break-all flex items-center gap-1.5">
                        {isRedacted ? (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-200 rounded">
                            <Shield className="w-3 h-3 text-amber-600" />
                            [REDACTED]
                          </span>
                        ) : (
                          <span className="text-stone-600">{val}</span>
                        )}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        {/* Default Payload Preview */}
        {formattedPayload && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <FileJson className="w-4 h-4 text-stone-600" />
              <h4 className="text-xs font-semibold uppercase tracking-wider text-stone-700">
                Default Payload Template
              </h4>
            </div>

            <pre className="p-3 bg-stone-900 text-stone-100 rounded-lg font-mono text-xs overflow-x-auto max-h-52 leading-relaxed">
              {formattedPayload}
            </pre>
          </div>
        )}

        {/* Timestamps */}
        <div className="pt-2 border-t border-stone-200/80 flex items-center justify-between text-xs text-stone-400">
          <span>Created: {formatDateTime(template.created_at || template.createdAt)}</span>
          <span>Updated: {formatDateTime(template.updated_at || template.updatedAt)}</span>
        </div>
      </div>
    </Drawer>
  )
}
