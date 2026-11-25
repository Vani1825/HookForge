import React, { useState, useEffect, useRef } from 'react'
import { Modal } from './ui/Modal'
import { Button } from './ui/Button'
import { Input } from './ui/Input'
import { useApp } from '../context/AppContext'
import { Calendar, Clock, AlertCircle, ArrowLeft, CheckCircle2 } from 'lucide-react'
import type { Endpoint, Delivery } from '../types'
import { formatErrorMessage } from '../api/client'

interface ScheduleDeliveryModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: (delivery?: Delivery) => void
  initialEndpointId?: string
}

export const ScheduleDeliveryModal: React.FC<ScheduleDeliveryModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  initialEndpointId,
}) => {
  const { service, addToast } = useApp()

  const [endpoints, setEndpoints] = useState<Endpoint[]>([])
  const [selectedEndpointId, setSelectedEndpointId] = useState<string>(initialEndpointId || '')
  const [scheduledAt, setScheduledAt] = useState<string>('')
  const [mode, setPayloadMode] = useState<'payload' | 'event'>('payload')
  const [payloadText, setPayloadText] = useState<string>('{\n  "event": "order.completed",\n  "data": {\n    "orderId": "ord_101",\n    "amount": 99.99\n  }\n}')
  const [eventId, setEventId] = useState<string>('')
  const [idempotencyKey, setIdempotencyKey] = useState<string>('')

  // Multi-step review state
  const [step, setStep] = useState<'form' | 'review'>('form')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Fetch endpoints when open
  useEffect(() => {
    if (isOpen) {
      service.getEndpoints().then((list) => {
        setEndpoints(list)
        if (!selectedEndpointId && list.length > 0) {
          setSelectedEndpointId(initialEndpointId || list[0].id)
        }
      }).catch(() => {})
    }
  }, [isOpen, service, initialEndpointId, selectedEndpointId])

  // Initialize form only when opening
  const prevOpenRef = useRef(false)
  useEffect(() => {
    if (isOpen && !prevOpenRef.current) {
      const defaultDate = new Date(Date.now() + 10 * 60 * 1000)
      const year = defaultDate.getFullYear()
      const month = String(defaultDate.getMonth() + 1).padStart(2, '0')
      const day = String(defaultDate.getDate()).padStart(2, '0')
      const hours = String(defaultDate.getHours()).padStart(2, '0')
      const minutes = String(defaultDate.getMinutes()).padStart(2, '0')
      setScheduledAt(`${year}-${month}-${day}T${hours}:${minutes}`)
      setError(null)
      setStep('form')
    }
    prevOpenRef.current = isOpen
  }, [isOpen])

  if (!isOpen) return null

  const getMinDateTime = (): string => {
    const now = new Date(Date.now() + 60 * 1000) // At least 1 minute ahead
    const year = now.getFullYear()
    const month = String(now.getMonth() + 1).padStart(2, '0')
    const day = String(now.getDate()).padStart(2, '0')
    const hours = String(now.getHours()).padStart(2, '0')
    const minutes = String(now.getMinutes()).padStart(2, '0')
    return `${year}-${month}-${day}T${hours}:${minutes}`
  }

  const handleProceedToReview = (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!selectedEndpointId) {
      setError('Please select a destination webhook endpoint.')
      return
    }

    if (!scheduledAt) {
      setError('Please choose a scheduled execution date and time.')
      return
    }

    const scheduledTimestamp = new Date(scheduledAt).getTime()
    if (isNaN(scheduledTimestamp)) {
      setError('Please enter a valid scheduled date and time.')
      return
    }

    if (scheduledTimestamp <= Date.now()) {
      setError('Scheduled time must be in the future.')
      return
    }

    if (mode === 'payload') {
      try {
        const parsed = JSON.parse(payloadText)
        if (typeof parsed !== 'object' || parsed === null) {
          setError('Payload must be a valid JSON object.')
          return
        }
      } catch {
        setError('Invalid JSON payload syntax. Please check your JSON format.')
        return
      }
    } else {
      if (!eventId.trim()) {
        setError('Please provide a valid Event UUID reference.')
        return
      }
    }

    setStep('review')
  }

  const handleConfirmSchedule = async () => {
    setIsLoading(true)
    setError(null)

    try {
      const scheduledIso = new Date(scheduledAt).toISOString()

      let parsedPayload: Record<string, unknown> | undefined = undefined
      if (mode === 'payload') {
        parsedPayload = JSON.parse(payloadText)
      }

      const created = await service.scheduleDelivery({
        endpointId: selectedEndpointId,
        scheduledAt: scheduledIso,
        payload: parsedPayload,
        eventId: mode === 'event' ? eventId.trim() : undefined,
        idempotencyKey: idempotencyKey.trim() || undefined,
      })

      addToast({
        title: 'Webhook Delivery Scheduled',
        description: `Delivery successfully scheduled for ${new Date(scheduledIso).toLocaleString()}.`,
        type: 'success',
      })

      onSuccess(created)
      onClose()
    } catch (err: unknown) {
      const msg = formatErrorMessage(err)
      setError(msg)
    } finally {
      setIsLoading(false)
    }
  }

  const selectedEndpoint = endpoints.find((ep) => ep.id === selectedEndpointId)

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={step === 'review' ? 'Confirm Scheduled Delivery' : 'Schedule Webhook Delivery'}
      description={
        step === 'review'
          ? 'Review the delivery parameters and destination before scheduling execution.'
          : 'Schedule a webhook delivery to be dispatched at a precise future date and time.'
      }
      maxWidth="lg"
      footer={
        <div className="flex items-center justify-between w-full">
          {step === 'review' ? (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setStep('form')}
                disabled={isLoading}
                leftIcon={<ArrowLeft className="w-3.5 h-3.5" />}
              >
                Back to Edit
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={handleConfirmSchedule}
                isLoading={isLoading}
                leftIcon={<CheckCircle2 className="w-3.5 h-3.5" />}
              >
                Confirm & Schedule
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" size="sm" onClick={onClose} disabled={isLoading}>
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={handleProceedToReview}
                leftIcon={<Calendar className="w-3.5 h-3.5" />}
              >
                Review Schedule
              </Button>
            </>
          )}
        </div>
      }
    >
      <div className="space-y-4 text-left">
        {error && (
          <div className="p-3 bg-[#E76B64]/10 border border-[#E76B64]/25 rounded-lg flex items-center gap-2 text-xs text-[#E76B64]">
            <AlertCircle className="w-4 h-4 shrink-0 text-[#E76B64]" />
            <span>{error}</span>
          </div>
        )}

        {step === 'form' ? (
          <form onSubmit={handleProceedToReview} className="space-y-4">
            {/* Endpoint Selection */}
            <div>
              <label htmlFor="schedule-endpoint-select" className="block text-xs font-semibold text-[#202938] mb-1">
                Destination Endpoint <span className="text-[#E76B64]">*</span>
              </label>
              <select
                id="schedule-endpoint-select"
                value={selectedEndpointId}
                onChange={(e) => setSelectedEndpointId(e.target.value)}
                className="w-full text-xs bg-[#F7F6F2] border border-[#E7E8EC] rounded-lg px-3 py-2 text-[#202938] focus:outline-none focus:ring-1 focus:ring-[#5277D9] cursor-pointer"
                required
              >
                <option value="">-- Select Destination Endpoint --</option>
                {endpoints.map((ep) => (
                  <option key={ep.id} value={ep.id}>
                    {ep.url} ({ep.active ? 'Active' : 'Disabled'})
                  </option>
                ))}
              </select>
              {selectedEndpoint && (
                <p className="text-2xs text-[#64748B] mt-1 font-mono">
                  Endpoint ID: {selectedEndpoint.id}
                </p>
              )}
            </div>

            {/* Scheduled Date and Time Picker */}
            <div>
              <label htmlFor="schedule-datetime-input" className="block text-xs font-semibold text-[#202938] mb-1">
                Scheduled Execution Time <span className="text-[#E76B64]">*</span>
              </label>
              <div className="relative">
                <input
                  id="schedule-datetime-input"
                  type="datetime-local"
                  min={getMinDateTime()}
                  value={scheduledAt}
                  onChange={(e) => setScheduledAt(e.target.value)}
                  className="w-full text-xs bg-[#F7F6F2] border border-[#E7E8EC] rounded-lg px-3 py-2 text-[#202938] focus:outline-none focus:ring-1 focus:ring-[#5277D9]"
                  required
                />
              </div>
              <p className="text-2xs text-[#64748B] mt-1 flex items-center gap-1">
                <Clock className="w-3 h-3 text-[#5277D9]" />
                <span>Must be a future date/time. The scheduler will dispatch once this timestamp arrives.</span>
              </p>
            </div>

            {/* Payload or Event ID Selection Mode */}
            <div className="pt-2 border-t border-[#E7E8EC]">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-[#202938]">Webhook Payload Source</span>
                <div className="inline-flex rounded-lg border border-[#E7E8EC] p-0.5 bg-[#F7F6F2]">
                  <button
                    type="button"
                    onClick={() => setPayloadMode('payload')}
                    className={`px-2.5 py-1 text-2xs font-semibold rounded-md transition-all cursor-pointer ${
                      mode === 'payload'
                        ? 'bg-white text-[#5277D9] shadow-2xs'
                        : 'text-[#64748B] hover:text-[#202938]'
                    }`}
                  >
                    Custom JSON Payload
                  </button>
                  <button
                    type="button"
                    onClick={() => setPayloadMode('event')}
                    className={`px-2.5 py-1 text-2xs font-semibold rounded-md transition-all cursor-pointer ${
                      mode === 'event'
                        ? 'bg-white text-[#5277D9] shadow-2xs'
                        : 'text-[#64748B] hover:text-[#202938]'
                    }`}
                  >
                    Existing Event UUID
                  </button>
                </div>
              </div>

              {mode === 'payload' ? (
                <div>
                  <textarea
                    id="schedule-payload-textarea"
                    rows={5}
                    value={payloadText}
                    onChange={(e) => setPayloadText(e.target.value)}
                    placeholder="Enter valid JSON object..."
                    aria-label="Custom JSON payload"
                    className="w-full font-mono text-xs bg-[#F7F6F2] border border-[#E7E8EC] rounded-lg p-3 text-[#202938] focus:outline-none focus:ring-1 focus:ring-[#5277D9]"
                    required
                  />
                  <p className="text-2xs text-[#64748B] mt-1">
                    Valid JSON object dispatched in the POST request body.
                  </p>
                </div>
              ) : (
                <div>
                  <Input
                    id="schedule-event-id-input"
                    placeholder="e.g. 222e6543-e89b-12d3-a456-426614174222"
                    value={eventId}
                    onChange={(e) => setEventId(e.target.value)}
                    className="font-mono text-xs"
                    required
                  />
                  <p className="text-2xs text-[#64748B] mt-1">
                    Reference an already ingested WebhookEvent UUID.
                  </p>
                </div>
              )}
            </div>

            {/* Optional Idempotency Key */}
            <div>
              <label htmlFor="schedule-idempotency-input" className="block text-2xs font-semibold text-[#64748B] mb-1">
                Idempotency Key (Optional)
              </label>
              <Input
                id="schedule-idempotency-input"
                placeholder="Unique key to prevent duplicate schedules..."
                value={idempotencyKey}
                onChange={(e) => setIdempotencyKey(e.target.value)}
                className="text-xs"
              />
            </div>
          </form>
        ) : (
          /* Review Step */
          <div className="space-y-3 text-xs">
            <div className="p-3 bg-[#EAF0FF]/50 border border-[#DCE5FA] rounded-lg space-y-1">
              <span className="font-semibold text-[#5277D9] block text-xs">Ready to Schedule Delivery</span>
              <p className="text-[#64748B]">
                Please verify the scheduled execution details below before confirmation.
              </p>
            </div>

            <div className="p-3 bg-[#F7F6F2] border border-[#E7E8EC] rounded-lg space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[#64748B]">Destination URL:</span>
                <span className="font-mono font-semibold text-[#202938] truncate max-w-xs">
                  {selectedEndpoint?.url || selectedEndpointId}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[#64748B]">Scheduled At:</span>
                <span className="font-semibold text-[#5277D9]">
                  {new Date(scheduledAt).toLocaleString()} ({new Date(scheduledAt).toUTCString()})
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[#64748B]">Payload Source:</span>
                <span className="font-medium text-[#202938]">
                  {mode === 'payload' ? 'Custom JSON' : `Event UUID: ${eventId}`}
                </span>
              </div>
              {idempotencyKey && (
                <div className="flex items-center justify-between">
                  <span className="text-[#64748B]">Idempotency Key:</span>
                  <span className="font-mono text-[#202938]">{idempotencyKey}</span>
                </div>
              )}
            </div>

            {mode === 'payload' && (
              <div>
                <span className="text-2xs font-semibold text-[#64748B] block mb-1">Payload Preview:</span>
                <pre className="p-3 bg-white border border-[#E7E8EC] rounded-lg font-mono text-3xs text-[#202938] overflow-x-auto max-h-36">
                  {payloadText}
                </pre>
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  )
}
