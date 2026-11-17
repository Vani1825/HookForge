import React, { useState, useEffect, useRef, useMemo } from 'react'
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
  AlertCircle,
  RotateCw,
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
import {
  formatRelativeTime,
  formatDateTime,
  truncateId,
  formatStatusCode,
  copyToClipboard,
} from '../utils/formatters'
import { useDebounce } from '../hooks/useDebounce'
import type { Delivery, Endpoint, PaginationMeta } from '../types'

export const DeliveriesPage: React.FC = () => {
  const { service, mode } = useApp()

  // Primary data state
  const [deliveries, setDeliveries] = useState<Delivery[]>([])
  const [endpoints, setEndpoints] = useState<Endpoint[]>([])
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

  const [stateFilter, setStateFilter] = useState<string>('ALL')
  const [endpointFilter, setEndpointFilter] = useState<string>('')
  const [eventFilter, setEventFilter] = useState<string>('')
  const [createdAfterFilter, setCreatedAfterFilter] = useState<string>('')
  const [createdBeforeFilter, setCreatedBeforeFilter] = useState<string>('')
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false)

  // Manual refresh counter trigger
  const [refreshKey, setRefreshKey] = useState(0)

  // Drawers & Modals
  const [selectedDelivery, setSelectedDelivery] = useState<Delivery | null>(null)
  const [detailDrawerOpen, setDetailDrawerOpen] = useState(false)
  const [replayModalOpen, setReplayModalOpen] = useState(false)
  const [deliveryToReplay, setDeliveryToReplay] = useState<Delivery | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  // Guard against out-of-order asynchronous responses and track initial load
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
    return [Boolean(eventFilter), Boolean(createdAfterFilter), Boolean(createdBeforeFilter)].filter(
      Boolean
    ).length
  }, [eventFilter, createdAfterFilter, createdBeforeFilter])

  // Check if any filters are currently active
  const hasActiveFilters = useMemo(() => {
    return (
      stateFilter !== 'ALL' ||
      Boolean(endpointFilter) ||
      Boolean(eventFilter) ||
      Boolean(createdAfterFilter) ||
      Boolean(createdBeforeFilter) ||
      Boolean(searchQuery.trim())
    )
  }, [
    stateFilter,
    endpointFilter,
    eventFilter,
    createdAfterFilter,
    createdBeforeFilter,
    searchQuery,
  ])

  // Load configured endpoints for the dropdown filter on mount or mode change
  useEffect(() => {
    service.getEndpoints().then(setEndpoints).catch(() => setEndpoints([]))
  }, [service, mode])

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
      state: stateFilter || 'ALL',
    }

    if (endpointFilter.trim()) {
      queryParams.endpoint_id = endpointFilter.trim()
    }
    if (eventFilter.trim()) {
      queryParams.event_id = eventFilter.trim()
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

    service
      .getDeliveries(queryParams)
      .then((res) => {
        if (isCancelled || reqId !== latestRequestIdRef.current) return
        setDeliveries(res.data || res)
        if (res.pagination) {
          setPagination(res.pagination)
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
    stateFilter,
    endpointFilter,
    eventFilter,
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

  const handleStateChange = (newState: string) => {
    setStateFilter(newState)
    setPage(1)
  }

  const handleEndpointChange = (newEndpoint: string) => {
    setEndpointFilter(newEndpoint)
    setPage(1)
  }

  const handleEventFilterChange = (newEventId: string) => {
    setEventFilter(newEventId)
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

  const handleSearchChange = (newQuery: string) => {
    setSearchQuery(newQuery)
    setPage(1)
  }

  const handleClearAllFilters = () => {
    setStateFilter('ALL')
    setEndpointFilter('')
    setEventFilter('')
    setCreatedAfterFilter('')
    setCreatedBeforeFilter('')
    setSearchQuery('')
    setPage(1)
  }

  const handleRefresh = () => {
    setRefreshKey((k) => k + 1)
  }

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
            onClick={handleRefresh}
            isLoading={isFetching}
            leftIcon={<RefreshCw className={`w-3.5 h-3.5 ${isFetching ? 'animate-spin' : ''}`} />}
            aria-label="Refresh deliveries list"
          >
            Refresh
          </Button>
        }
      />

      {/* Filter / Search Card */}
      <Card className="p-3.5 sm:p-4 bg-white space-y-3 shadow-2xs">
        {/* Primary Row: Search, State, Endpoint, Advanced Toggle */}
        <div className="flex flex-col md:flex-row items-center gap-2.5 sm:gap-3">
          <div className="flex-1 w-full min-w-0">
            <Input
              placeholder="Search by Delivery ID, Event ID, Endpoint URL, or Error..."
              value={searchQuery}
              onChange={(e) => handleSearchChange(e.target.value)}
              aria-label="Search deliveries"
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
            {/* State filter dropdown */}
            <div className="flex items-center gap-1.5 text-xs text-[#64748B] font-semibold flex-1 sm:flex-initial min-w-0">
              <Filter className="w-3.5 h-3.5 shrink-0" />
              <span className="shrink-0">State:</span>
              <select
                value={stateFilter}
                onChange={(e) => handleStateChange(e.target.value)}
                aria-label="Filter deliveries by state"
                className="text-xs bg-[#F7F6F2] border border-[#E7E8EC] rounded-lg px-2.5 py-2 text-[#202938] focus:outline-none focus:ring-1 focus:ring-[#5277D9] cursor-pointer flex-1 sm:flex-initial min-w-0"
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
            <div className="flex items-center gap-1.5 text-xs text-[#64748B] font-semibold flex-1 sm:flex-initial min-w-0">
              <span className="shrink-0">Endpoint:</span>
              <select
                value={endpointFilter}
                onChange={(e) => handleEndpointChange(e.target.value)}
                aria-label="Filter deliveries by destination endpoint"
                className="text-xs bg-[#F7F6F2] border border-[#E7E8EC] rounded-lg px-2.5 py-2 text-[#202938] focus:outline-none focus:ring-1 focus:ring-[#5277D9] max-w-[180px] truncate cursor-pointer flex-1 sm:flex-initial min-w-0"
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
              Filters{activeAdvancedFilterCount > 0 ? ` (${activeAdvancedFilterCount})` : ''}
            </Button>
          </div>
        </div>

        {/* Collapsible Advanced Filters (Event ID, Date Range) */}
        {showAdvancedFilters && (
          <div className="pt-3 border-t border-[#E7E8EC] space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label htmlFor="event-filter-input" className="block text-2xs font-semibold text-[#64748B] mb-1">
                  Event UUID
                </label>
                <Input
                  id="event-filter-input"
                  placeholder="Filter by Event UUID..."
                  value={eventFilter}
                  onChange={(e) => handleEventFilterChange(e.target.value)}
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
                  onChange={(e) => handleCreatedAfterChange(e.target.value)}
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
                  onChange={(e) => handleCreatedBeforeChange(e.target.value)}
                  aria-label="Filter deliveries created before date"
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

            {stateFilter !== 'ALL' && (
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-[#EAF0FF] text-[#5277D9] border border-[#DCE5FA] text-xs font-semibold">
                State: <strong className="font-semibold">{stateFilter}</strong>
                <button
                  type="button"
                  onClick={() => handleStateChange('ALL')}
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
                  onClick={() => handleSearchChange('')}
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
                  onClick={() => handleEndpointChange('')}
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
                  onClick={() => handleEventFilterChange('')}
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

      {/* Main Deliveries Table Card */}
      <Card className="overflow-hidden min-w-0 shadow-2xs">
        {/* Subtle background fetching progress bar */}
        {isFetching && deliveries.length > 0 && (
          <div className="h-0.5 w-full bg-[#5277D9] animate-pulse" />
        )}

        {isLoading ? (
          <TableSkeleton rows={6} cols={8} />
        ) : error ? (
          <div className="p-8 sm:p-12 text-center text-xs space-y-4 max-w-md mx-auto">
            <div className="w-12 h-12 rounded-xl bg-[#E76B64]/10 text-[#E76B64] border border-[#E76B64]/25 flex items-center justify-center mx-auto">
              <AlertCircle className="w-6 h-6" />
            </div>
            <div>
              <h3 className="font-semibold text-sm text-[#202938]">Failed to Load Deliveries</h3>
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
        ) : deliveries.length === 0 ? (
          <EmptyState
            icon={<Send className="w-6 h-6 text-[#5277D9]" />}
            title={hasActiveFilters ? 'No Matching Deliveries' : 'No Deliveries in Queue'}
            description={
              hasActiveFilters
                ? 'No deliveries match your current filter and search criteria. Try broadening your parameters.'
                : 'Webhook delivery tasks will appear here as incoming events are dispatched to active destination endpoints.'
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
            <table className="w-full text-left text-xs min-w-[840px]">
              <thead className="bg-[#F7F6F2] border-b border-[#E7E8EC] text-[#64748B] font-semibold">
                <tr>
                  <th className="py-3 px-4">Delivery ID</th>
                  <th className="py-3 px-4">Destination Endpoint</th>
                  <th className="py-3 px-4">State</th>
                  <th className="py-3 px-4">HTTP</th>
                  <th className="py-3 px-4">Seq</th>
                  <th className="py-3 px-4">Attempts</th>
                  <th className="py-3 px-4">Next Retry / Timing</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E7E8EC]">
                {deliveries.map((del) => {
                  const statusInfo = formatStatusCode(del.last_status_code)
                  return (
                    <tr
                      key={del.id}
                      onClick={() => handleInspect(del)}
                      className="hover:bg-[#F7F6F2]/70 transition-colors cursor-pointer group"
                    >
                      {/* Delivery ID */}
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-1.5 font-mono font-semibold text-[#202938]">
                          <span title={del.id}>{truncateId(del.id, 8)}</span>
                          <button
                            type="button"
                            onClick={(e) => handleCopy(del.id, e)}
                            className="text-[#64748B] hover:text-[#202938] p-0.5 rounded cursor-pointer transition-colors"
                            title="Copy full Delivery ID"
                            aria-label={`Copy delivery ID ${del.id}`}
                          >
                            {copiedId === del.id ? (
                              <Check className="w-3 h-3 text-[#159B78]" />
                            ) : (
                              <Copy className="w-3 h-3 opacity-60 group-hover:opacity-100" />
                            )}
                          </button>
                        </div>
                      </td>

                      {/* Destination Endpoint */}
                      <td className="py-3 px-4 text-[#64748B] font-mono max-w-xs truncate">
                        <span
                          title={del.endpoint_url || del.endpoint_id}
                          className="hover:text-[#202938] transition-colors"
                        >
                          {del.endpoint_url || del.endpoint_id}
                        </span>
                      </td>

                      {/* Delivery State Badge */}
                      <td className="py-3 px-4">
                        <StatusBadge state={del.state} />
                      </td>

                      {/* HTTP Status Code */}
                      <td className="py-3 px-4">
                        <span
                          className={`px-2 py-0.5 rounded text-2xs font-semibold border ${
                            statusInfo.category === 'success'
                              ? 'bg-[#159B78]/10 text-[#159B78] border-[#159B78]/25'
                              : statusInfo.category === 'client-error'
                              ? 'bg-[#E5B34B]/15 text-[#B8871E] border-[#E5B34B]/30'
                              : statusInfo.category === 'server-error'
                              ? 'bg-[#E76B64]/10 text-[#E76B64] border-[#E76B64]/25'
                              : 'bg-[#F7F6F2] text-[#64748B] border-[#E7E8EC]'
                          }`}
                        >
                          {del.last_status_code ?? 'None'}
                        </span>
                      </td>

                      {/* Sequence Number */}
                      <td className="py-3 px-4 font-mono text-[#202938] font-semibold">
                        <span className="px-1.5 py-0.5 rounded bg-[#F7F6F2] border border-[#E7E8EC] text-2xs">
                          #{del.seq}
                        </span>
                      </td>

                      {/* Attempt Count */}
                      <td className="py-3 px-4 text-[#202938] font-medium">
                        <span className="text-2xs font-semibold">#{del.attempt_count}</span>
                      </td>

                      {/* Next Retry / Timing */}
                      <td className="py-3 px-4 text-[#64748B]">
                        {del.state === 'RETRYING' ? (
                          <span
                            className="text-[#B8871E] font-semibold inline-flex items-center gap-1"
                            title={del.next_attempt_at ? formatDateTime(del.next_attempt_at) : undefined}
                          >
                            <span>Due {formatRelativeTime(del.next_attempt_at)}</span>
                          </span>
                        ) : del.state === 'IN_FLIGHT' ? (
                          <span className="text-[#5277D9] font-semibold inline-flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-[#5277D9] animate-ping" />
                            <span>Processing...</span>
                          </span>
                        ) : (
                          <span title={formatDateTime(del.updated_at)}>
                            {formatRelativeTime(del.updated_at)}
                          </span>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="py-3 px-4 text-right">
                        <div className="inline-flex items-center gap-2 justify-end">
                          {del.state === 'DEAD' && (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation()
                                handleReplayClick(del)
                              }}
                              className="text-2xs h-6 px-2 text-[#B8871E] border-[#E5B34B]/40 hover:bg-[#E5B34B]/10 transition-colors"
                              leftIcon={<RotateCw className="w-3 h-3 text-[#B8871E]" />}
                              title="Replay dead delivery"
                              aria-label={`Replay dead delivery ${del.id}`}
                            >
                              Replay
                            </Button>
                          )}
                          <span className="inline-flex items-center gap-1 text-xs font-semibold text-[#5277D9] group-hover:text-[#4366C4] transition-colors">
                            <span>Inspect</span>
                            <ChevronRight className="w-3.5 h-3.5 text-[#5277D9]" />
                          </span>
                        </div>
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
            isLoading={isFetching}
          />
        )}
      </Card>

      {/* Delivery Detail Drawer */}
      <DeliveryDetailDrawer
        delivery={selectedDelivery}
        isOpen={detailDrawerOpen}
        onClose={() => setDetailDrawerOpen(false)}
        onReplayRequest={handleReplayClick}
        onReplaySuccess={(updated) => {
          setSelectedDelivery(updated)
          handleRefresh()
        }}
      />

      {/* Replay Confirmation Modal */}
      <ReplayModal
        delivery={deliveryToReplay}
        isOpen={replayModalOpen}
        onClose={() => setReplayModalOpen(false)}
        onSuccess={(updated) => {
          handleRefresh()
          if (updated && selectedDelivery && updated.id === selectedDelivery.id) {
            setSelectedDelivery(updated)
          } else if (
            selectedDelivery &&
            deliveryToReplay &&
            selectedDelivery.id === deliveryToReplay.id
          ) {
            service
              .getDeliveryById(selectedDelivery.id)
              .then((fresh) => {
                if (fresh) setSelectedDelivery(fresh)
              })
              .catch(() => {})
          }
        }}
      />
    </div>
  )
}
