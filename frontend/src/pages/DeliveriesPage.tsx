import React, { useState, useEffect, useCallback } from 'react'
import {
  Send,
  Search,
  RefreshCw,
  Copy,
  Check,
  ChevronRight,
  Filter,
} from 'lucide-react'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { StatusBadge } from '../components/StatusBadge'
import { TableSkeleton } from '../components/ui/LoadingSkeleton'
import { EmptyState } from '../components/ui/EmptyState'
import { DeliveryDetailDrawer } from '../components/DeliveryDetailDrawer'
import { ReplayModal } from '../components/ReplayModal'
import { useApp } from '../context/AppContext'
import { formatRelativeTime, truncateId, formatStatusCode, copyToClipboard } from '../utils/formatters'
import type { Delivery } from '../types'

export const DeliveriesPage: React.FC = () => {
  const { service, mode } = useApp()

  const [deliveries, setDeliveries] = useState<Delivery[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [stateFilter, setStateFilter] = useState<string>('ALL')

  const [selectedDelivery, setSelectedDelivery] = useState<Delivery | null>(null)
  const [detailDrawerOpen, setDetailDrawerOpen] = useState(false)

  const [replayModalOpen, setReplayModalOpen] = useState(false)
  const [deliveryToReplay, setDeliveryToReplay] = useState<Delivery | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const loadDeliveries = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const data = await service.getDeliveries()
      setDeliveries(data)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to fetch deliveries'
      setError(msg)
    } finally {
      setIsLoading(false)
    }
  }, [service])

  useEffect(() => {
    loadDeliveries()
  }, [loadDeliveries, mode])

  const handleCopy = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    const ok = await copyToClipboard(id)
    if (ok) {
      setCopiedId(id)
      setTimeout(() => setCopiedId(null), 1500)
    }
  }

  const handleInspect = async (del: Delivery) => {
    // If enriched attempts are not loaded, try fetching single delivery
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

  const filteredDeliveries = deliveries.filter((del) => {
    if (stateFilter !== 'ALL' && del.state !== stateFilter) return false
    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      return (
        del.id.toLowerCase().includes(q) ||
        del.event_id.toLowerCase().includes(q) ||
        del.endpoint_url?.toLowerCase().includes(q) ||
        (del.last_error && del.last_error.toLowerCase().includes(q))
      )
    }
    return true
  })

  return (
    <div className="space-y-6 text-left">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight">Delivery Pipeline Monitor</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Durable PostgreSQL work queue with per-endpoint sequence ordering and lease expiration.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={loadDeliveries}
            isLoading={isLoading}
            leftIcon={<RefreshCw className="w-3.5 h-3.5" />}
          >
            Refresh
          </Button>
        </div>
      </div>

      {/* Filter / Search Bar */}
      <Card className="p-4 bg-white">
        <div className="flex flex-col sm:flex-row items-center gap-3">
          <div className="flex-1 w-full">
            <Input
              placeholder="Search by Delivery ID, Event ID, Endpoint URL, or Error..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              leftIcon={<Search className="w-4 h-4 text-slate-400" />}
            />
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            <div className="flex items-center gap-1.5 text-xs text-slate-500 font-medium">
              <Filter className="w-3.5 h-3.5" />
              <span>State:</span>
            </div>
            <select
              value={stateFilter}
              onChange={(e) => setStateFilter(e.target.value)}
              className="text-xs bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-slate-700 focus:outline-none focus:ring-1 focus:ring-slate-900"
            >
              <option value="ALL">All States ({deliveries.length})</option>
              <option value="SUCCEEDED">Succeeded</option>
              <option value="PENDING">Pending</option>
              <option value="IN_FLIGHT">In Flight</option>
              <option value="RETRYING">Retrying</option>
              <option value="DEAD">Dead Letter</option>
            </select>
          </div>
        </div>
      </Card>

      {/* Main Deliveries Table */}
      <Card className="overflow-hidden">
        {isLoading ? (
          <TableSkeleton rows={6} cols={7} />
        ) : error && mode === 'live' ? (
          <div className="p-8 text-center text-xs text-rose-600 space-y-2">
            <p className="font-semibold">Failed to load deliveries from backend API.</p>
            <p className="text-slate-500 font-mono">{error}</p>
          </div>
        ) : filteredDeliveries.length === 0 ? (
          <EmptyState
            icon={<Send className="w-6 h-6 text-slate-400" />}
            title="No Deliveries Found"
            description={
              searchQuery || stateFilter !== 'ALL'
                ? 'No deliveries matched your filter criteria.'
                : 'No delivery tasks currently enqueued in the platform.'
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50/70 border-b border-slate-200 text-slate-500 font-medium">
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
              <tbody className="divide-y divide-slate-100">
                {filteredDeliveries.map((del) => {
                  const statusInfo = formatStatusCode(del.last_status_code)
                  return (
                    <tr
                      key={del.id}
                      onClick={() => handleInspect(del)}
                      className="hover:bg-slate-50/80 transition-colors cursor-pointer"
                    >
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-1.5 font-mono font-medium text-slate-800">
                          <span>{truncateId(del.id, 8)}</span>
                          <button
                            onClick={(e) => handleCopy(del.id, e)}
                            className="text-slate-400 hover:text-slate-600 p-0.5 rounded cursor-pointer"
                            title="Copy Delivery ID"
                          >
                            {copiedId === del.id ? (
                              <Check className="w-3 h-3 text-emerald-600" />
                            ) : (
                              <Copy className="w-3 h-3" />
                            )}
                          </button>
                        </div>
                      </td>

                      <td className="py-3 px-4 text-slate-600 font-mono max-w-xs truncate">
                        {del.endpoint_url || del.endpoint_id}
                      </td>

                      <td className="py-3 px-4">
                        <StatusBadge state={del.state} />
                      </td>

                      <td className="py-3 px-4">
                        <span
                          className={`px-1.5 py-0.5 rounded text-2xs font-semibold ${
                            statusInfo.category === 'success'
                              ? 'bg-emerald-100 text-emerald-800'
                              : statusInfo.category === 'client-error'
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-rose-100 text-rose-800'
                          }`}
                        >
                          {del.last_status_code ?? 'None'}
                        </span>
                      </td>

                      <td className="py-3 px-4 font-mono text-slate-700">
                        #{del.seq}
                      </td>

                      <td className="py-3 px-4 text-slate-700 font-medium">
                        #{del.attempt_count}
                      </td>

                      <td className="py-3 px-4 text-slate-500">
                        {del.state === 'RETRYING' ? (
                          <span className="text-amber-700 font-medium">
                            Due {formatRelativeTime(del.next_attempt_at)}
                          </span>
                        ) : del.state === 'IN_FLIGHT' ? (
                          <span className="text-indigo-700 font-medium">Processing...</span>
                        ) : (
                          formatRelativeTime(del.updated_at)
                        )}
                      </td>

                      <td className="py-3 px-4 text-right">
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-slate-700 hover:text-slate-900">
                          <span>Inspect</span>
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
          loadDeliveries()
        }}
      />
    </div>
  )
}
