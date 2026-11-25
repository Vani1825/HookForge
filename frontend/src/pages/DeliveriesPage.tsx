import React, { useState, useEffect, useRef } from 'react'
import {
  RotateCw,
  Search,
  Filter,
  Check,
  Copy,
  ChevronRight,
  SlidersHorizontal,
  X,
  AlertCircle,
  Plus,
  RefreshCw,
  ArrowUpDown,
  Send,
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
import { ScheduleDeliveryModal } from '../components/ScheduleDeliveryModal'
import { BulkReplayConfirmModal } from '../components/BulkReplayConfirmModal'
import { BulkReplayResultModal } from '../components/BulkReplayResultModal'
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
import type { Delivery, Endpoint, PaginationMeta, BulkReplayResult, DeliveryState } from '../types'

const QUICK_STATES: { state: DeliveryState | 'ALL'; label: string }[] = [
  { state: 'ALL', label: 'All' },
  { state: 'SUCCEEDED', label: 'Succeeded' },
  { state: 'PENDING', label: 'Pending' },
  { state: 'IN_FLIGHT', label: 'In Flight' },
  { state: 'RETRYING', label: 'Retrying' },
  { state: 'DEAD', label: 'Dead Letter' },
  { state: 'SCHEDULED', label: 'Scheduled' },
  { state: 'CANCELLED', label: 'Cancelled' },
]

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
  const [eventTypeFilter, setEventTypeFilter] = useState<string>('')
  const [createdAfterFilter, setCreatedAfterFilter] = useState<string>('')
  const [createdBeforeFilter, setCreatedBeforeFilter] = useState<string>('')
  const [statusCodeFilter, setStatusCodeFilter] = useState<string>('')
  const [attemptCountFilter, setAttemptCountFilter] = useState<string>('')
  const [minAttemptsFilter, setMinAttemptsFilter] = useState<string>('')
  const [maxAttemptsFilter, setMaxAttemptsFilter] = useState<string>('')
  const [sortBy, setSortBy] = useState<string>('created_at')
  const [sortOrder, setSortOrder] = useState<'ASC' | 'DESC'>('DESC')

  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false)

  // Modals & Drawers
  const [detailDrawerOpen, setDetailDrawerOpen] = useState(false)
  const [selectedDelivery, setSelectedDelivery] = useState<Delivery | null>(null)
  const [replayModalOpen, setReplayModalOpen] = useState(false)
  const [deliveryToReplay, setDeliveryToReplay] = useState<Delivery | null>(null)

  // Phase 2 Task 1: Schedule Delivery & Bulk Replay states
  const [scheduleModalOpen, setScheduleModalOpen] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [bulkReplayConfirmOpen, setBulkReplayConfirmOpen] = useState(false)
  const [bulkReplayResultOpen, setBulkReplayResultOpen] = useState(false)
  const [bulkReplayResult, setBulkReplayResult] = useState<BulkReplayResult | null>(null)

  // Clipboard copy state
  const [copiedId, setCopiedId] = useState<string | null>(null)

  // Manual refresh key
  const [refreshKey, setRefreshKey] = useState(0)

  // Request deduplication & cancellation refs
  const latestRequestIdRef = useRef(0)
  const hasLoadedOnceRef = useRef(false)

  // Validation checks
  const isDateRangeInvalid = Boolean(
    createdAfterFilter &&
      createdBeforeFilter &&
      new Date(createdAfterFilter).getTime() > new Date(createdBeforeFilter).getTime()
  )

  const isAttemptRangeInvalid = Boolean(
    minAttemptsFilter !== '' &&
      maxAttemptsFilter !== '' &&
      Number(minAttemptsFilter) > Number(maxAttemptsFilter)
  )

  // Load configured endpoints for the dropdown filter on mount or mode change
  useEffect(() => {
    service.getEndpoints().then(setEndpoints).catch(() => setEndpoints([]))
  }, [service, mode])

  // Clear selections on filter/pagination change
  useEffect(() => {
    setSelectedIds([])
  }, [
    page,
    pageSize,
    stateFilter,
    endpointFilter,
    eventFilter,
    eventTypeFilter,
    createdAfterFilter,
    createdBeforeFilter,
    statusCodeFilter,
    attemptCountFilter,
    minAttemptsFilter,
    maxAttemptsFilter,
    sortBy,
    sortOrder,
    searchQuery,
  ])

  // Declarative single data-loading effect: handles pagination, filters, debounce, refresh, and mode
  useEffect(() => {
    if (isDateRangeInvalid || isAttemptRangeInvalid) {
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
    if (eventTypeFilter.trim()) {
      queryParams.event_type = eventTypeFilter.trim()
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

    if (statusCodeFilter.trim()) {
      queryParams.status_code = statusCodeFilter.trim()
    }

    if (attemptCountFilter !== '' && attemptCountFilter !== undefined) {
      const num = Number(attemptCountFilter)
      if (!isNaN(num) && num >= 0) {
        queryParams.attempt_count = num
      }
    }

    if (minAttemptsFilter !== '' && minAttemptsFilter !== undefined) {
      const minNum = Number(minAttemptsFilter)
      if (!isNaN(minNum) && minNum >= 0) {
        queryParams.min_attempts = minNum
      }
    }

    if (maxAttemptsFilter !== '' && maxAttemptsFilter !== undefined) {
      const maxNum = Number(maxAttemptsFilter)
      if (!isNaN(maxNum) && maxNum >= 0) {
        queryParams.max_attempts = maxNum
      }
    }

    if (sortBy) {
      queryParams.sortBy = sortBy
    }
    if (sortOrder) {
      queryParams.sortOrder = sortOrder
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
    eventTypeFilter,
    createdAfterFilter,
    createdBeforeFilter,
    statusCodeFilter,
    attemptCountFilter,
    minAttemptsFilter,
    maxAttemptsFilter,
    sortBy,
    sortOrder,
    debouncedSearchQuery,
    isDateRangeInvalid,
    isAttemptRangeInvalid,
    mode,
    refreshKey,
    service,
  ])

  // Handlers for pagination and filters
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

  const applyFilterUpdate = (
    updates: Partial<{
      state: string
      endpoint_id: string
      event_id: string
      event_type: string
      created_after: string
      created_before: string
      status_code: string
      attempt_count: string
      min_attempts: string
      max_attempts: string
      sortBy: string
      sortOrder: 'ASC' | 'DESC'
      q: string
    }>
  ) => {
    if (updates.state !== undefined) setStateFilter(updates.state)
    if (updates.endpoint_id !== undefined) setEndpointFilter(updates.endpoint_id)
    if (updates.event_id !== undefined) setEventFilter(updates.event_id)
    if (updates.event_type !== undefined) setEventTypeFilter(updates.event_type)
    if (updates.created_after !== undefined) setCreatedAfterFilter(updates.created_after)
    if (updates.created_before !== undefined) setCreatedBeforeFilter(updates.created_before)
    if (updates.status_code !== undefined) setStatusCodeFilter(updates.status_code)
    if (updates.attempt_count !== undefined) setAttemptCountFilter(updates.attempt_count)
    if (updates.min_attempts !== undefined) setMinAttemptsFilter(updates.min_attempts)
    if (updates.max_attempts !== undefined) setMaxAttemptsFilter(updates.max_attempts)
    if (updates.sortBy !== undefined) setSortBy(updates.sortBy)
    if (updates.sortOrder !== undefined) setSortOrder(updates.sortOrder)
    if (updates.q !== undefined) setSearchQuery(updates.q)
    setPage(1)
  }

  const handleToggleStatePill = (targetState: DeliveryState | 'ALL') => {
    if (targetState === 'ALL') {
      setStateFilter('ALL')
      setPage(1)
      return
    }

    const currentSelected =
      stateFilter === 'ALL' || !stateFilter
        ? []
        : stateFilter.split(',').map((s) => s.trim().toUpperCase())

    let newStates: string[]
    if (currentSelected.includes(targetState)) {
      newStates = currentSelected.filter((s) => s !== targetState)
    } else {
      newStates = [...currentSelected, targetState]
    }

    const nextState = newStates.length === 0 ? 'ALL' : newStates.join(',')
    setStateFilter(nextState)
    setPage(1)
  }

  const handleClearAllFilters = () => {
    setStateFilter('ALL')
    setEndpointFilter('')
    setEventFilter('')
    setEventTypeFilter('')
    setCreatedAfterFilter('')
    setCreatedBeforeFilter('')
    setStatusCodeFilter('')
    setAttemptCountFilter('')
    setMinAttemptsFilter('')
    setMaxAttemptsFilter('')
    setSortBy('created_at')
    setSortOrder('DESC')
    setSearchQuery('')
    setPage(1)
  }

  const handleRefresh = () => {
    setRefreshKey((k) => k + 1)
  }

  const hasActiveFilters =
    stateFilter !== 'ALL' ||
    Boolean(endpointFilter) ||
    Boolean(eventFilter) ||
    Boolean(eventTypeFilter) ||
    Boolean(statusCodeFilter) ||
    Boolean(attemptCountFilter) ||
    Boolean(minAttemptsFilter) ||
    Boolean(maxAttemptsFilter) ||
    Boolean(createdAfterFilter) ||
    Boolean(createdBeforeFilter) ||
    Boolean(searchQuery.trim()) ||
    sortBy !== 'created_at' ||
    sortOrder !== 'DESC'

  const activeAdvancedFilterCount = [
    Boolean(eventFilter),
    Boolean(eventTypeFilter),
    Boolean(statusCodeFilter),
    Boolean(attemptCountFilter),
    Boolean(minAttemptsFilter),
    Boolean(maxAttemptsFilter),
    Boolean(createdAfterFilter),
    Boolean(createdBeforeFilter),
    sortBy !== 'created_at',
    sortOrder !== 'DESC',
  ].filter(Boolean).length

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

  const handleHeaderSort = (column: string) => {
    if (sortBy === column) {
      const nextOrder = sortOrder === 'ASC' ? 'DESC' : 'ASC'
      applyFilterUpdate({ sortOrder: nextOrder })
    } else {
      applyFilterUpdate({ sortBy: column, sortOrder: 'DESC' })
    }
  }

  // Selection helpers for Bulk Replay
  const eligibleOnPage = deliveries.filter((d) => d.state === 'DEAD')
  const allEligibleSelected =
    eligibleOnPage.length > 0 && eligibleOnPage.every((d) => selectedIds.includes(d.id))
  const someEligibleSelected =
    eligibleOnPage.some((d) => selectedIds.includes(d.id))

  const handleToggleSelectAll = () => {
    if (allEligibleSelected) {
      setSelectedIds((prev) => prev.filter((id) => !eligibleOnPage.some((d) => d.id === id)))
    } else {
      const newIds = Array.from(new Set([...selectedIds, ...eligibleOnPage.map((d) => d.id)]))
      setSelectedIds(newIds)
    }
  }

  const handleToggleSelectRow = (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    )
  }

  const activeStatesList =
    stateFilter === 'ALL' || !stateFilter
      ? []
      : stateFilter.split(',').map((s) => s.trim().toUpperCase())

  return (
    <div className="space-y-6 text-left">
      {/* Page Header */}
      <PageHeader
        title="Delivery Pipeline Monitor"
        description="Durable PostgreSQL work queue with advanced multi-filter querying, diagnostic execution logs, and per-endpoint FIFO ordering."
        actions={
          <div className="flex items-center gap-2">
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
            {selectedIds.length > 0 && (
              <Button
                type="button"
                variant="primary"
                size="sm"
                onClick={() => setBulkReplayConfirmOpen(true)}
                leftIcon={<RotateCw className="w-3.5 h-3.5" />}
              >
                Bulk Replay ({selectedIds.length})
              </Button>
            )}
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={() => setScheduleModalOpen(true)}
              leftIcon={<Plus className="w-3.5 h-3.5" />}
            >
              Schedule Webhook
            </Button>
          </div>
        }
      />

      {/* Filter / Search Card */}
      <Card className="p-3.5 sm:p-4 bg-white space-y-3.5 shadow-2xs">
        {/* Primary Row: Search, State, Endpoint, Advanced Toggle */}
        <div className="flex flex-col md:flex-row items-center gap-2.5 sm:gap-3">
          <div className="flex-1 w-full min-w-0">
            <Input
              placeholder="Search delivery ID, event ID, endpoint URL, error, idempotency key..."
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
                value={stateFilter.includes(',') ? 'MULTI' : stateFilter}
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
                <option value="SCHEDULED">Scheduled</option>
                <option value="CANCELLED">Cancelled</option>
                {stateFilter.includes(',') && (
                  <option value="MULTI" disabled>
                    Multi-selected ({activeStatesList.length})
                  </option>
                )}
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
              data-testid="toggle-advanced-filters"
            >
              Advanced Filters{activeAdvancedFilterCount > 0 ? ` (${activeAdvancedFilterCount})` : ''}
            </Button>
          </div>
        </div>

        {/* State Quick Multi-Select Pills */}
        <div className="flex flex-wrap items-center gap-1.5 pt-1 text-2xs">
          <span className="font-semibold text-[#64748B] mr-1">Filter by States:</span>
          {QUICK_STATES.map((qs) => {
            const isAll = qs.state === 'ALL'
            const isSelected = isAll
              ? stateFilter === 'ALL' || !stateFilter
              : activeStatesList.includes(qs.state)

            return (
              <span
                key={qs.state}
                role="checkbox"
                aria-checked={isSelected}
                tabIndex={0}
                onClick={() => handleToggleStatePill(qs.state)}
                onKeyDown={(e) => {
                  if (e.key === ' ' || e.key === 'Enter') {
                    e.preventDefault()
                    handleToggleStatePill(qs.state)
                  }
                }}
                data-testid={`state-pill-${qs.state.toLowerCase()}`}
                className={`px-2.5 py-1 rounded-full font-semibold border transition-all cursor-pointer select-none ${
                  isSelected
                    ? 'bg-[#5277D9] text-white border-[#5277D9] shadow-2xs'
                    : 'bg-[#F7F6F2] text-[#64748B] border-[#E7E8EC] hover:bg-[#EAF0FF] hover:text-[#5277D9]'
                }`}
              >
                {qs.label}
              </span>
            )
          })}
        </div>

        {/* Collapsible Advanced Filters Panel */}
        {showAdvancedFilters && (
          <div className="pt-3 border-t border-[#E7E8EC] space-y-3" data-testid="advanced-filters-panel">
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
              {/* Event UUID */}
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
                  data-testid="filter-event-id"
                />
              </div>

              {/* Event Type */}
              <div>
                <label htmlFor="event-type-input" className="block text-2xs font-semibold text-[#64748B] mb-1">
                  Event Type
                </label>
                <Input
                  id="event-type-input"
                  placeholder="e.g. order.fulfilled, payment.succeeded"
                  value={eventTypeFilter}
                  onChange={(e) => applyFilterUpdate({ event_type: e.target.value })}
                  className="text-xs"
                  data-testid="filter-event-type"
                />
              </div>

              {/* Status Code or Class */}
              <div>
                <label htmlFor="status-code-select" className="block text-2xs font-semibold text-[#64748B] mb-1">
                  HTTP Status / Class
                </label>
                <div className="flex gap-1.5">
                  <select
                    id="status-code-select"
                    value={statusCodeFilter}
                    onChange={(e) => applyFilterUpdate({ status_code: e.target.value })}
                    aria-label="Filter by HTTP status code or class"
                    className="w-full text-xs bg-[#F7F6F2] border border-[#E7E8EC] rounded-lg px-2.5 py-2 text-[#202938] focus:outline-none focus:ring-1 focus:ring-[#5277D9] cursor-pointer"
                    data-testid="filter-status-code"
                  >
                    <option value="">All HTTP Statuses</option>
                    <option value="2xx">2xx (Success)</option>
                    <option value="3xx">3xx (Redirect)</option>
                    <option value="4xx">4xx (Client Error)</option>
                    <option value="5xx">5xx (Server Error)</option>
                    <option value="200">200 OK</option>
                    <option value="400">400 Bad Request</option>
                    <option value="404">404 Not Found</option>
                    <option value="429">429 Rate Limited</option>
                    <option value="500">500 Internal Error</option>
                    <option value="503">503 Service Unavailable</option>
                    <option value="504">504 Gateway Timeout</option>
                  </select>
                </div>
              </div>

              {/* Exact Attempts */}
              <div>
                <label htmlFor="attempt-count-input" className="block text-2xs font-semibold text-[#64748B] mb-1">
                  Exact Attempts
                </label>
                <Input
                  id="attempt-count-input"
                  type="number"
                  min={0}
                  placeholder="e.g. 1, 3, 5..."
                  value={attemptCountFilter}
                  onChange={(e) => applyFilterUpdate({ attempt_count: e.target.value })}
                  className="text-xs"
                  data-testid="filter-attempt-count"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
              {/* Min Attempts */}
              <div>
                <label htmlFor="min-attempts-input" className="block text-2xs font-semibold text-[#64748B] mb-1">
                  Min Attempts
                </label>
                <Input
                  id="min-attempts-input"
                  type="number"
                  min={0}
                  placeholder="Min count"
                  value={minAttemptsFilter}
                  onChange={(e) => applyFilterUpdate({ min_attempts: e.target.value })}
                  className="text-xs"
                  data-testid="filter-min-attempts"
                />
              </div>

              {/* Max Attempts */}
              <div>
                <label htmlFor="max-attempts-input" className="block text-2xs font-semibold text-[#64748B] mb-1">
                  Max Attempts
                </label>
                <Input
                  id="max-attempts-input"
                  type="number"
                  min={0}
                  placeholder="Max count"
                  value={maxAttemptsFilter}
                  onChange={(e) => applyFilterUpdate({ max_attempts: e.target.value })}
                  className="text-xs"
                  data-testid="filter-max-attempts"
                />
              </div>

              {/* Created After */}
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
                  data-testid="filter-created-after"
                />
              </div>

              {/* Created Before */}
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
                  data-testid="filter-created-before"
                />
              </div>
            </div>

            {/* Sort Controls Row */}
            <div className="pt-2 border-t border-[#E7E8EC]/70 flex flex-wrap items-center gap-3 text-xs">
              <div className="flex items-center gap-1.5 text-[#64748B] font-semibold">
                <ArrowUpDown className="w-3.5 h-3.5" />
                <span>Sort By:</span>
                <select
                  value={sortBy}
                  onChange={(e) => applyFilterUpdate({ sortBy: e.target.value })}
                  aria-label="Sort deliveries by column"
                  className="text-xs bg-[#F7F6F2] border border-[#E7E8EC] rounded-lg px-2.5 py-1.5 text-[#202938] focus:outline-none focus:ring-1 focus:ring-[#5277D9] cursor-pointer"
                  data-testid="sort-by-select"
                >
                  <option value="created_at">Created Time</option>
                  <option value="seq">Sequence #</option>
                  <option value="state">Delivery State</option>
                  <option value="attempt_count">Attempt Count</option>
                  <option value="next_attempt_at">Next Retry Time</option>
                  <option value="scheduled_at">Scheduled Time</option>
                </select>
              </div>

              <div className="flex items-center gap-1.5 text-[#64748B] font-semibold">
                <span>Order:</span>
                <select
                  value={sortOrder}
                  onChange={(e) => applyFilterUpdate({ sortOrder: e.target.value as 'ASC' | 'DESC' })}
                  aria-label="Sort direction"
                  className="text-xs bg-[#F7F6F2] border border-[#E7E8EC] rounded-lg px-2.5 py-1.5 text-[#202938] focus:outline-none focus:ring-1 focus:ring-[#5277D9] cursor-pointer"
                  data-testid="sort-order-select"
                >
                  <option value="DESC">Descending (High / Newest)</option>
                  <option value="ASC">Ascending (Low / Oldest)</option>
                </select>
              </div>
            </div>

            {/* Inline Range Validation Errors */}
            {isDateRangeInvalid && (
              <div className="p-2.5 rounded-lg bg-[#E76B64]/10 border border-[#E76B64]/25 text-xs text-[#E76B64] flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>
                  Validation Error: 'Created After' date must be before or equal to 'Created Before' date ('Created After' cannot be later than 'Created Before').
                </span>
              </div>
            )}

            {isAttemptRangeInvalid && (
              <div className="p-2.5 rounded-lg bg-[#E76B64]/10 border border-[#E76B64]/25 text-xs text-[#E76B64] flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>Validation Error: Min attempts cannot exceed max attempts.</span>
              </div>
            )}
          </div>
        )}

        {/* Active Filters Badges Bar */}
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
                Event ID: <strong className="font-semibold truncate max-w-[120px]">{eventFilter}</strong>
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

            {eventTypeFilter && (
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-[#EAF0FF] text-[#5277D9] border border-[#DCE5FA] text-xs font-semibold">
                Event Type: <strong className="font-semibold truncate max-w-[120px]">{eventTypeFilter}</strong>
                <button
                  type="button"
                  onClick={() => applyFilterUpdate({ event_type: '' })}
                  aria-label="Clear event type filter"
                  className="hover:text-[#4366C4] cursor-pointer"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            )}

            {statusCodeFilter && (
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-[#EAF0FF] text-[#5277D9] border border-[#DCE5FA] text-xs font-semibold">
                Status: <strong className="font-semibold">{statusCodeFilter}</strong>
                <button
                  type="button"
                  onClick={() => applyFilterUpdate({ status_code: '' })}
                  aria-label="Clear status code filter"
                  className="hover:text-[#4366C4] cursor-pointer"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            )}

            {attemptCountFilter && (
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-[#EAF0FF] text-[#5277D9] border border-[#DCE5FA] text-xs font-semibold">
                Attempts: <strong className="font-semibold">={attemptCountFilter}</strong>
                <button
                  type="button"
                  onClick={() => applyFilterUpdate({ attempt_count: '' })}
                  aria-label="Clear attempt count filter"
                  className="hover:text-[#4366C4] cursor-pointer"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            )}

            {(minAttemptsFilter || maxAttemptsFilter) && (
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-[#EAF0FF] text-[#5277D9] border border-[#DCE5FA] text-xs font-semibold">
                Attempt Range: <strong className="font-semibold">{minAttemptsFilter || 0} – {maxAttemptsFilter || '∞'}</strong>
                <button
                  type="button"
                  onClick={() => applyFilterUpdate({ min_attempts: '', max_attempts: '' })}
                  aria-label="Clear attempt range filter"
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

            {(sortBy !== 'created_at' || sortOrder !== 'DESC') && (
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-[#EAF0FF] text-[#5277D9] border border-[#DCE5FA] text-xs font-semibold">
                Sort: <strong className="font-semibold">{sortBy} ({sortOrder})</strong>
                <button
                  type="button"
                  onClick={() => applyFilterUpdate({ sortBy: 'created_at', sortOrder: 'DESC' })}
                  aria-label="Clear sorting"
                  className="hover:text-[#4366C4] cursor-pointer"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            )}

            <button
              type="button"
              onClick={handleClearAllFilters}
              className="text-xs text-[#5277D9] hover:underline font-semibold ml-auto cursor-pointer"
            >
              Clear all filters
            </button>
          </div>
        )}

        {/* Bulk Selection Active Action Banner */}
        {selectedIds.length > 0 && (
          <div className="p-3 bg-[#EAF0FF] border border-[#DCE5FA] rounded-xl flex items-center justify-between text-xs">
            <div className="flex items-center gap-2 text-[#5277D9] font-medium">
              <RotateCw className="w-4 h-4 text-[#5277D9]" />
              <span>
                Bulk Selection Active (<strong>{selectedIds.length}</strong> failed deliveries selected)
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setSelectedIds([])}
                className="text-xs h-7 py-1"
              >
                Clear Selection
              </Button>
              <Button
                type="button"
                variant="primary"
                size="sm"
                onClick={() => setBulkReplayConfirmOpen(true)}
                className="text-xs h-7 py-1"
                leftIcon={<RotateCw className="w-3.5 h-3.5" />}
              >
                Replay Selected ({selectedIds.length})
              </Button>
            </div>
          </div>
        )}

        {/* Deliveries Table Loading / Error / Empty / Data */}
        {error ? (
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
        ) : isLoading ? (
          <div className="p-4">
            <TableSkeleton rows={8} cols={9} />
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
                  variant="outline"
                  size="sm"
                  onClick={handleClearAllFilters}
                  leftIcon={<X className="w-3.5 h-3.5" />}
                >
                  Clear Filters
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="overflow-x-auto -mx-3.5 sm:-mx-4">
            <div className="inline-block min-w-full align-middle">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-[#E7E8EC] bg-[#F7F6F2] text-[#64748B] font-semibold">
                    <th className="py-3 px-3 text-center w-10">
                      <input
                        type="checkbox"
                        checked={allEligibleSelected}
                        ref={(el) => {
                          if (el) el.indeterminate = !allEligibleSelected && someEligibleSelected
                        }}
                        onChange={handleToggleSelectAll}
                        disabled={eligibleOnPage.length === 0}
                        title={
                          eligibleOnPage.length > 0
                            ? 'Select all eligible failed deliveries on this page'
                            : 'No failed deliveries eligible for replay on this page'
                        }
                        aria-label="Select all eligible failed deliveries"
                        className="rounded border-[#E7E8EC] text-[#5277D9] focus:ring-[#5277D9] cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                      />
                    </th>
                    <th className="py-3 px-4">Delivery ID</th>
                    <th className="py-3 px-4">Destination Endpoint</th>
                    <th
                      className="py-3 px-4 cursor-pointer hover:text-[#202938]"
                      onClick={() => handleHeaderSort('state')}
                      title="Sort by State"
                    >
                      <div className="flex items-center gap-1">
                        <span>State</span>
                        {sortBy === 'state' && <span>{sortOrder === 'ASC' ? '▲' : '▼'}</span>}
                      </div>
                    </th>
                    <th className="py-3 px-4">HTTP</th>
                    <th
                      className="py-3 px-4 cursor-pointer hover:text-[#202938]"
                      onClick={() => handleHeaderSort('seq')}
                      title="Sort by Sequence"
                    >
                      <div className="flex items-center gap-1">
                        <span>Seq</span>
                        {sortBy === 'seq' && <span>{sortOrder === 'ASC' ? '▲' : '▼'}</span>}
                      </div>
                    </th>
                    <th
                      className="py-3 px-4 cursor-pointer hover:text-[#202938]"
                      onClick={() => handleHeaderSort('attempt_count')}
                      title="Sort by Attempts"
                    >
                      <div className="flex items-center gap-1">
                        <span>Attempts</span>
                        {sortBy === 'attempt_count' && <span>{sortOrder === 'ASC' ? '▲' : '▼'}</span>}
                      </div>
                    </th>
                    <th
                      className="py-3 px-4 cursor-pointer hover:text-[#202938]"
                      onClick={() => handleHeaderSort('created_at')}
                      title="Sort by Creation Time"
                    >
                      <div className="flex items-center gap-1">
                        <span>Next Retry / Timing</span>
                        {sortBy === 'created_at' && <span>{sortOrder === 'ASC' ? '▲' : '▼'}</span>}
                      </div>
                    </th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E7E8EC]">
                  {deliveries.map((del) => {
                    const statusInfo = formatStatusCode(del.last_status_code)
                    const isDead = del.state === 'DEAD'
                    const isSelected = selectedIds.includes(del.id)
                    return (
                      <tr
                        key={del.id}
                        onClick={() => handleInspect(del)}
                        className={`hover:bg-[#F7F6F2]/70 transition-colors cursor-pointer group ${
                          isSelected ? 'bg-[#EAF0FF]/30' : ''
                        }`}
                        data-testid={`delivery-row-${del.id}`}
                      >
                        <td className="py-3 px-3 text-center" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={isSelected}
                            disabled={!isDead}
                            onChange={(e) => handleToggleSelectRow(del.id, e as unknown as React.MouseEvent)}
                            title={
                              isDead
                                ? 'Select this failed delivery for replay'
                                : 'Only DEAD deliveries can be replayed'
                            }
                            aria-label={`Select delivery ${del.id} for replay`}
                            className="rounded border-[#E7E8EC] text-[#5277D9] focus:ring-[#5277D9] cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                          />
                        </td>
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
        onResendSuccess={(updated) => {
          if (updated) setSelectedDelivery(updated)
          handleRefresh()
        }}
        onCancelRequest={(del) => {
          service
            .cancelScheduledDelivery(del.id)
            .then(() => {
              setDetailDrawerOpen(false)
              handleRefresh()
            })
            .catch(() => {})
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

      {/* Schedule Webhook Modal */}
      <ScheduleDeliveryModal
        isOpen={scheduleModalOpen}
        onClose={() => setScheduleModalOpen(false)}
        onSuccess={() => {
          handleRefresh()
        }}
      />

      {/* Bulk Replay Confirmation Modal */}
      <BulkReplayConfirmModal
        deliveryIds={selectedIds}
        isOpen={bulkReplayConfirmOpen}
        onClose={() => setBulkReplayConfirmOpen(false)}
        onComplete={(result) => {
          setBulkReplayResult(result)
          setBulkReplayResultOpen(true)
          setSelectedIds([])
          handleRefresh()
        }}
      />

      {/* Bulk Replay Result Modal */}
      <BulkReplayResultModal
        result={bulkReplayResult}
        isOpen={bulkReplayResultOpen}
        onClose={() => setBulkReplayResultOpen(false)}
      />
    </div>
  )
}
