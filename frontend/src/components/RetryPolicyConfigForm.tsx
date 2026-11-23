import React from 'react'
import { Input } from './ui/Input'
import { formatDuration } from '../utils/formatters'
import { RotateCcw, Zap, Clock, Info } from 'lucide-react'

export interface RetryPolicyFormData {
  retryStrategy: 'EXPONENTIAL' | 'FIXED'
  retryMaxAttempts: string | number
  retryBaseDelayMs: string | number
  retryMaxDelayMs: string | number
  retryBackoffMultiplier: string | number
}

export interface RetryPolicyFormErrors {
  retryStrategy?: string
  retryMaxAttempts?: string
  retryBaseDelayMs?: string
  retryMaxDelayMs?: string
  retryBackoffMultiplier?: string
}

export const DEFAULT_RETRY_FORM_DATA: RetryPolicyFormData = {
  retryStrategy: 'EXPONENTIAL',
  retryMaxAttempts: '8',
  retryBaseDelayMs: '5000',
  retryMaxDelayMs: '3600000',
  retryBackoffMultiplier: '2.0',
}

export function validateRetryPolicyForm(values: RetryPolicyFormData): {
  isValid: boolean
  errors: RetryPolicyFormErrors
  cleanValues: {
    retryStrategy: 'EXPONENTIAL' | 'FIXED'
    retryMaxAttempts: number
    retryBaseDelayMs: number
    retryMaxDelayMs: number
    retryBackoffMultiplier: number
  }
} {
  const errors: RetryPolicyFormErrors = {}
  const strategy = values.retryStrategy || 'EXPONENTIAL'

  const maxAttempts =
    typeof values.retryMaxAttempts === 'number'
      ? values.retryMaxAttempts
      : parseInt(String(values.retryMaxAttempts || ''), 10)
  if (isNaN(maxAttempts) || maxAttempts < 1 || maxAttempts > 50) {
    errors.retryMaxAttempts = 'Maximum retry attempts must be between 1 and 50.'
  }

  const baseDelayMs =
    typeof values.retryBaseDelayMs === 'number'
      ? values.retryBaseDelayMs
      : parseInt(String(values.retryBaseDelayMs || ''), 10)
  if (isNaN(baseDelayMs) || baseDelayMs < 100 || baseDelayMs > 86400000) {
    errors.retryBaseDelayMs = 'Base delay must be between 100 ms and 86,400,000 ms (24 hours).'
  }

  let maxDelayMs = baseDelayMs
  let backoffMultiplier = 1.0

  if (strategy === 'EXPONENTIAL') {
    maxDelayMs =
      typeof values.retryMaxDelayMs === 'number'
        ? values.retryMaxDelayMs
        : parseInt(String(values.retryMaxDelayMs || ''), 10)
    if (isNaN(maxDelayMs) || maxDelayMs < 100 || maxDelayMs > 86400000) {
      errors.retryMaxDelayMs = 'Maximum delay cap must be between 100 ms and 86,400,000 ms (24 hours).'
    } else if (!isNaN(baseDelayMs) && maxDelayMs < baseDelayMs) {
      errors.retryMaxDelayMs = 'Maximum delay cap must be greater than or equal to base delay.'
    }

    backoffMultiplier =
      typeof values.retryBackoffMultiplier === 'number'
        ? values.retryBackoffMultiplier
        : parseFloat(String(values.retryBackoffMultiplier || ''))
    if (isNaN(backoffMultiplier) || backoffMultiplier < 1.0 || backoffMultiplier > 10.0) {
      errors.retryBackoffMultiplier = 'Backoff multiplier must be between 1.0 and 10.0.'
    }
  } else {
    maxDelayMs = isNaN(baseDelayMs) ? 5000 : baseDelayMs
    backoffMultiplier = 1.0
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
    cleanValues: {
      retryStrategy: strategy,
      retryMaxAttempts: isNaN(maxAttempts) ? 8 : maxAttempts,
      retryBaseDelayMs: isNaN(baseDelayMs) ? 5000 : baseDelayMs,
      retryMaxDelayMs: isNaN(maxDelayMs) ? 3600000 : maxDelayMs,
      retryBackoffMultiplier: isNaN(backoffMultiplier) ? 2.0 : backoffMultiplier,
    },
  }
}

interface RetryPolicyConfigFormProps {
  values: RetryPolicyFormData
  errors: RetryPolicyFormErrors
  onChange: (field: keyof RetryPolicyFormData, value: string) => void
  disabled?: boolean
}

export const RetryPolicyConfigForm: React.FC<RetryPolicyConfigFormProps> = ({
  values,
  errors,
  onChange,
  disabled = false,
}) => {
  const isExponential = values.retryStrategy === 'EXPONENTIAL'

  const baseMs = parseInt(String(values.retryBaseDelayMs || '0'), 10)
  const maxMs = parseInt(String(values.retryMaxDelayMs || '0'), 10)
  const multiplier = parseFloat(String(values.retryBackoffMultiplier || '1.0'))
  const attempts = Math.min(Math.max(parseInt(String(values.retryMaxAttempts || '0'), 10) || 0, 0), 8)

  // Compute preview timeline for the first few retries
  const previewTimeline: { attempt: number; delay: number; formatted: string }[] = []
  if (attempts > 0 && !isNaN(baseMs) && baseMs > 0) {
    let currentDelay = baseMs
    for (let i = 1; i <= Math.min(attempts, 5); i++) {
      if (isExponential) {
        currentDelay = Math.min(
          Math.round(baseMs * Math.pow(isNaN(multiplier) ? 2.0 : multiplier, i - 1)),
          !isNaN(maxMs) && maxMs > 0 ? maxMs : 3600000
        )
      } else {
        currentDelay = baseMs
      }
      previewTimeline.push({
        attempt: i,
        delay: currentDelay,
        formatted: formatDuration(currentDelay),
      })
    }
  }

  return (
    <div className="space-y-4 pt-2 border-t border-[#E7E8EC]">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <RotateCcw className="w-4 h-4 text-[#5277D9]" />
          <h4 className="text-xs font-semibold text-[#202938]">Custom Retry Policy</h4>
        </div>
        <span className="text-3xs text-[#64748B]">Auto-redelivery on transient failures</span>
      </div>

      {/* Strategy Selector (Exponential vs Fixed) */}
      <div className="space-y-1.5">
        <label className="block text-xs font-semibold text-[#202938]">
          Retry Strategy <span className="text-[#E76B64]">*</span>
        </label>
        <div className="grid grid-cols-2 gap-2" data-testid="retry-strategy-selector">
          <button
            type="button"
            disabled={disabled}
            onClick={() => onChange('retryStrategy', 'EXPONENTIAL')}
            data-testid="strategy-exponential-btn"
            className={`p-2.5 rounded-lg border text-left flex flex-col gap-1 transition-all cursor-pointer ${
              isExponential
                ? 'bg-[#EAF0FF] border-[#5277D9] text-[#202938] ring-1 ring-[#5277D9]'
                : 'bg-white border-[#E7E8EC] text-[#64748B] hover:bg-[#F7F6F2]'
            }`}
          >
            <div className="flex items-center gap-1.5">
              <Zap className={`w-3.5 h-3.5 ${isExponential ? 'text-[#5277D9]' : 'text-[#64748B]'}`} />
              <span className="text-xs font-semibold">Exponential Backoff</span>
            </div>
            <p className="text-3xs text-[#64748B]">
              Increases delay exponentially after each failed attempt with a maximum cap.
            </p>
          </button>

          <button
            type="button"
            disabled={disabled}
            onClick={() => onChange('retryStrategy', 'FIXED')}
            data-testid="strategy-fixed-btn"
            className={`p-2.5 rounded-lg border text-left flex flex-col gap-1 transition-all cursor-pointer ${
              !isExponential
                ? 'bg-[#EAF0FF] border-[#5277D9] text-[#202938] ring-1 ring-[#5277D9]'
                : 'bg-white border-[#E7E8EC] text-[#64748B] hover:bg-[#F7F6F2]'
            }`}
          >
            <div className="flex items-center gap-1.5">
              <Clock className={`w-3.5 h-3.5 ${!isExponential ? 'text-[#5277D9]' : 'text-[#64748B]'}`} />
              <span className="text-xs font-semibold">Fixed Delay</span>
            </div>
            <p className="text-3xs text-[#64748B]">
              Retries at a constant, consistent interval between attempts.
            </p>
          </button>
        </div>
      </div>

      {/* Numeric Controls Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {/* Maximum Attempts */}
        <Input
          label="Maximum Retry Attempts *"
          type="number"
          min={1}
          max={50}
          value={values.retryMaxAttempts}
          onChange={(e) => onChange('retryMaxAttempts', e.target.value)}
          error={errors.retryMaxAttempts}
          helperText="Total retries before sending to Dead Letter Queue (1–50)."
          disabled={disabled}
          data-testid="retry-max-attempts"
        />

        {/* Base Delay */}
        <div>
          <Input
            label={isExponential ? 'Base Delay (ms) *' : 'Fixed Delay (ms) *'}
            type="number"
            min={100}
            max={86400000}
            step={100}
            value={values.retryBaseDelayMs}
            onChange={(e) => onChange('retryBaseDelayMs', e.target.value)}
            error={errors.retryBaseDelayMs}
            helperText={
              !isNaN(baseMs) && baseMs >= 100
                ? `Initial delay (${formatDuration(baseMs)}). Range: 100ms – 24h.`
                : 'Range: 100ms – 24h (86,400,000 ms).'
            }
            disabled={disabled}
            data-testid="retry-base-delay"
          />
        </div>

        {/* Exponential Specific: Max Delay Cap */}
        {isExponential && (
          <Input
            label="Maximum Delay Cap (ms) *"
            type="number"
            min={100}
            max={86400000}
            step={1000}
            value={values.retryMaxDelayMs}
            onChange={(e) => onChange('retryMaxDelayMs', e.target.value)}
            error={errors.retryMaxDelayMs}
            helperText={
              !isNaN(maxMs) && maxMs >= 100
                ? `Upper ceiling (${formatDuration(maxMs)}). >= Base delay.`
                : 'Upper ceiling. Must be >= Base delay.'
            }
            disabled={disabled}
            data-testid="retry-max-delay"
          />
        )}

        {/* Exponential Specific: Multiplier */}
        {isExponential && (
          <Input
            label="Backoff Multiplier *"
            type="number"
            min={1.0}
            max={10.0}
            step={0.1}
            value={values.retryBackoffMultiplier}
            onChange={(e) => onChange('retryBackoffMultiplier', e.target.value)}
            error={errors.retryBackoffMultiplier}
            helperText="Growth factor per attempt (1.0 to 10.0, default 2.0)."
            disabled={disabled}
            data-testid="retry-multiplier"
          />
        )}
      </div>

      {/* Dynamic Schedule Preview */}
      {previewTimeline.length > 0 && (
        <div className="p-3 bg-[#F7F6F2] rounded-lg border border-[#E7E8EC] space-y-1.5" data-testid="retry-schedule-preview">
          <div className="flex items-center gap-1.5 text-2xs font-semibold text-[#202938]">
            <Info className="w-3.5 h-3.5 text-[#5277D9]" />
            <span>Projected Retry Schedule (First {previewTimeline.length} attempts)</span>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {previewTimeline.map((item, idx) => (
              <React.Fragment key={item.attempt}>
                {idx > 0 && <span className="text-[#64748B] text-3xs font-bold">&rarr;</span>}
                <div className="px-2 py-1 bg-white border border-[#E7E8EC] rounded text-3xs font-mono text-[#202938]">
                  <span className="text-[#64748B]">#{item.attempt}:</span>{' '}
                  <span className="font-semibold text-[#5277D9]">+{item.formatted}</span>
                </div>
              </React.Fragment>
            ))}
            {attempts > previewTimeline.length && (
              <span className="text-3xs text-[#64748B] italic">+{attempts - previewTimeline.length} more attempts</span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
