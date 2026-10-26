import React, { useState } from 'react'
import { Modal } from './ui/Modal'
import { Input } from './ui/Input'
import { Button } from './ui/Button'
import { useApp } from '../context/AppContext'
import { Send, RefreshCw, CheckCircle2, AlertCircle } from 'lucide-react'

interface SendEventModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess?: () => void
}

const DEFAULT_SAMPLE_PAYLOAD = {
  id: 'evt_sample_' + Math.floor(1000 + Math.random() * 9000),
  event: 'payment.succeeded',
  created: Math.floor(Date.now() / 1000),
  data: {
    amount: 14900,
    currency: 'usd',
    customer: 'cus_demo_7812',
    receipt_url: 'https://pay.example.com/receipts/rcpt_1029',
  },
}

export const SendEventModal: React.FC<SendEventModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
}) => {
  const { service, addToast } = useApp()

  const generateIdempotencyKey = () => `ik_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`

  const [idempotencyKey, setIdempotencyKey] = useState(generateIdempotencyKey)
  const [eventType, setEventType] = useState('payment.succeeded')
  const [payloadText, setPayloadText] = useState(JSON.stringify(DEFAULT_SAMPLE_PAYLOAD, null, 2))
  const [isLoading, setIsLoading] = useState(false)
  const [jsonError, setJsonError] = useState<string | null>(null)
  const [apiError, setApiError] = useState<string | null>(null)
  const [result, setResult] = useState<{ duplicate: boolean; deliveriesEnqueued: number; eventId?: string } | null>(null)

  const handleReset = () => {
    setIdempotencyKey(generateIdempotencyKey())
    setEventType('payment.succeeded')
    setPayloadText(JSON.stringify(DEFAULT_SAMPLE_PAYLOAD, null, 2))
    setJsonError(null)
    setApiError(null)
    setResult(null)
    onClose()
  }

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault()
    setJsonError(null)
    setApiError(null)

    let parsedPayload: Record<string, unknown>
    try {
      parsedPayload = JSON.parse(payloadText)
    } catch {
      setJsonError('Invalid JSON format. Please ensure syntax is valid JSON.')
      return
    }

    setIsLoading(true)

    try {
      const res = await service.ingestEvent({
        idempotency_key: idempotencyKey.trim(),
        event_type: eventType.trim(),
        payload: parsedPayload,
      })

      setResult(res)

      if (res.duplicate) {
        addToast({
          title: 'Duplicate Event Suppressed',
          description: `Idempotency key ${idempotencyKey} already exists. 0 new deliveries created.`,
          type: 'warning',
        })
      } else {
        addToast({
          title: 'Event Enqueued Successfully',
          description: `Dispatched to ${res.deliveriesEnqueued} active endpoint(s).`,
          type: 'success',
        })
      }

      if (onSuccess) {
        onSuccess()
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to ingest event'
      setApiError(msg)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleReset}
      title="Send Webhook Event"
      description="Publish an event through HookForge's ingest pipeline and trigger atomic delivery fan-out."
      maxWidth="lg"
      footer={
        <div className="flex items-center justify-between w-full">
          <Button variant="ghost" size="sm" onClick={handleReset}>
            {result ? 'Done' : 'Cancel'}
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={handleSend}
            isLoading={isLoading}
            leftIcon={<Send className="w-3.5 h-3.5" />}
          >
            Dispatch Event
          </Button>
        </div>
      }
    >
      <form onSubmit={handleSend} className="space-y-4 text-left">
        {result && (
          <div
            className={`p-3.5 rounded-xl border flex items-start gap-2.5 text-xs ${
              result.duplicate
                ? 'bg-amber-50 border-amber-200 text-amber-900'
                : 'bg-emerald-50 border-emerald-200 text-emerald-900'
            }`}
          >
            <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-600" />
            <div>
              <p className="font-semibold">
                {result.duplicate ? 'Idempotency Conflict Detected' : 'Event Successfully Ingested'}
              </p>
              <p className="mt-0.5">
                {result.duplicate
                  ? `An event with this idempotency key already exists. No duplicate deliveries were queued.`
                  : `Created ${result.deliveriesEnqueued} delivery work row(s) for active endpoints.`}
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

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input
            label="Event Type"
            placeholder="e.g. order.created"
            value={eventType}
            onChange={(e) => setEventType(e.target.value)}
            required
          />

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-slate-700">Idempotency Key</label>
              <button
                type="button"
                onClick={() => setIdempotencyKey(generateIdempotencyKey())}
                className="text-2xs text-slate-500 hover:text-slate-800 flex items-center gap-1 cursor-pointer"
              >
                <RefreshCw className="w-2.5 h-2.5" />
                <span>Regenerate</span>
              </button>
            </div>
            <Input
              value={idempotencyKey}
              onChange={(e) => setIdempotencyKey(e.target.value)}
              helperText="Enforces at-most-once deduplication per tenant."
              required
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="block text-xs font-medium text-slate-700">JSON Payload</label>
          <textarea
            rows={8}
            className={`w-full font-mono text-xs p-3 rounded-lg border bg-slate-50/50 text-slate-900 focus:bg-white focus:outline-none focus:ring-1 focus:ring-slate-900 ${
              jsonError ? 'border-rose-400' : 'border-slate-300'
            }`}
            value={payloadText}
            onChange={(e) => {
              setPayloadText(e.target.value)
              if (jsonError) setJsonError(null)
            }}
          />
          {jsonError ? (
            <p className="text-xs text-rose-600 font-medium">{jsonError}</p>
          ) : (
            <p className="text-2xs text-slate-400">Payload must be valid JSON (max 256KB cap).</p>
          )}
        </div>
      </form>
    </Modal>
  )
}
