import React, { useState, useEffect, useCallback, useRef } from 'react'
import {
  Inbox,
  Send,
  Search,
  RefreshCw,
  Copy,
  Check,
  ChevronRight,
  Plus,
  SlidersHorizontal,
  X,
} from 'lucide-react'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { TableSkeleton } from '../components/ui/LoadingSkeleton'
import { EmptyState } from '../components/ui/EmptyState'
import { Pagination } from '../components/ui/Pagination'
import { EventDetailDrawer } from '../components/EventDetailDrawer'
import { DeliveryDetailDrawer } from '../components/DeliveryDetailDrawer'
import { SendEventModal } from '../components/SendEventModal'
import { useApp } from '../context/AppContext'
import { formatDateTime, truncateId, copyToClipboard } from '../utils/formatters'
import type { WebhookEvent, Delivery, PaginationMeta } from '../types'

export const EventsPage: React.FC = () => {
  const { service, mode } = useApp()

  const [events, setEvents] = useState<WebhookEvent[]>([])
  const [deliveries, setDeliveries] = useState<Delivery[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Pagination state
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [pagination, setPagination] = useState<PaginationMeta>({
    page: 1,
    pageSize: 20,
    totalRecords: 0,
    totalPages: 0,
    hasNext: false,
    hasPrev: false,
  })

  // Filter states
  const [searchQuery, setSearchQuery] = useState('')
  const [idempotencyKeyFilter, setIdempotencyKeyFilter] = useState('')
  const [createdAfterFilter, setCreatedAfterFilter] = useState('')
  const [createdBeforeFilter, setCreatedBeforeFilter] = useState('')
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false)

  // Drawer & Modal state
  const [selectedEvent, setSelectedEvent] = useState<WebhookEvent | null>(null)
  const [eventDrawerOpen, setEventDrawerOpen] = useState(false)
  const [selectedDelivery, setSelectedDelivery] = useState<Delivery | null>(null)
  const [deliveryDrawerOpen, setDeliveryDrawerOpen] = useState(false)
  const [sendModalOpen, setSendModalOpen] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  // Guard against race conditions and out-of-order network responses
  const latestRequestIdRef = useRef(0)

  const loadData = useCallback(
    async (
      targetPage = page,
      targetPageSize = pageSize,
      currentFilters = {
        idempotency_key: idempotencyKeyFilter,
        created_after: createdAfterFilter,
        created_before: createdBeforeFilter,
        q: searchQuery,
      }
    ) => {
      const reqId = ++latestRequestIdRef.current
      setIsLoading(true)
      setError(null)

      try {
        const queryParams: Record<string, string | number> = {
          page: targetPage,
          pageSize: targetPageSize,
        }

        if (currentFilters.idempotency_key?.trim()) {
          queryParams.idempotency_key = currentFilters.idempotency_key.trim()
        }
        if (currentFilters.created_after) {
          const afterDate = new Date(
            currentFilters.created_after.includes('T')
              ? currentFilters.created_after
              : `${currentFilters.created_after}T00:00:00.000Z`
          )
          if (!isNaN(afterDate.getTime())) {
            queryParams.created_after = afterDate.toISOString()
          }
        }
        if (currentFilters.created_before) {
          const beforeDate = new Date(
            currentFilters.created_before.includes('T')
              ? currentFilters.created_before
              : `${currentFilters.created_before}T23:59:59.999Z`
          )
          if (!isNaN(beforeDate.getTime())) {
            queryParams.created_before = beforeDate.toISOString()
          }
        }
        if (currentFilters.q?.trim()) {
          queryParams.q = currentFilters.q.trim()
        }

        const [evts, dels] = await Promise.all([
          service.getEvents(queryParams),
          service.getDeliveries().catch(() => [] as Delivery[]),
        ])

        // Ignore stale responses
        if (reqId !== latestRequestIdRef.current) return

        setEvents(evts.data || evts)
        setDeliveries(dels)
        if (evts.pagination) {
          setPagination(evts.pagination)
        }
      } catch (err: unknown) {
        if (reqId !== latestRequestIdRef.current) return
        const msg = err instanceof Error ? err.message : 'Failed to fetch events'
        setError(msg)
      } finally {
        if (reqId === latestRequestIdRef.current) {
          setIsLoading(false)
        }
      }
    },
    [service, page, pageSize, idempotencyKeyFilter, createdAfterFilter, createdBeforeFilter, searchQuery]
  )

  useEffect(() => {
    loadData(page, pageSize)
  }, [loadData, mode, page, pageSize])

  // Pagination handlers
  const handlePageChange = (newPage: number) => {
    setPage(newPage)
    loadData(newPage, pageSize)
  }

  const handlePageSizeChange = (newPageSize: number) => {
    setPageSize(newPageSize)
    setPage(1)
    loadData(1, newPageSize)
  }

  // Filter updates reset page to 1
  const applyFilterUpdate = (
    updates: Partial<{
      idempotency_key: string
      created_after: string
      created_before: string
      q: string
    }>
  ) => {
    const updated = {
      idempotency_key: updates.idempotency_key !== undefined ? updates.idempotency_key : idempotencyKeyFilter,
      created_after: updates.created_after !== undefined ? updates.created_after : createdAfterFilter,
      created_before: updates.created_before !== undefined ? updates.created_before : createdBeforeFilter,
      q: updates.q !== undefined ? updates.q : searchQuery,
    }

    if (updates.idempotency_key !== undefined) setIdempotencyKeyFilter(updates.idempotency_key)
    if (updates.created_after !== undefined) setCreatedAfterFilter(updates.created_after)
    if (updates.created_before !== undefined) setCreatedBeforeFilter(updates.created_before)
    if (updates.q !== undefined) setSearchQuery(updates.q)

    setPage(1)
    loadData(1, pageSize, updated)
  }

  const handleClearAllFilters = () => {
    setSearchQuery('')
    setIdempotencyKeyFilter('')
    setCreatedAfterFilter('')
    setCreatedBeforeFilter('')
    setPage(1)
    loadData(1, pageSize, {
      idempotency_key: '',
      created_after: '',
      created_before: '',
      q: '',
    })
  }

  const hasActiveFilters =
    Boolean(searchQuery.trim()) ||
    Boolean(idempotencyKeyFilter.trim()) ||
    Boolean(createdAfterFilter) ||
    Boolean(createdBeforeFilter)

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

  const displayedEvents = events

  return (
    <div className="space-y-6 text-left">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight">Event Explorer</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Ingested payloads, idempotency keys, and atomic fan-out delivery statuses with server-side pagination.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => loadData(page, pageSize)}
            isLoading={isLoading}
            leftIcon={<RefreshCw className="w-3.5 h-3.5" />}
          >
            Refresh
          </Button>
          <Button
            type="button"
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
      <Card className="p-4 bg-white space-y-3">
        <div className="flex flex-col md:flex-row items-center gap-3">
          <div className="flex-1 w-full">
            <Input
              placeholder="Search by Event ID or Idempotency Key..."
              value={searchQuery}
              onChange={(e) => applyFilterUpdate({ q: e.target.value })}
              aria-label="Search events"
              leftIcon={<Search className="w-4 h-4 text-slate-400" />}
            />
          </div>

          <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
            {/* Advanced Filters Button */}
            <Button
              type="button"
              variant={showAdvancedFilters ? 'secondary' : 'outline'}
              size="sm"
              onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
              aria-expanded={showAdvancedFilters}
              leftIcon={<SlidersHorizontal className="w-3.5 h-3.5" />}
              className="text-xs"
            >
              Filters
            </Button>
          </div>
        </div>

        {/* Collapsible Advanced Filters */}
        {showAdvancedFilters && (
          <div className="pt-3 border-t border-slate-100 grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label htmlFor="idempotency-key-input" className="block text-2xs font-medium text-slate-600 mb-1">
                Idempotency Key
              </label>
              <Input
                id="idempotency-key-input"
                placeholder="Exact idempotency key..."
                value={idempotencyKeyFilter}
                onChange={(e) => applyFilterUpdate({ idempotency_key: e.target.value })}
                className="text-xs"
              />
            </div>

            <div>
              <label htmlFor="created-after-event-input" className="block text-2xs font-medium text-slate-600 mb-1">
                Created After
              </label>
              <input
                id="created-after-event-input"
                type="date"
                value={createdAfterFilter}
                onChange={(e) => applyFilterUpdate({ created_after: e.target.value })}
                aria-label="Filter events created after date"
                className="w-full text-xs bg-white border border-slate-300 rounded-lg px-3 py-2 text-slate-700 focus:outline-none focus:ring-1 focus:ring-slate-900"
              />
            </div>

            <div>
              <label htmlFor="created-before-event-input" className="block text-2xs font-medium text-slate-600 mb-1">
                Created Before
              </label>
              <input
                id="created-before-event-input"
                type="date"
                value={createdBeforeFilter}
                onChange={(e) => applyFilterUpdate({ created_before: e.target.value })}
                aria-label="Filter events created before date"
                className="w-full text-xs bg-white border border-slate-300 rounded-lg px-3 py-2 text-slate-700 focus:outline-none focus:ring-1 focus:ring-slate-900"
              />
            </div>
          </div>
        )}

        {/* Active Filters Bar */}
        {hasActiveFilters && (
          <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100 text-xs">
            <span className="text-2xs font-semibold text-slate-400 uppercase tracking-wider">
              Active Filters:
            </span>

            {searchQuery && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 text-xs">
                Search: <strong className="font-semibold truncate max-w-[120px]">{searchQuery}</strong>
                <button
                  type="button"
                  onClick={() => applyFilterUpdate({ q: '' })}
                  aria-label="Clear search filter"
                  className="hover:text-slate-900 cursor-pointer"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            )}

            {idempotencyKeyFilter && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 text-xs">
                Key: <strong className="font-semibold truncate max-w-[120px]">{idempotencyKeyFilter}</strong>
                <button
                  type="button"
                  onClick={() => applyFilterUpdate({ idempotency_key: '' })}
                  aria-label="Clear idempotency key filter"
                  className="hover:text-slate-900 cursor-pointer"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            )}

            {createdAfterFilter && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 text-xs">
                After: <strong className="font-semibold">{createdAfterFilter}</strong>
                <button
                  type="button"
                  onClick={() => applyFilterUpdate({ created_after: '' })}
                  aria-label="Clear created after filter"
                  className="hover:text-slate-900 cursor-pointer"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            )}

            {createdBeforeFilter && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 text-xs">
                Before: <strong className="font-semibold">{createdBeforeFilter}</strong>
                <button
                  type="button"
                  onClick={() => applyFilterUpdate({ created_before: '' })}
                  aria-label="Clear created before filter"
                  className="hover:text-slate-900 cursor-pointer"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            )}

            <button
              type="button"
              onClick={handleClearAllFilters}
              className="text-xs text-rose-600 hover:text-rose-700 font-medium underline ml-auto cursor-pointer"
            >
              Clear all filters
            </button>
          </div>
        )}
      </Card>

      {/* Events Table */}
      <Card className="overflow-hidden">
        {isLoading ? (
          <TableSkeleton rows={5} cols={5} />
        ) : error && mode === 'live' ? (
          <div className="p-8 text-center text-xs text-rose-600 space-y-3">
            <p className="font-semibold text-sm">Failed to load events from backend API.</p>
            <p className="text-slate-500 font-mono">{error}</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => loadData(page, pageSize)}
              className="mx-auto"
            >
              Retry
            </Button>
          </div>
        ) : displayedEvents.length === 0 ? (
          <EmptyState
            icon={<Inbox className="w-6 h-6 text-slate-400" />}
            title="No Events Found"
            description={
              hasActiveFilters
                ? 'No webhook events match your search criteria.'
                : 'Send your first webhook event through the ingestion pipeline.'
            }
            action={
              hasActiveFilters ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleClearAllFilters}
                >
                  Clear Filters
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  onClick={() => setSendModalOpen(true)}
                  leftIcon={<Plus className="w-3.5 h-3.5" />}
                >
                  Send Event
                </Button>
              )
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
                {displayedEvents.map((evt) => {
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
                            type="button"
                            onClick={(e) => handleCopy(evt.id, e)}
                            className="text-slate-400 hover:text-slate-600 p-0.5 rounded cursor-pointer"
                            title="Copy Event ID"
                            aria-label={`Copy event ID ${evt.id}`}
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
                            <span className="px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">
                              {succeeded} ok
                            </span>
                          )}
                          {failed > 0 && (
                            <span className="px-1.5 py-0.5 rounded bg-rose-50 text-rose-700 border border-rose-200">
                              {failed} dead
                            </span>
                          )}
                          {inProgress > 0 && (
                            <span className="px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-200">
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

        {/* Server-side Pagination Component */}
        {!isLoading && !error && (
          <Pagination
            pagination={pagination}
            onPageChange={handlePageChange}
            onPageSizeChange={handlePageSizeChange}
            itemName="events"
            isLoading={isLoading}
          />
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
        onSuccess={() => loadData(page, pageSize)}
      />
    </div>
  )
}
