import React, { useState, useEffect, useCallback } from 'react'
import {
  Inbox,
  Send,
  Search,
  RefreshCw,
  Copy,
  Check,
  ChevronRight,
  Plus,
} from 'lucide-react'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { TableSkeleton } from '../components/ui/LoadingSkeleton'
import { EmptyState } from '../components/ui/EmptyState'
import { EventDetailDrawer } from '../components/EventDetailDrawer'
import { DeliveryDetailDrawer } from '../components/DeliveryDetailDrawer'
import { SendEventModal } from '../components/SendEventModal'
import { useApp } from '../context/AppContext'
import { formatDateTime, truncateId, copyToClipboard } from '../utils/formatters'
import type { WebhookEvent, Delivery } from '../types'

export const EventsPage: React.FC = () => {
  const { service, mode } = useApp()

  const [events, setEvents] = useState<WebhookEvent[]>([])
  const [deliveries, setDeliveries] = useState<Delivery[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState<string>('ALL')

  const [selectedEvent, setSelectedEvent] = useState<WebhookEvent | null>(null)
  const [eventDrawerOpen, setEventDrawerOpen] = useState(false)

  const [selectedDelivery, setSelectedDelivery] = useState<Delivery | null>(null)
  const [deliveryDrawerOpen, setDeliveryDrawerOpen] = useState(false)

  const [sendModalOpen, setSendModalOpen] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const loadData = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const [evts, dels] = await Promise.all([service.getEvents(), service.getDeliveries()])
      setEvents(evts)
      setDeliveries(dels)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to fetch events'
      setError(msg)
    } finally {
      setIsLoading(false)
    }
  }, [service])

  useEffect(() => {
    loadData()
  }, [loadData, mode])

  const handleCopy = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    const ok = await copyToClipboard(id)
    if (ok) {
      setCopiedId(id)
      setTimeout(() => setCopiedId(null), 1500)
    }
  }

  const handleInspectEvent = (evt: WebhookEvent) => {
    setSelectedEvent(evt)
    setEventDrawerOpen(true)
  }

  const handleInspectDelivery = (del: Delivery) => {
    setSelectedDelivery(del)
    setDeliveryDrawerOpen(true)
  }

  // Extract distinct event types for filtering
  const distinctTypes = Array.from(new Set(events.map((e) => e.event_type || 'custom.event'))).filter(Boolean)

  const filteredEvents = events.filter((evt) => {
    if (typeFilter !== 'ALL' && evt.event_type !== typeFilter) return false
    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      const matchesId = evt.id.toLowerCase().includes(q)
      const matchesKey = evt.idempotency_key.toLowerCase().includes(q)
      const matchesType = evt.event_type?.toLowerCase().includes(q)
      return matchesId || matchesKey || matchesType
    }
    return true
  })

  return (
    <div className="space-y-6 text-left">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight">Event Explorer</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Ingested payloads, idempotency keys, and atomic fan-out delivery statuses.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={loadData}
            isLoading={isLoading}
            leftIcon={<RefreshCw className="w-3.5 h-3.5" />}
          >
            Refresh
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => setSendModalOpen(true)}
            leftIcon={<Send className="w-3.5 h-3.5" />}
          >
            Send Test Event
          </Button>
        </div>
      </div>

      {/* Filter / Search Bar */}
      <Card className="p-4 bg-white">
        <div className="flex flex-col sm:flex-row items-center gap-3">
          <div className="flex-1 w-full">
            <Input
              placeholder="Search by Event ID, Idempotency Key, or Type..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              leftIcon={<Search className="w-4 h-4 text-slate-400" />}
            />
          </div>

          <div className="w-full sm:w-auto">
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="text-xs bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-slate-700 focus:outline-none focus:ring-1 focus:ring-slate-900"
            >
              <option value="ALL">All Event Types</option>
              {distinctTypes.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
        </div>
      </Card>

      {/* Events Table */}
      <Card className="overflow-hidden">
        {isLoading ? (
          <TableSkeleton rows={5} cols={5} />
        ) : error && mode === 'live' ? (
          <div className="p-8 text-center text-xs text-rose-600 space-y-2">
            <p className="font-semibold">Failed to load events from backend API.</p>
            <p className="text-slate-500 font-mono">{error}</p>
          </div>
        ) : filteredEvents.length === 0 ? (
          <EmptyState
            icon={<Inbox className="w-6 h-6 text-slate-400" />}
            title="No Events Found"
            description={
              searchQuery
                ? 'No webhook events match your search query.'
                : 'Send your first webhook event through the ingestion pipeline.'
            }
            action={
              <Button
                variant="primary"
                size="sm"
                onClick={() => setSendModalOpen(true)}
                leftIcon={<Plus className="w-3.5 h-3.5" />}
              >
                Send Event
              </Button>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50/70 border-b border-slate-200 text-slate-500 font-medium">
                <tr>
                  <th className="py-3 px-4">Event ID</th>
                  <th className="py-3 px-4">Event Type</th>
                  <th className="py-3 px-4">Idempotency Key</th>
                  <th className="py-3 px-4">Deliveries</th>
                  <th className="py-3 px-4">Created Time</th>
                  <th className="py-3 px-4 text-right">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredEvents.map((evt) => {
                  const eventDeliveries = deliveries.filter((d) => d.event_id === evt.id)
                  const succeeded = eventDeliveries.filter((d) => d.state === 'SUCCEEDED').length
                  const failed = eventDeliveries.filter((d) => d.state === 'DEAD').length
                  const inProgress = eventDeliveries.filter(
                    (d) => d.state === 'PENDING' || d.state === 'IN_FLIGHT' || d.state === 'RETRYING'
                  ).length

                  return (
                    <tr
                      key={evt.id}
                      onClick={() => handleInspectEvent(evt)}
                      className="hover:bg-slate-50/80 transition-colors cursor-pointer"
                    >
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-1.5 font-mono font-medium text-slate-800">
                          <span>{truncateId(evt.id, 8)}</span>
                          <button
                            onClick={(e) => handleCopy(evt.id, e)}
                            className="text-slate-400 hover:text-slate-600 p-0.5 rounded cursor-pointer"
                            title="Copy Event ID"
                          >
                            {copiedId === evt.id ? (
                              <Check className="w-3 h-3 text-emerald-600" />
                            ) : (
                              <Copy className="w-3 h-3" />
                            )}
                          </button>
                        </div>
                      </td>

                      <td className="py-3 px-4 font-mono font-semibold text-slate-800">
                        <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-800 text-2xs">
                          {evt.event_type || 'custom.event'}
                        </span>
                      </td>

                      <td className="py-3 px-4 font-mono text-slate-600 max-w-xs truncate">
                        {evt.idempotency_key}
                      </td>

                      <td className="py-3 px-4">
                        <div className="flex items-center gap-1.5 text-2xs">
                          <span className="font-semibold text-slate-800">
                            {eventDeliveries.length} endpoints
                          </span>
                          {succeeded > 0 && (
                            <span className="px-1.5 py-0.2 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">
                              {succeeded} ok
                            </span>
                          )}
                          {failed > 0 && (
                            <span className="px-1.5 py-0.2 rounded bg-rose-50 text-rose-700 border border-rose-200">
                              {failed} dead
                            </span>
                          )}
                          {inProgress > 0 && (
                            <span className="px-1.5 py-0.2 rounded bg-indigo-50 text-indigo-700 border border-indigo-200">
                              {inProgress} active
                            </span>
                          )}
                        </div>
                      </td>

                      <td className="py-3 px-4 text-slate-500">
                        {formatDateTime(evt.created_at)}
                      </td>

                      <td className="py-3 px-4 text-right">
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-slate-700 hover:text-slate-900">
                          <span>Payload</span>
                          <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Event Inspection Drawer */}
      <EventDetailDrawer
        event={selectedEvent}
        deliveries={deliveries}
        isOpen={eventDrawerOpen}
        onClose={() => setEventDrawerOpen(false)}
        onInspectDelivery={handleInspectDelivery}
      />

      {/* Nested Delivery Detail Drawer */}
      <DeliveryDetailDrawer
        delivery={selectedDelivery}
        isOpen={deliveryDrawerOpen}
        onClose={() => setDeliveryDrawerOpen(false)}
      />

      {/* Send Test Event Modal */}
      <SendEventModal
        isOpen={sendModalOpen}
        onClose={() => setSendModalOpen(false)}
        onSuccess={loadData}
      />
    </div>
  )
}
