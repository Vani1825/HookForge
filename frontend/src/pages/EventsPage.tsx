import React, { useState, useEffect, useRef, useMemo } from 'react'
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
  AlertCircle,
} from 'lucide-react'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { PageHeader } from '../components/ui/PageHeader'
import { Input } from '../components/ui/Input'
import { TableSkeleton } from '../components/ui/LoadingSkeleton'
import { EmptyState } from '../components/ui/EmptyState'
import { Pagination } from '../components/ui/Pagination'
import { EventDetailDrawer } from '../components/EventDetailDrawer'
import { DeliveryDetailDrawer } from '../components/DeliveryDetailDrawer'
import { SendEventModal } from '../components/SendEventModal'
import { useApp } from '../context/AppContext'
import { formatErrorMessage } from '../api/client'
import {
  formatDateTime,
  formatRelativeTime,
  truncateId,
  copyToClipboard,
} from '../utils/formatters'
import { useDebounce } from '../hooks/useDebounce'
import type { WebhookEvent, Delivery, PaginationMeta } from '../types'

export const EventsPage: React.FC = () => {
  const { service, mode } = useApp()

  // Primary data state
  const [events, setEvents] = useState<WebhookEvent[]>([])
  const [deliveries, setDeliveries] = useState<Delivery[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isFetching, setIsFetching] = useState(false)
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
  const debouncedSearchQuery = useDebounce(searchQuery, 300)

  const [idempotencyKeyFilter, setIdempotencyKeyFilter] = useState('')
  const [createdAfterFilter, setCreatedAfterFilter] = useState('')
  const [createdBeforeFilter, setCreatedBeforeFilter] = useState('')
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false)

  // Manual refresh trigger
  const [refreshKey, setRefreshKey] = useState(0)

  // Drawer & Modal state
  const [selectedEvent, setSelectedEvent] = useState<WebhookEvent | null>(null)
  const [eventDrawerOpen, setEventDrawerOpen] = useState(false)
  const [selectedDelivery, setSelectedDelivery] = useState<Delivery | null>(null)
  const [deliveryDrawerOpen, setDeliveryDrawerOpen] = useState(false)
  const [sendModalOpen, setSendModalOpen] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [copiedKey, setCopiedKey] = useState<string | null>(null)

  // Guard against race conditions and out-of-order network responses
  const latestRequestIdRef = useRef(0)
  const hasLoadedOnceRef = useRef(false)

  // Date range validation check
  const isDateRangeInvalid = useMemo(() => {
    if (!createdAfterFilter || !createdBeforeFilter) return false
    const afterTime = new Date(
      createdAfterFilter.includes('T') ? createdAfterFilter : `${createdAfterFilter}T00:00:00.000Z`
    ).getTime()
    const beforeTime = new Date(
      createdBeforeFilter.includes('T') ? createdBeforeFilter : `${createdBeforeFilter}T23:59:59.999Z`
    ).getTime()
    return afterTime > beforeTime
  }, [createdAfterFilter, createdBeforeFilter])

  // Count active advanced filters
  const activeAdvancedFilterCount = useMemo(() => {
    return [
      Boolean(idempotencyKeyFilter.trim()),
      Boolean(createdAfterFilter),
      Boolean(createdBeforeFilter),
    ].filter(Boolean).length
  }, [idempotencyKeyFilter, createdAfterFilter, createdBeforeFilter])

  // Check if any filters are active
  const hasActiveFilters = useMemo(() => {
    return (
      Boolean(searchQuery.trim()) ||
      Boolean(idempotencyKeyFilter.trim()) ||
      Boolean(createdAfterFilter) ||
      Boolean(createdBeforeFilter)
    )
  }, [searchQuery, idempotencyKeyFilter, createdAfterFilter, createdBeforeFilter])

  // Declarative single data-loading effect: handles pagination, filters, debounce, refresh, and mode
  useEffect(() => {
    if (isDateRangeInvalid) {
      return
    }

    let isCancelled = false
    const reqId = ++latestRequestIdRef.current

    setError(null)
    if (!hasLoadedOnceRef.current) {
      setIsLoading(true)
    } else {
      setIsFetching(true)
    }

    const queryParams: Record<string, string | number> = {
      page,
      pageSize,
    }

    if (idempotencyKeyFilter.trim()) {
      queryParams.idempotency_key = idempotencyKeyFilter.trim()
    }
    if (createdAfterFilter) {
      const afterDate = new Date(
        createdAfterFilter.includes('T')
          ? createdAfterFilter
          : `${createdAfterFilter}T00:00:00.000Z`
      )
      if (!isNaN(afterDate.getTime())) {
        queryParams.created_after = afterDate.toISOString()
      }
    }
    if (createdBeforeFilter) {
      const beforeDate = new Date(
        createdBeforeFilter.includes('T')
          ? createdBeforeFilter
          : `${createdBeforeFilter}T23:59:59.999Z`
      )
      if (!isNaN(beforeDate.getTime())) {
        queryParams.created_before = beforeDate.toISOString()
      }
    }
    if (debouncedSearchQuery.trim()) {
      queryParams.q = debouncedSearchQuery.trim()
    }

    Promise.all([
      service.getEvents(queryParams),
      service.getDeliveries().catch(() => [] as Delivery[]),
    ])
      .then(([evts, dels]) => {
        if (isCancelled || reqId !== latestRequestIdRef.current) return
        setEvents(evts.data || evts)
        setDeliveries(dels)
        if (evts.pagination) {
          setPagination(evts.pagination)
        }
      })
      .catch((err: unknown) => {
        if (isCancelled || reqId !== latestRequestIdRef.current) return
        const msg = formatErrorMessage(err)
        setError(msg)
      })
      .finally(() => {
        if (!isCancelled && reqId === latestRequestIdRef.current) {
          hasLoadedOnceRef.current = true
          setIsLoading(false)
          setIsFetching(false)
        }
      })

    return () => {
      isCancelled = true
    }
  }, [
    page,
    pageSize,
    idempotencyKeyFilter,
    createdAfterFilter,
    createdBeforeFilter,
    debouncedSearchQuery,
    isDateRangeInvalid,
    mode,
    refreshKey,
    service,
  ])

  // Handlers for pagination and filters (pure state updates; effect drives the query)
  const handlePageChange = (newPage: number) => {
    setPage(newPage)
  }

  const handlePageSizeChange = (newPageSize: number) => {
    setPageSize(newPageSize)
    setPage(1)
  }

  const handleSearchChange = (newQuery: string) => {
    setSearchQuery(newQuery)
    setPage(1)
  }

  const handleIdempotencyChange = (newKey: string) => {
    setIdempotencyKeyFilter(newKey)
    setPage(1)
  }

  const handleCreatedAfterChange = (newDate: string) => {
    setCreatedAfterFilter(newDate)
    setPage(1)
  }

  const handleCreatedBeforeChange = (newDate: string) => {
    setCreatedBeforeFilter(newDate)
    setPage(1)
  }

  const handleClearAllFilters = () => {
    setSearchQuery('')
    setIdempotencyKeyFilter('')
    setCreatedAfterFilter('')
    setCreatedBeforeFilter('')
    setPage(1)
  }

  const handleRefresh = () => {
    setRefreshKey((k) => k + 1)
  }

  const handleCopyId = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    const ok = await copyToClipboard(id)
    if (ok) {
      setCopiedId(id)
      setTimeout(() => setCopiedId(null), 1500)
    }
  }

  const handleCopyKey = async (key: string, e: React.MouseEvent) => {
    e.stopPropagation()
    const ok = await copyToClipboard(key)
    if (ok) {
      setCopiedKey(key)
      setTimeout(() => setCopiedKey(null), 1500)
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

  return (
    <div className="space-y-6 text-left">
      {/* Page Header */}
      <PageHeader
        title="Event Explorer"
        description="Ingested payloads, idempotency keys, and atomic fan-out delivery statuses with server-side pagination."
        actions={
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleRefresh}
              isLoading={isFetching}
              leftIcon={<RefreshCw className={`w-3.5 h-3.5 ${isFetching ? 'animate-spin' : ''}`} />}
              aria-label="Refresh events list"
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
          </>
        }
      />

      {/* Filter / Search Bar Card */}
      <Card className="p-3.5 sm:p-4 bg-white space-y-3 shadow-2xs">
        <div className="flex flex-col md:flex-row items-center gap-2.5 sm:gap-3">
          <div className="flex-1 w-full min-w-0">
            <Input
              placeholder="Search by Event ID or Idempotency Key..."
              value={searchQuery}
              onChange={(e) => handleSearchChange(e.target.value)}
              aria-label="Search events"
              leftIcon={<Search className="w-4 h-4 text-[#64748B]" />}
              rightIcon={
                searchQuery ? (
                  <button
                    type="button"
                    onClick={() => handleSearchChange('')}
                    className="text-[#64748B] hover:text-[#202938] cursor-pointer p-0.5"
                    aria-label="Clear search input"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                ) : undefined
              }
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
              Filters{activeAdvancedFilterCount > 0 ? ` (${activeAdvancedFilterCount})` : ''}
            </Button>
          </div>
        </div>

        {/* Collapsible Advanced Filters */}
        {showAdvancedFilters && (
          <div className="pt-3 border-t border-[#E7E8EC] space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label htmlFor="idempotency-key-input" className="block text-2xs font-semibold text-[#64748B] mb-1">
                  Idempotency Key
                </label>
                <Input
                  id="idempotency-key-input"
                  placeholder="Exact idempotency key..."
                  value={idempotencyKeyFilter}
                  onChange={(e) => handleIdempotencyChange(e.target.value)}
                  className="text-xs"
                />
              </div>

              <div>
                <label htmlFor="created-after-event-input" className="block text-2xs font-semibold text-[#64748B] mb-1">
                  Created After
                </label>
                <input
                  id="created-after-event-input"
                  type="date"
                  value={createdAfterFilter}
                  onChange={(e) => handleCreatedAfterChange(e.target.value)}
                  aria-label="Filter events created after date"
                  className="w-full text-xs bg-[#F7F6F2] border border-[#E7E8EC] rounded-lg px-3 py-2 text-[#202938] focus:outline-none focus:ring-1 focus:ring-[#5277D9]"
                />
              </div>

              <div>
                <label htmlFor="created-before-event-input" className="block text-2xs font-semibold text-[#64748B] mb-1">
                  Created Before
                </label>
                <input
                  id="created-before-event-input"
                  type="date"
                  value={createdBeforeFilter}
                  onChange={(e) => handleCreatedBeforeChange(e.target.value)}
                  aria-label="Filter events created before date"
                  className="w-full text-xs bg-[#F7F6F2] border border-[#E7E8EC] rounded-lg px-3 py-2 text-[#202938] focus:outline-none focus:ring-1 focus:ring-[#5277D9]"
                />
              </div>
            </div>

            {/* Inline validation warning for reversed dates */}
            {isDateRangeInvalid && (
              <div className="p-2.5 rounded-lg bg-[#E76B64]/10 border border-[#E76B64]/25 text-xs text-[#E76B64] flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>
                  <strong>Invalid Date Range:</strong> &ldquo;Created After&rdquo; cannot be later
                  than &ldquo;Created Before&rdquo;.
                </span>
              </div>
            )}
          </div>
        )}

        {/* Active Filters Bar */}
        {hasActiveFilters && (
          <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-[#E7E8EC] text-xs">
            <span className="text-2xs font-semibold text-[#64748B] uppercase tracking-wider">
              Active Filters:
            </span>

            {searchQuery && (
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-[#EAF0FF] text-[#5277D9] border border-[#DCE5FA] text-xs font-semibold">
                Search: <strong className="font-semibold truncate max-w-[120px]">{searchQuery}</strong>
                <button
                  type="button"
                  onClick={() => handleSearchChange('')}
                  aria-label="Clear search filter"
                  className="hover:text-[#4366C4] cursor-pointer"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            )}

            {idempotencyKeyFilter && (
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-[#EAF0FF] text-[#5277D9] border border-[#DCE5FA] text-xs font-semibold">
                Key: <strong className="font-semibold truncate max-w-[120px]">{idempotencyKeyFilter}</strong>
                <button
                  type="button"
                  onClick={() => handleIdempotencyChange('')}
                  aria-label="Clear idempotency key filter"
                  className="hover:text-[#4366C4] cursor-pointer"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            )}

            {createdAfterFilter && (
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-[#EAF0FF] text-[#5277D9] border border-[#DCE5FA] text-xs font-semibold">
                After: <strong className="font-semibold">{createdAfterFilter}</strong>
                <button
                  type="button"
                  onClick={() => handleCreatedAfterChange('')}
                  aria-label="Clear created after filter"
                  className="hover:text-[#4366C4] cursor-pointer"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            )}

            {createdBeforeFilter && (
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-[#EAF0FF] text-[#5277D9] border border-[#DCE5FA] text-xs font-semibold">
                Before: <strong className="font-semibold">{createdBeforeFilter}</strong>
                <button
                  type="button"
                  onClick={() => handleCreatedBeforeChange('')}
                  aria-label="Clear created before filter"
                  className="hover:text-[#4366C4] cursor-pointer"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            )}

            <button
              type="button"
              onClick={handleClearAllFilters}
              className="text-xs text-[#E76B64] hover:text-[#D9564F] font-semibold underline ml-auto cursor-pointer"
            >
              Clear all filters
            </button>
          </div>
        )}
      </Card>

      {/* Events Table Card */}
      <Card className="overflow-hidden min-w-0 shadow-2xs">
        {/* Subtle background fetching progress bar */}
        {isFetching && events.length > 0 && (
          <div className="h-0.5 w-full bg-[#5277D9] animate-pulse" />
        )}

        {isLoading ? (
          <TableSkeleton rows={5} cols={6} />
        ) : error ? (
          <div className="p-8 sm:p-12 text-center text-xs space-y-4 max-w-md mx-auto">
            <div className="w-12 h-12 rounded-xl bg-[#E76B64]/10 text-[#E76B64] border border-[#E76B64]/25 flex items-center justify-center mx-auto">
              <AlertCircle className="w-6 h-6" />
            </div>
            <div>
              <h3 className="font-semibold text-sm text-[#202938]">Failed to Load Events</h3>
              <p className="text-[#64748B] text-xs mt-1 leading-relaxed">{error}</p>
            </div>
            <div className="flex items-center justify-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleRefresh}
                leftIcon={<RefreshCw className="w-3.5 h-3.5" />}
              >
                Retry
              </Button>
              {hasActiveFilters && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={handleClearAllFilters}
                >
                  Clear Filters
                </Button>
              )}
            </div>
          </div>
        ) : events.length === 0 ? (
          <EmptyState
            icon={<Inbox className="w-6 h-6 text-[#5277D9]" />}
            title={hasActiveFilters ? 'No Matching Events' : 'No Webhook Events Recorded'}
            description={
              hasActiveFilters
                ? 'No webhook events match your current filter and search criteria.'
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
            <table className="w-full text-left text-xs min-w-[720px]">
              <thead className="bg-[#F7F6F2] border-b border-[#E7E8EC] text-[#64748B] font-semibold">
                <tr>
                  <th className="py-3 px-4">Event ID</th>
                  <th className="py-3 px-4">Event Type</th>
                  <th className="py-3 px-4">Idempotency Key</th>
                  <th className="py-3 px-4">Delivery Outcomes</th>
                  <th className="py-3 px-4">Created Time</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E7E8EC]">
                {events.map((evt) => {
                  const eventDeliveries = deliveries.filter((d) => d.event_id === evt.id)
                  const succeeded = eventDeliveries.filter((d) => d.state === 'SUCCEEDED').length
                  const failed = eventDeliveries.filter((d) => d.state === 'DEAD').length
                  const inProgress = eventDeliveries.filter(
                    (d) =>
                      d.state === 'PENDING' ||
                      d.state === 'IN_FLIGHT' ||
                      d.state === 'RETRYING'
                  ).length

                  return (
                    <tr
                      key={evt.id}
                      onClick={() => handleInspectEvent(evt)}
                      className="hover:bg-[#F7F6F2]/70 transition-colors cursor-pointer group"
                    >
                      {/* Event ID */}
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-1.5 font-mono font-semibold text-[#202938]">
                          <span title={evt.id}>{truncateId(evt.id, 8)}</span>
                          <button
                            type="button"
                            onClick={(e) => handleCopyId(evt.id, e)}
                            className="text-[#64748B] hover:text-[#202938] p-0.5 rounded cursor-pointer transition-colors"
                            title="Copy full Event ID"
                            aria-label={`Copy event ID ${evt.id}`}
                          >
                            {copiedId === evt.id ? (
                              <Check className="w-3 h-3 text-[#159B78]" />
                            ) : (
                              <Copy className="w-3 h-3 opacity-60 group-hover:opacity-100" />
                            )}
                          </button>
                        </div>
                      </td>

                      {/* Event Type */}
                      <td className="py-3 px-4 font-mono font-semibold text-[#202938]">
                        <span className="px-2.5 py-0.5 rounded bg-[#EAF0FF] text-[#5277D9] border border-[#DCE5FA] text-2xs font-semibold">
                          {evt.event_type || 'custom.event'}
                        </span>
                      </td>

                      {/* Idempotency Key */}
                      <td className="py-3 px-4 font-mono text-[#64748B] max-w-xs truncate">
                        <div className="flex items-center gap-1.5">
                          <span title={evt.idempotency_key} className="truncate">
                            {evt.idempotency_key}
                          </span>
                          <button
                            type="button"
                            onClick={(e) => handleCopyKey(evt.idempotency_key, e)}
                            className="text-[#64748B] hover:text-[#202938] p-0.5 rounded cursor-pointer shrink-0 transition-colors"
                            title="Copy idempotency key"
                            aria-label={`Copy idempotency key ${evt.idempotency_key}`}
                          >
                            {copiedKey === evt.idempotency_key ? (
                              <Check className="w-3 h-3 text-[#159B78]" />
                            ) : (
                              <Copy className="w-3 h-3 opacity-60 group-hover:opacity-100" />
                            )}
                          </button>
                        </div>
                      </td>

                      {/* Delivery Outcomes */}
                      <td className="py-3 px-4">
                        <div className="flex flex-wrap items-center gap-1.5 text-2xs">
                          <span className="font-semibold text-[#202938]">
                            {eventDeliveries.length} total
                          </span>
                          {succeeded > 0 && (
                            <span className="px-1.5 py-0.5 rounded bg-[#159B78]/10 text-[#159B78] border border-[#159B78]/25 font-semibold">
                              {succeeded} ok
                            </span>
                          )}
                          {failed > 0 && (
                            <span className="px-1.5 py-0.5 rounded bg-[#E76B64]/10 text-[#E76B64] border border-[#E76B64]/25 font-semibold">
                              {failed} dead
                            </span>
                          )}
                          {inProgress > 0 && (
                            <span className="px-1.5 py-0.5 rounded bg-[#EAF0FF] text-[#5277D9] border border-[#DCE5FA] font-semibold">
                              {inProgress} active
                            </span>
                          )}
                          {eventDeliveries.length === 0 && (
                            <span className="px-1.5 py-0.5 rounded bg-[#F7F6F2] text-[#64748B] border border-[#E7E8EC]">
                              0 endpoints
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Created Time */}
                      <td className="py-3 px-4 text-[#64748B]">
                        <span title={formatDateTime(evt.created_at)}>
                          {formatRelativeTime(evt.created_at)}
                        </span>
                      </td>

                      {/* Actions */}
                      <td className="py-3 px-4 text-right">
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-[#5277D9] group-hover:text-[#4366C4] transition-colors">
                          <span>Payload</span>
                          <ChevronRight className="w-3.5 h-3.5 text-[#5277D9]" />
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
            isLoading={isFetching}
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
        onSuccess={handleRefresh}
      />
    </div>
  )
}
