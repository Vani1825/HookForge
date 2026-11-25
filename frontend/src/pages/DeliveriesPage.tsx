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
  RotateCw,
  Plus,
  AlertTriangle,
  ArrowUpDown,
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
import { formatRelativeTime, truncateId, formatStatusCode, copyToClipboard } from '../utils/formatters'
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

  // Drawers & Modals
  const [selectedDelivery, setSelectedDelivery] = useState<Delivery | null>(null)
  const [detailDrawerOpen, setDetailDrawerOpen] = useState(false)
  const [replayModalOpen, setReplayModalOpen] = useState(false)
  const [deliveryToReplay, setDeliveryToReplay] = useState<Delivery | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  // Scheduling & Bulk Replay State
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [scheduleModalOpen, setScheduleModalOpen] = useState(false)
  const [bulkReplayConfirmOpen, setBulkReplayConfirmOpen] = useState(false)
  const [bulkReplayResultOpen, setBulkReplayResultOpen] = useState(false)
  const [bulkReplayResult, setBulkReplayResult] = useState<BulkReplayResult | null>(null)

  // Guard against race conditions and out-of-order network responses
  const latestRequestIdRef = useRef(0)

  // Load configured endpoints for the dropdown filter
  useEffect(() => {
    service.getEndpoints().then(setEndpoints).catch(() => setEndpoints([]))
  }, [service, mode])

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

  const loadDeliveries = useCallback(
    async (
      targetPage = page,
      targetPageSize = pageSize,
      currentFilters = {
        state: stateFilter,
        endpoint_id: endpointFilter,
        event_id: eventFilter,
        event_type: eventTypeFilter,
        created_after: createdAfterFilter,
        created_before: createdBeforeFilter,
        status_code: statusCodeFilter,
        attempt_count: attemptCountFilter,
        min_attempts: minAttemptsFilter,
        max_attempts: maxAttemptsFilter,
        sortBy,
        sortOrder,
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
        if (currentFilters.event_type?.trim()) {
          queryParams.event_type = currentFilters.event_type.trim()
        }

        // Date validation: do not send invalid reversed range
        const hasReversedDates = Boolean(
          currentFilters.created_after &&
            currentFilters.created_before &&
            new Date(currentFilters.created_after).getTime() >
              new Date(currentFilters.created_before).getTime()
        )

        if (!hasReversedDates) {
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
        }

        // Status code filter
        if (currentFilters.status_code?.trim()) {
          queryParams.status_code = currentFilters.status_code.trim()
        }

        // Attempt count & bounds validation: do not send reversed bounds
        const hasReversedAttempts = Boolean(
          currentFilters.min_attempts !== '' &&
            currentFilters.max_attempts !== '' &&
            Number(currentFilters.min_attempts) > Number(currentFilters.max_attempts)
        )

        if (currentFilters.attempt_count !== '' && currentFilters.attempt_count !== undefined) {
          const num = Number(currentFilters.attempt_count)
          if (!isNaN(num) && num >= 0) {
            queryParams.attempt_count = num
          }
        }

        if (!hasReversedAttempts) {
          if (currentFilters.min_attempts !== '' && currentFilters.min_attempts !== undefined) {
            const minNum = Number(currentFilters.min_attempts)
            if (!isNaN(minNum) && minNum >= 0) {
              queryParams.min_attempts = minNum
            }
          }
          if (currentFilters.max_attempts !== '' && currentFilters.max_attempts !== undefined) {
            const maxNum = Number(currentFilters.max_attempts)
            if (!isNaN(maxNum) && maxNum >= 0) {
              queryParams.max_attempts = maxNum
            }
          }
        }

        // Sort parameters
        if (currentFilters.sortBy) {
          queryParams.sortBy = currentFilters.sortBy
        }
        if (currentFilters.sortOrder) {
          queryParams.sortOrder = currentFilters.sortOrder
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
    const updated = {
      state: updates.state !== undefined ? updates.state : stateFilter,
      endpoint_id: updates.endpoint_id !== undefined ? updates.endpoint_id : endpointFilter,
      event_id: updates.event_id !== undefined ? updates.event_id : eventFilter,
      event_type: updates.event_type !== undefined ? updates.event_type : eventTypeFilter,
      created_after: updates.created_after !== undefined ? updates.created_after : createdAfterFilter,
      created_before: updates.created_before !== undefined ? updates.created_before : createdBeforeFilter,
      status_code: updates.status_code !== undefined ? updates.status_code : statusCodeFilter,
      attempt_count: updates.attempt_count !== undefined ? updates.attempt_count : attemptCountFilter,
      min_attempts: updates.min_attempts !== undefined ? updates.min_attempts : minAttemptsFilter,
      max_attempts: updates.max_attempts !== undefined ? updates.max_attempts : maxAttemptsFilter,
      sortBy: updates.sortBy !== undefined ? updates.sortBy : sortBy,
      sortOrder: updates.sortOrder !== undefined ? updates.sortOrder : sortOrder,
      q: updates.q !== undefined ? updates.q : searchQuery,
    }

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
    loadDeliveries(1, pageSize, updated)
  }

  // Multi-state selection toggle handler
  const handleToggleStatePill = (targetState: DeliveryState | 'ALL') => {
    if (targetState === 'ALL') {
      applyFilterUpdate({ state: 'ALL' })
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
    applyFilterUpdate({ state: nextState })
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
    loadDeliveries(1, pageSize, {
      state: 'ALL',
      endpoint_id: '',
      event_id: '',
      event_type: '',
      created_after: '',
      created_before: '',
      status_code: '',
      attempt_count: '',
      min_attempts: '',
      max_attempts: '',
      sortBy: 'created_at',
      sortOrder: 'DESC',
      q: '',
    })
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

  // Header column sort toggle
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
              onClick={() => loadDeliveries(page, pageSize)}
              isLoading={isLoading}
              leftIcon={<RefreshCw className="w-3.5 h-3.5" />}
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
      <Card className="p-4 bg-white space-y-3.5">
        {/* Primary Row: Search, State Select, Endpoint, Advanced Toggle */}
        <div className="flex flex-col md:flex-row items-center gap-3">
          <div className="flex-1 w-full">
            <Input
              placeholder="Search delivery ID, event ID, endpoint URL, error, idempotency key..."
              value={searchQuery}
              onChange={(e) => applyFilterUpdate({ q: e.target.value })}
              aria-label="Search deliveries"
              leftIcon={<Search className="w-4 h-4 text-[#64748B]" />}
            />
          </div>

          <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
            {/* Backward-compatible State Dropdown */}
            <div className="flex items-center gap-1.5 text-xs text-[#64748B] font-semibold">
              <Filter className="w-3.5 h-3.5" />
              <span>State:</span>
              <select
                value={stateFilter.includes(',') ? 'MULTI' : stateFilter}
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
              data-testid="toggle-advanced-filters"
            >
              Advanced Filters
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
              <button
                key={qs.state}
                type="button"
                onClick={() => handleToggleStatePill(qs.state)}
                data-testid={`state-pill-${qs.state.toLowerCase()}`}
                className={`px-2.5 py-1 rounded-full font-semibold border transition-all cursor-pointer ${
                  isSelected
                    ? 'bg-[#5277D9] text-white border-[#5277D9] shadow-2xs'
                    : 'bg-[#F7F6F2] text-[#64748B] border-[#E7E8EC] hover:bg-[#EAF0FF] hover:text-[#5277D9]'
                }`}
              >
                {qs.label}
              </button>
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
                  onChange={(e) => applyFilterUpdate({ event_id: e.target.value })}
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
                  onChange={(e) => applyFilterUpdate({ created_after: e.target.value })}
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
                  onChange={(e) => applyFilterUpdate({ created_before: e.target.value })}
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
              <div className="p-2 bg-[#E76B64]/10 border border-[#E76B64]/25 rounded-lg text-2xs text-[#E76B64] flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                <span>Validation Error: 'Created After' date must be before or equal to 'Created Before' date.</span>
              </div>
            )}

            {isAttemptRangeInvalid && (
              <div className="p-2 bg-[#E76B64]/10 border border-[#E76B64]/25 rounded-lg text-2xs text-[#E76B64] flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
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
                Event ID: <strong className="font-semibold truncate max-w-[120px]">{eventFilter}</strong>
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

            {(sortBy !== 'created_at' || sortOrder !== 'DESC') && (
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-[#EAF0FF] text-[#5277D9] border border-[#DCE5FA] text-xs font-semibold">
                Sort: <strong className="font-semibold">{sortBy} ({sortOrder})</strong>
                <button
                  type="button"
                  onClick={() => applyFilterUpdate({ sortBy: 'created_at', sortOrder: 'DESC' })}
                  aria-label="Reset sorting"
                  className="hover:text-[#4366C4] cursor-pointer"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            )}

            <button
              type="button"
              onClick={handleClearAllFilters}
              aria-label="Clear all filters"
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
          <div>
            {/* Bulk Selection Notification Bar */}
            {selectedIds.length > 0 && (
              <div className="bg-[#EAF0FF] border-b border-[#DCE5FA] px-4 py-2.5 flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-[#5277D9]">
                    {selectedIds.length} failed {selectedIds.length === 1 ? 'delivery' : 'deliveries'} selected for replay
                  </span>
                  <button
                    type="button"
                    onClick={() => setSelectedIds([])}
                    className="text-2xs text-[#64748B] hover:text-[#202938] underline ml-2 cursor-pointer"
                  >
                    Clear selection
                  </button>
                </div>
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  onClick={() => setBulkReplayConfirmOpen(true)}
                  leftIcon={<RotateCw className="w-3.5 h-3.5" />}
                >
                  Bulk Replay ({selectedIds.length})
                </Button>
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-[#F7F6F2] border-b border-[#E7E8EC] text-[#64748B] font-semibold">
                  <tr>
                    <th className="py-3 px-3 w-10 text-center">
                      <input
                        type="checkbox"
                        checked={allEligibleSelected}
                        ref={(input) => {
                          if (input) input.indeterminate = someEligibleSelected && !allEligibleSelected
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
                        <span>Next Retry / Time</span>
                        {sortBy === 'created_at' && <span>{sortOrder === 'ASC' ? '▲' : '▼'}</span>}
                      </div>
                    </th>
                    <th className="py-3 px-4 text-right">Action</th>
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
                        className={`hover:bg-[#F7F6F2]/70 transition-colors cursor-pointer ${
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
        onResendSuccess={() => {
          loadDeliveries(page, pageSize)
        }}
        onCancelRequest={(del) => {
          service
            .cancelScheduledDelivery(del.id)
            .then(() => {
              setDetailDrawerOpen(false)
              loadDeliveries(page, pageSize)
            })
            .catch(() => {})
        }}
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

      {/* Schedule Webhook Modal */}
      <ScheduleDeliveryModal
        isOpen={scheduleModalOpen}
        onClose={() => setScheduleModalOpen(false)}
        onSuccess={() => {
          loadDeliveries(page, pageSize)
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
          loadDeliveries(page, pageSize)
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
