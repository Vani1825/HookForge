import React, { useState, useEffect, useCallback, useRef } from 'react'
import {
  Send,
  Search,
  RefreshCw,
  Copy,
  Check,
  ChevronRight,
  Filter,
  SlidersHorizontal,
  X,
} from 'lucide-react'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { PageHeader } from '../components/ui/PageHeader'
import { Input } from '../components/ui/Input'
import { StatusBadge } from '../components/StatusBadge'
import { TableSkeleton } from '../components/ui/LoadingSkeleton'
import { EmptyState } from '../components/ui/EmptyState'
import { Pagination } from '../components/ui/Pagination'
import { DeliveryDetailDrawer } from '../components/DeliveryDetailDrawer'
import { ReplayModal } from '../components/ReplayModal'
import { useApp } from '../context/AppContext'
import { formatErrorMessage } from '../api/client'
import { formatRelativeTime, truncateId, formatStatusCode, copyToClipboard } from '../utils/formatters'
import type { Delivery, Endpoint, PaginationMeta } from '../types'

export const DeliveriesPage: React.FC = () => {
  const { service, mode } = useApp()

  const [deliveries, setDeliveries] = useState<Delivery[]>([])
  const [endpoints, setEndpoints] = useState<Endpoint[]>([])
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
  const [stateFilter, setStateFilter] = useState<string>('ALL')
  const [endpointFilter, setEndpointFilter] = useState<string>('')
  const [eventFilter, setEventFilter] = useState<string>('')
  const [createdAfterFilter, setCreatedAfterFilter] = useState<string>('')
  const [createdBeforeFilter, setCreatedBeforeFilter] = useState<string>('')
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false)

  // Drawers & Modals
  const [selectedDelivery, setSelectedDelivery] = useState<Delivery | null>(null)
  const [detailDrawerOpen, setDetailDrawerOpen] = useState(false)
  const [replayModalOpen, setReplayModalOpen] = useState(false)
  const [deliveryToReplay, setDeliveryToReplay] = useState<Delivery | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  // Guard against race conditions and out-of-order network responses
  const latestRequestIdRef = useRef(0)

  // Load configured endpoints for the dropdown filter
  useEffect(() => {
    service.getEndpoints().then(setEndpoints).catch(() => setEndpoints([]))
  }, [service, mode])

  const loadDeliveries = useCallback(
    async (
      targetPage = page,
      targetPageSize = pageSize,
      currentFilters = {
        state: stateFilter,
        endpoint_id: endpointFilter,
        event_id: eventFilter,
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
          state: currentFilters.state || 'ALL',
        }

        if (currentFilters.endpoint_id?.trim()) {
          queryParams.endpoint_id = currentFilters.endpoint_id.trim()
        }
        if (currentFilters.event_id?.trim()) {
          queryParams.event_id = currentFilters.event_id.trim()
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

        const res = await service.getDeliveries(queryParams)

        // Ignore stale responses
        if (reqId !== latestRequestIdRef.current) return

        setDeliveries(res.data || res)
        if (res.pagination) {
          setPagination(res.pagination)
        }
      } catch (err: unknown) {
        if (reqId !== latestRequestIdRef.current) return
        const msg = formatErrorMessage(err)
        setError(msg)
      } finally {
        if (reqId === latestRequestIdRef.current) {
          setIsLoading(false)
        }
      }
    },
    [
      service,
      page,
      pageSize,
      stateFilter,
      endpointFilter,
      eventFilter,
      createdAfterFilter,
      createdBeforeFilter,
      searchQuery,
    ]
  )

  // Initial fetch and reload on mode change
  useEffect(() => {
    loadDeliveries(page, pageSize)
  }, [loadDeliveries, mode, page, pageSize])

  // Handlers for pagination
  const handlePageChange = (newPage: number) => {
    setPage(newPage)
    loadDeliveries(newPage, pageSize)
  }

  const handlePageSizeChange = (newPageSize: number) => {
    setPageSize(newPageSize)
    setPage(1)
    loadDeliveries(1, newPageSize)
  }

  // Helper to apply filter change (always resets to page 1)
  const applyFilterUpdate = (
    updates: Partial<{
      state: string
      endpoint_id: string
      event_id: string
      created_after: string
      created_before: string
      q: string
    }>
  ) => {
    const updated = {
      state: updates.state !== undefined ? updates.state : stateFilter,
      endpoint_id: updates.endpoint_id !== undefined ? updates.endpoint_id : endpointFilter,
      event_id: updates.event_id !== undefined ? updates.event_id : eventFilter,
      created_after: updates.created_after !== undefined ? updates.created_after : createdAfterFilter,
      created_before: updates.created_before !== undefined ? updates.created_before : createdBeforeFilter,
      q: updates.q !== undefined ? updates.q : searchQuery,
    }

    if (updates.state !== undefined) setStateFilter(updates.state)
    if (updates.endpoint_id !== undefined) setEndpointFilter(updates.endpoint_id)
    if (updates.event_id !== undefined) setEventFilter(updates.event_id)
    if (updates.created_after !== undefined) setCreatedAfterFilter(updates.created_after)
    if (updates.created_before !== undefined) setCreatedBeforeFilter(updates.created_before)
    if (updates.q !== undefined) setSearchQuery(updates.q)

    setPage(1)
    loadDeliveries(1, pageSize, updated)
  }

  const handleClearAllFilters = () => {
    setStateFilter('ALL')
    setEndpointFilter('')
    setEventFilter('')
    setCreatedAfterFilter('')
    setCreatedBeforeFilter('')
    setSearchQuery('')
    setPage(1)
    loadDeliveries(1, pageSize, {
      state: 'ALL',
      endpoint_id: '',
      event_id: '',
      created_after: '',
      created_before: '',
      q: '',
    })
  }

  const hasActiveFilters =
    stateFilter !== 'ALL' ||
    Boolean(endpointFilter) ||
    Boolean(eventFilter) ||
    Boolean(createdAfterFilter) ||
    Boolean(createdBeforeFilter) ||
    Boolean(searchQuery.trim())

  const handleCopy = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    const ok = await copyToClipboard(id)
    if (ok) {
      setCopiedId(id)
      setTimeout(() => setCopiedId(null), 1500)
    }
  }

  const handleInspect = async (del: Delivery) => {
    try {
      const detailed = await service.getDeliveryById(del.id)
      setSelectedDelivery(detailed || del)
    } catch {
      setSelectedDelivery(del)
    }
    setDetailDrawerOpen(true)
  }

  const handleReplayClick = (del: Delivery) => {
    setDeliveryToReplay(del)
    setReplayModalOpen(true)
  }

  return (
    <div className="space-y-6 text-left">
      {/* Page Header */}
      <PageHeader
        title="Delivery Pipeline Monitor"
        description="Durable PostgreSQL work queue with server-side pagination, per-endpoint ordering, and lease expiration."
        actions={
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => loadDeliveries(page, pageSize)}
            isLoading={isLoading}
            leftIcon={<RefreshCw className="w-3.5 h-3.5" />}
          >
            Refresh
          </Button>
        }
      />

      {/* Filter / Search Card */}
      <Card className="p-4 bg-white space-y-3">
        {/* Primary Row: Search, State, Endpoint, Advanced Toggle */}
        <div className="flex flex-col md:flex-row items-center gap-3">
          <div className="flex-1 w-full">
            <Input
              placeholder="Search by Delivery ID, Event ID, Endpoint URL, or Error..."
              value={searchQuery}
              onChange={(e) => applyFilterUpdate({ q: e.target.value })}
              aria-label="Search deliveries"
              leftIcon={<Search className="w-4 h-4 text-[#64748B]" />}
            />
          </div>

          <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
            {/* State filter */}
            <div className="flex items-center gap-1.5 text-xs text-[#64748B] font-semibold">
              <Filter className="w-3.5 h-3.5" />
              <span>State:</span>
              <select
                value={stateFilter}
                onChange={(e) => applyFilterUpdate({ state: e.target.value })}
                aria-label="Filter deliveries by state"
                className="text-xs bg-[#F7F6F2] border border-[#E7E8EC] rounded-lg px-2.5 py-2 text-[#202938] focus:outline-none focus:ring-1 focus:ring-[#5277D9] cursor-pointer"
              >
                <option value="ALL">All States</option>
                <option value="SUCCEEDED">Succeeded</option>
                <option value="PENDING">Pending</option>
                <option value="IN_FLIGHT">In Flight</option>
                <option value="RETRYING">Retrying</option>
                <option value="DEAD">Dead Letter</option>
              </select>
            </div>

            {/* Endpoint filter dropdown */}
            <div className="flex items-center gap-1.5 text-xs text-[#64748B] font-semibold">
              <span>Endpoint:</span>
              <select
                value={endpointFilter}
                onChange={(e) => applyFilterUpdate({ endpoint_id: e.target.value })}
                aria-label="Filter deliveries by destination endpoint"
                className="text-xs bg-[#F7F6F2] border border-[#E7E8EC] rounded-lg px-2.5 py-2 text-[#202938] focus:outline-none focus:ring-1 focus:ring-[#5277D9] max-w-[180px] truncate cursor-pointer"
              >
                <option value="">All Endpoints</option>
                {endpoints.map((ep) => (
                  <option key={ep.id} value={ep.id}>
                    {ep.url || ep.id}
                  </option>
                ))}
              </select>
            </div>

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

        {/* Collapsible Advanced Filters (Event ID, Date Range) */}
        {showAdvancedFilters && (
          <div className="pt-3 border-t border-[#E7E8EC] grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label htmlFor="event-filter-input" className="block text-2xs font-semibold text-[#64748B] mb-1">
                Event UUID
              </label>
              <Input
                id="event-filter-input"
                placeholder="Filter by Event UUID..."
                value={eventFilter}
                onChange={(e) => applyFilterUpdate({ event_id: e.target.value })}
                className="text-xs"
              />
            </div>

            <div>
              <label htmlFor="created-after-input" className="block text-2xs font-semibold text-[#64748B] mb-1">
                Created After
              </label>
              <input
                id="created-after-input"
                type="date"
                value={createdAfterFilter}
                onChange={(e) => applyFilterUpdate({ created_after: e.target.value })}
                aria-label="Filter deliveries created after date"
                className="w-full text-xs bg-[#F7F6F2] border border-[#E7E8EC] rounded-lg px-3 py-2 text-[#202938] focus:outline-none focus:ring-1 focus:ring-[#5277D9]"
              />
            </div>

            <div>
              <label htmlFor="created-before-input" className="block text-2xs font-semibold text-[#64748B] mb-1">
                Created Before
              </label>
              <input
                id="created-before-input"
                type="date"
                value={createdBeforeFilter}
                onChange={(e) => applyFilterUpdate({ created_before: e.target.value })}
                aria-label="Filter deliveries created before date"
                className="w-full text-xs bg-[#F7F6F2] border border-[#E7E8EC] rounded-lg px-3 py-2 text-[#202938] focus:outline-none focus:ring-1 focus:ring-[#5277D9]"
              />
            </div>
          </div>
        )}

        {/* Active Filters Bar */}
        {hasActiveFilters && (
          <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-[#E7E8EC] text-xs">
            <span className="text-2xs font-semibold text-[#64748B] uppercase tracking-wider">
              Active Filters:
            </span>

            {stateFilter !== 'ALL' && (
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-[#EAF0FF] text-[#5277D9] border border-[#DCE5FA] text-xs font-semibold">
                State: <strong className="font-semibold">{stateFilter}</strong>
                <button
                  type="button"
                  onClick={() => applyFilterUpdate({ state: 'ALL' })}
                  aria-label="Clear state filter"
                  className="hover:text-[#4366C4] cursor-pointer"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            )}

            {searchQuery && (
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-[#EAF0FF] text-[#5277D9] border border-[#DCE5FA] text-xs font-semibold">
                Search: <strong className="font-semibold truncate max-w-[120px]">{searchQuery}</strong>
                <button
                  type="button"
                  onClick={() => applyFilterUpdate({ q: '' })}
                  aria-label="Clear search query"
                  className="hover:text-[#4366C4] cursor-pointer"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            )}

            {endpointFilter && (
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-[#EAF0FF] text-[#5277D9] border border-[#DCE5FA] text-xs font-semibold">
                Endpoint: <strong className="font-semibold truncate max-w-[120px]">{endpointFilter}</strong>
                <button
                  type="button"
                  onClick={() => applyFilterUpdate({ endpoint_id: '' })}
                  aria-label="Clear endpoint filter"
                  className="hover:text-[#4366C4] cursor-pointer"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            )}

            {eventFilter && (
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-[#EAF0FF] text-[#5277D9] border border-[#DCE5FA] text-xs font-semibold">
                Event: <strong className="font-semibold truncate max-w-[120px]">{eventFilter}</strong>
                <button
                  type="button"
                  onClick={() => applyFilterUpdate({ event_id: '' })}
                  aria-label="Clear event filter"
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
                  onClick={() => applyFilterUpdate({ created_after: '' })}
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
                  onClick={() => applyFilterUpdate({ created_before: '' })}
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

      {/* Main Deliveries Table */}
      <Card className="overflow-hidden">
        {isLoading ? (
          <TableSkeleton rows={6} cols={7} />
        ) : error && mode === 'live' ? (
          <div className="p-8 text-center text-xs text-[#E76B64] space-y-3">
            <p className="font-semibold text-sm">Failed to load deliveries from backend API.</p>
            <p className="text-[#64748B] font-mono">{error}</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => loadDeliveries(page, pageSize)}
              className="mx-auto"
            >
              Retry
            </Button>
          </div>
        ) : deliveries.length === 0 ? (
          <EmptyState
            icon={<Send className="w-6 h-6 text-[#5277D9]" />}
            title="No Deliveries Found"
            description={
              hasActiveFilters
                ? 'No deliveries matched your filter criteria.'
                : 'No delivery tasks currently enqueued in the platform.'
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
              ) : undefined
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#F7F6F2] border-b border-[#E7E8EC] text-[#64748B] font-semibold">
                <tr>
                  <th className="py-3 px-4">Delivery ID</th>
                  <th className="py-3 px-4">Destination Endpoint</th>
                  <th className="py-3 px-4">State</th>
                  <th className="py-3 px-4">HTTP</th>
                  <th className="py-3 px-4">Seq</th>
                  <th className="py-3 px-4">Attempts</th>
                  <th className="py-3 px-4">Next Retry / Time</th>
                  <th className="py-3 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E7E8EC]">
                {deliveries.map((del) => {
                  const statusInfo = formatStatusCode(del.last_status_code)
                  return (
                    <tr
                      key={del.id}
                      onClick={() => handleInspect(del)}
                      className="hover:bg-[#F7F6F2]/70 transition-colors cursor-pointer"
                    >
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-1.5 font-mono font-semibold text-[#202938]">
                          <span>{truncateId(del.id, 8)}</span>
                          <button
                            type="button"
                            onClick={(e) => handleCopy(del.id, e)}
                            className="text-[#64748B] hover:text-[#202938] p-0.5 rounded cursor-pointer"
                            title="Copy Delivery ID"
                            aria-label={`Copy delivery ID ${del.id}`}
                          >
                            {copiedId === del.id ? (
                              <Check className="w-3 h-3 text-[#159B78]" />
                            ) : (
                              <Copy className="w-3 h-3" />
                            )}
                          </button>
                        </div>
                      </td>

                      <td className="py-3 px-4 text-[#64748B] font-mono max-w-xs truncate">
                        {del.endpoint_url || del.endpoint_id}
                      </td>

                      <td className="py-3 px-4">
                        <StatusBadge state={del.state} />
                      </td>

                      <td className="py-3 px-4">
                        <span
                          className={`px-2 py-0.5 rounded text-2xs font-semibold border ${
                            statusInfo.category === 'success'
                              ? 'bg-[#159B78]/10 text-[#159B78] border-[#159B78]/25'
                              : statusInfo.category === 'client-error'
                              ? 'bg-[#E5B34B]/15 text-[#B8871E] border-[#E5B34B]/30'
                              : 'bg-[#E76B64]/10 text-[#E76B64] border-[#E76B64]/25'
                          }`}
                        >
                          {del.last_status_code ?? 'None'}
                        </span>
                      </td>

                      <td className="py-3 px-4 font-mono text-[#202938] font-semibold">
                        #{del.seq}
                      </td>

                      <td className="py-3 px-4 text-[#202938] font-medium">
                        #{del.attempt_count}
                      </td>

                      <td className="py-3 px-4 text-[#64748B]">
                        {del.state === 'RETRYING' ? (
                          <span className="text-[#B8871E] font-semibold">
                            Due {formatRelativeTime(del.next_attempt_at)}
                          </span>
                        ) : del.state === 'IN_FLIGHT' ? (
                          <span className="text-[#5277D9] font-semibold">Processing...</span>
                        ) : (
                          formatRelativeTime(del.updated_at)
                        )}
                      </td>

                      <td className="py-3 px-4 text-right">
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-[#5277D9] hover:text-[#4366C4]">
                          <span>Inspect</span>
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
            itemName="deliveries"
            isLoading={isLoading}
          />
        )}
      </Card>

      {/* Delivery Detail Drawer */}
      <DeliveryDetailDrawer
        delivery={selectedDelivery}
        isOpen={detailDrawerOpen}
        onClose={() => setDetailDrawerOpen(false)}
        onReplayRequest={handleReplayClick}
      />

      {/* Replay Confirmation Modal */}
      <ReplayModal
        delivery={deliveryToReplay}
        isOpen={replayModalOpen}
        onClose={() => setReplayModalOpen(false)}
        onSuccess={() => {
          loadDeliveries(page, pageSize)
        }}
      />
    </div>
  )
}
