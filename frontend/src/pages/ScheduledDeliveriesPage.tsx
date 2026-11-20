import React, { useState, useEffect, useCallback, useRef } from 'react'
import {
  Clock,
  Calendar,
  Search,
  RefreshCw,
  Copy,
  Check,
  ChevronRight,
  Filter,
  XCircle,
  Plus,
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
import { ScheduleDeliveryModal } from '../components/ScheduleDeliveryModal'
import { CancelScheduledModal } from '../components/CancelScheduledModal'
import { useApp } from '../context/AppContext'
import { formatErrorMessage } from '../api/client'
import { formatDateTime, formatRelativeTime, truncateId, copyToClipboard } from '../utils/formatters'
import type { Delivery, Endpoint, PaginationMeta } from '../types'

export const ScheduledDeliveriesPage: React.FC = () => {
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

  // Filter state
  const [searchQuery, setSearchQuery] = useState('')
  const [endpointFilter, setEndpointFilter] = useState('')

  // Modals & Drawers
  const [scheduleModalOpen, setScheduleModalOpen] = useState(false)
  const [selectedDelivery, setSelectedDelivery] = useState<Delivery | null>(null)
  const [detailDrawerOpen, setDetailDrawerOpen] = useState(false)
  const [cancelModalOpen, setCancelModalOpen] = useState(false)
  const [deliveryToCancel, setDeliveryToCancel] = useState<Delivery | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const latestRequestIdRef = useRef(0)

  // Load endpoints for filter dropdown
  useEffect(() => {
    service.getEndpoints().then(setEndpoints).catch(() => setEndpoints([]))
  }, [service, mode])

  const loadScheduledDeliveries = useCallback(
    async (
      targetPage = page,
      targetPageSize = pageSize,
      filters = {
        endpoint_id: endpointFilter,
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

        if (filters.endpoint_id?.trim()) {
          queryParams.endpoint_id = filters.endpoint_id.trim()
        }
        if (filters.q?.trim()) {
          queryParams.q = filters.q.trim()
        }

        const res = await service.getScheduledDeliveries(queryParams)

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
    [service, page, pageSize, endpointFilter, searchQuery]
  )

  useEffect(() => {
    loadScheduledDeliveries(page, pageSize)
  }, [loadScheduledDeliveries, mode, page, pageSize])

  const handlePageChange = (newPage: number) => {
    setPage(newPage)
    loadScheduledDeliveries(newPage, pageSize)
  }

  const handlePageSizeChange = (newPageSize: number) => {
    setPageSize(newPageSize)
    setPage(1)
    loadScheduledDeliveries(1, newPageSize)
  }

  const handleFilterUpdate = (updates: { endpoint_id?: string; q?: string }) => {
    const updated = {
      endpoint_id: updates.endpoint_id !== undefined ? updates.endpoint_id : endpointFilter,
      q: updates.q !== undefined ? updates.q : searchQuery,
    }
    if (updates.endpoint_id !== undefined) setEndpointFilter(updates.endpoint_id)
    if (updates.q !== undefined) setSearchQuery(updates.q)

    setPage(1)
    loadScheduledDeliveries(1, pageSize, updated)
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
      const detailed = await service.getScheduledDeliveryById(del.id)
      setSelectedDelivery(detailed || del)
    } catch {
      setSelectedDelivery(del)
    }
    setDetailDrawerOpen(true)
  }

  const handleOpenCancel = (del: Delivery, e: React.MouseEvent) => {
    e.stopPropagation()
    setDeliveryToCancel(del)
    setCancelModalOpen(true)
  }

  return (
    <div className="space-y-6 text-left">
      {/* Page Header */}
      <PageHeader
        title="Scheduled Deliveries"
        description="Monitor future webhook execution dates, manage scheduled queues, and cancel pending deliveries."
        actions={
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => loadScheduledDeliveries(page, pageSize)}
              isLoading={isLoading}
              leftIcon={<RefreshCw className="w-3.5 h-3.5" />}
            >
              Refresh
            </Button>
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

      {/* Filter and Search Bar */}
      <Card className="p-4 bg-white flex flex-col md:flex-row items-center gap-3">
        <div className="flex-1 w-full">
          <Input
            placeholder="Search by Delivery ID, Event ID, Endpoint URL..."
            value={searchQuery}
            onChange={(e) => handleFilterUpdate({ q: e.target.value })}
            aria-label="Search scheduled deliveries"
            leftIcon={<Search className="w-4 h-4 text-[#64748B]" />}
          />
        </div>

        <div className="flex items-center gap-2 w-full md:w-auto">
          <div className="flex items-center gap-1.5 text-xs text-[#64748B] font-semibold">
            <Filter className="w-3.5 h-3.5" />
            <span>Endpoint:</span>
            <select
              value={endpointFilter}
              onChange={(e) => handleFilterUpdate({ endpoint_id: e.target.value })}
              aria-label="Filter scheduled deliveries by endpoint"
              className="text-xs bg-[#F7F6F2] border border-[#E7E8EC] rounded-lg px-2.5 py-2 text-[#202938] focus:outline-none focus:ring-1 focus:ring-[#5277D9] max-w-[200px] truncate cursor-pointer"
            >
              <option value="">All Endpoints</option>
              {endpoints.map((ep) => (
                <option key={ep.id} value={ep.id}>
                  {ep.url || ep.id}
                </option>
              ))}
            </select>
          </div>
        </div>
      </Card>

      {/* Scheduled Deliveries Table */}
      <Card className="overflow-hidden">
        {isLoading ? (
          <TableSkeleton rows={5} cols={6} />
        ) : error && mode === 'live' ? (
          <div className="p-8 text-center text-xs text-[#E76B64] space-y-3">
            <p className="font-semibold text-sm">Failed to load scheduled deliveries from backend.</p>
            <p className="text-[#64748B] font-mono">{error}</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => loadScheduledDeliveries(page, pageSize)}
              className="mx-auto"
            >
              Retry
            </Button>
          </div>
        ) : deliveries.length === 0 ? (
          <EmptyState
            icon={<Calendar className="w-6 h-6 text-[#5277D9]" />}
            title="No Scheduled Deliveries"
            description={
              searchQuery || endpointFilter
                ? 'No scheduled deliveries matched your search filters.'
                : 'No deliveries currently scheduled for future dispatch.'
            }
            action={
              <Button
                type="button"
                variant="primary"
                size="sm"
                onClick={() => setScheduleModalOpen(true)}
                leftIcon={<Plus className="w-3.5 h-3.5" />}
              >
                Schedule Webhook
              </Button>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#F7F6F2] border-b border-[#E7E8EC] text-[#64748B] font-semibold">
                <tr>
                  <th className="py-3 px-4">Delivery ID</th>
                  <th className="py-3 px-4">Destination Endpoint</th>
                  <th className="py-3 px-4">Scheduled Execution Time</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Created Date</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E7E8EC]">
                {deliveries.map((del) => {
                  const scheduledTimeStr = del.scheduled_at || del.scheduledAt || del.next_attempt_at
                  const canCancel = del.state === 'SCHEDULED' || del.state === 'PENDING'
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
                        {del.endpoint_url || del.endpointId || del.endpoint_id}
                      </td>

                      <td className="py-3 px-4">
                        <div className="flex flex-col">
                          <span className="font-semibold text-[#5277D9] flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            <span>{scheduledTimeStr ? formatDateTime(scheduledTimeStr) : '—'}</span>
                          </span>
                          <span className="text-2xs text-[#64748B] mt-0.5">
                            {scheduledTimeStr ? formatRelativeTime(scheduledTimeStr) : ''}
                          </span>
                        </div>
                      </td>

                      <td className="py-3 px-4">
                        <StatusBadge state={del.state} />
                      </td>

                      <td className="py-3 px-4 text-[#64748B]">
                        {del.created_at ? formatDateTime(del.created_at) : '—'}
                      </td>

                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => handleInspect(del)}
                            className="inline-flex items-center gap-1 text-xs font-semibold text-[#5277D9] hover:text-[#4366C4] cursor-pointer"
                          >
                            <span>Inspect</span>
                            <ChevronRight className="w-3.5 h-3.5" />
                          </button>
                          {canCancel && (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="text-[#E76B64] border-[#E76B64]/30 hover:bg-[#E76B64]/10 text-xs py-1"
                              onClick={(e) => handleOpenCancel(del, e)}
                            >
                              <XCircle className="w-3 h-3 mr-1" />
                              Cancel
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Server-side Pagination */}
        {!isLoading && !error && (
          <Pagination
            pagination={pagination}
            onPageChange={handlePageChange}
            onPageSizeChange={handlePageSizeChange}
            itemName="scheduled deliveries"
            isLoading={isLoading}
          />
        )}
      </Card>

      {/* Schedule Webhook Modal */}
      <ScheduleDeliveryModal
        isOpen={scheduleModalOpen}
        onClose={() => setScheduleModalOpen(false)}
        onSuccess={() => {
          loadScheduledDeliveries(1, pageSize)
        }}
      />

      {/* Cancel Scheduled Modal */}
      <CancelScheduledModal
        delivery={deliveryToCancel}
        isOpen={cancelModalOpen}
        onClose={() => setCancelModalOpen(false)}
        onSuccess={() => {
          loadScheduledDeliveries(page, pageSize)
        }}
      />

      {/* Detail Drawer */}
      <DeliveryDetailDrawer
        delivery={selectedDelivery}
        isOpen={detailDrawerOpen}
        onClose={() => setDetailDrawerOpen(false)}
        onCancelRequest={(del) => {
          setDeliveryToCancel(del)
          setCancelModalOpen(true)
        }}
      />
    </div>
  )
}

