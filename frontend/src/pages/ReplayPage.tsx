import React, { useState, useEffect, useCallback } from 'react'
import {
  RotateCw,
  RefreshCw,
  CheckCircle2,
} from 'lucide-react'
import { Card, CardHeader, CardTitle } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { PageHeader } from '../components/ui/PageHeader'
import { TableSkeleton } from '../components/ui/LoadingSkeleton'
import { EmptyState } from '../components/ui/EmptyState'
import { ReplayModal } from '../components/ReplayModal'
import { BulkReplayConfirmModal } from '../components/BulkReplayConfirmModal'
import { BulkReplayResultModal } from '../components/BulkReplayResultModal'
import { DeliveryDetailDrawer } from '../components/DeliveryDetailDrawer'
import { useApp } from '../context/AppContext'
import { formatErrorMessage } from '../api/client'
import { truncateId } from '../utils/formatters'
import type { Delivery, BulkReplayResult } from '../types'

export const ReplayPage: React.FC = () => {
  const { service, mode } = useApp()

  const [replayableDeliveries, setReplayableDeliveries] = useState<Delivery[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [selectedDelivery, setSelectedDelivery] = useState<Delivery | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)

  const [deliveryToReplay, setDeliveryToReplay] = useState<Delivery | null>(null)
  const [replayModalOpen, setReplayModalOpen] = useState(false)

  // Bulk Replay State
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [bulkReplayConfirmOpen, setBulkReplayConfirmOpen] = useState(false)
  const [bulkReplayResultOpen, setBulkReplayResultOpen] = useState(false)
  const [bulkReplayResult, setBulkReplayResult] = useState<BulkReplayResult | null>(null)

  const loadData = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const data = await service.getDeadLetters()
      setReplayableDeliveries(data)
    } catch (err: unknown) {
      const msg = formatErrorMessage(err)
      setError(msg)
    } finally {
      setIsLoading(false)
    }
  }, [service])

  useEffect(() => {
    loadData()
  }, [loadData, mode])

  const handleInspect = async (del: Delivery) => {
    try {
      const detailed = await service.getDeliveryById(del.id)
      setSelectedDelivery(detailed || del)
    } catch {
      setSelectedDelivery(del)
    }
    setDrawerOpen(true)
  }

  const handleOpenReplay = (del: Delivery) => {
    setDeliveryToReplay(del)
    setReplayModalOpen(true)
  }

  const allSelected =
    replayableDeliveries.length > 0 &&
    replayableDeliveries.every((d) => selectedIds.includes(d.id))
  const someSelected = replayableDeliveries.some((d) => selectedIds.includes(d.id))

  const handleToggleSelectAll = () => {
    if (allSelected) {
      setSelectedIds([])
    } else {
      setSelectedIds(replayableDeliveries.map((d) => d.id))
    }
  }

  const handleToggleSelectRow = (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    )
  }

  return (
    <div className="space-y-6 text-left">
      {/* Page Header */}
      <PageHeader
        title="Replay Management"
        description="Review exhausted dead deliveries, inspect historical diagnostics, and re-inject into the work queue."
        actions={
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
            {selectedIds.length > 0 && (
              <Button
                variant="primary"
                size="sm"
                onClick={() => setBulkReplayConfirmOpen(true)}
                leftIcon={<RotateCw className="w-3.5 h-3.5" />}
              >
                Bulk Replay ({selectedIds.length})
              </Button>
            )}
          </div>
        }
      />

      {/* Replay Protocol Explanation */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 sm:gap-4">
        <Card className="p-3.5 sm:p-4 bg-white space-y-1.5 text-xs min-w-0">
          <div className="flex items-center gap-2 font-semibold text-[#202938]">
            <span className="w-5 h-5 rounded-full bg-[#EAF0FF] flex items-center justify-center text-[#5277D9] font-bold text-2xs shrink-0">
              1
            </span>
            <span>Eligibility</span>
          </div>
          <p className="text-[#64748B]">
            Only deliveries in the terminal <strong>DEAD</strong> state can be replayed. In-flight and
            retrying deliveries are actively managed by the lease reaper and retry policy.
          </p>
        </Card>

        <Card className="p-3.5 sm:p-4 bg-white space-y-1.5 text-xs min-w-0">
          <div className="flex items-center gap-2 font-semibold text-[#202938]">
            <span className="w-5 h-5 rounded-full bg-[#EAF0FF] flex items-center justify-center text-[#5277D9] font-bold text-2xs shrink-0">
              2
            </span>
            <span>Queue Re-enqueue</span>
          </div>
          <p className="text-[#64748B]">
            Triggering a replay resets the state back to <strong>PENDING</strong>, re-queuing the row in
            PostgreSQL to be claimed by the next available dispatcher worker.
          </p>
        </Card>

        <Card className="p-3.5 sm:p-4 bg-white space-y-1.5 text-xs min-w-0">
          <div className="flex items-center gap-2 font-semibold text-[#202938]">
            <span className="w-5 h-5 rounded-full bg-[#EAF0FF] flex items-center justify-center text-[#5277D9] font-bold text-2xs shrink-0">
              3
            </span>
            <span>Ordering Semantics</span>
          </div>
          <p className="text-[#64748B]">
            Because a dead delivery released the endpoint head-of-line lock, replaying it does <u>not</u>
            preserve strict FIFO order relative to later succeeded events.
          </p>
        </Card>
      </div>

      {/* Replayable Deliveries Table */}
      <Card className="overflow-hidden min-w-0">
        <CardHeader className="bg-[#F7F6F2] border-b border-[#E7E8EC] py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-1">
          <CardTitle>Replayable Deliveries ({replayableDeliveries.length})</CardTitle>
          <span className="text-2xs text-[#64748B]">Terminal DEAD deliveries eligible for replay</span>
        </CardHeader>

        {isLoading ? (
          <TableSkeleton rows={4} cols={6} />
        ) : error && mode === 'live' ? (
          <div className="p-8 text-center text-xs text-[#E76B64] space-y-2">
            <p className="font-semibold">Backend replay API query failed.</p>
            <p className="text-[#64748B] font-mono">{error}</p>
          </div>
        ) : replayableDeliveries.length === 0 ? (
          <EmptyState
            icon={<CheckCircle2 className="w-6 h-6 text-[#159B78]" />}
            title="No Deliveries Requiring Replay"
            description="All webhook deliveries are currently healthy, pending, or successfully dispatched."
          />
        ) : (
          <div>
            {/* Bulk Selection Notification Bar */}
            {selectedIds.length > 0 && (
              <div className="bg-[#EAF0FF] border-b border-[#DCE5FA] px-4 py-2.5 flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-[#5277D9]">
                    {selectedIds.length} dead {selectedIds.length === 1 ? 'delivery' : 'deliveries'} selected for replay
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
              <table className="w-full text-left text-xs min-w-[700px]">
                <thead className="bg-[#F7F6F2] border-b border-[#E7E8EC] text-[#64748B] font-semibold">
                  <tr>
                    <th className="py-3 px-3 w-10 text-center">
                      <input
                        type="checkbox"
                        checked={allSelected}
                        ref={(input) => {
                          if (input) input.indeterminate = someSelected && !allSelected
                        }}
                        onChange={handleToggleSelectAll}
                        disabled={replayableDeliveries.length === 0}
                        title="Select all dead deliveries"
                        aria-label="Select all dead deliveries"
                        className="rounded border-[#E7E8EC] text-[#5277D9] focus:ring-[#5277D9] cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                      />
                    </th>
                    <th className="py-3 px-4">Delivery ID</th>
                    <th className="py-3 px-4">Event ID</th>
                    <th className="py-3 px-4">Destination Endpoint</th>
                    <th className="py-3 px-4">Attempts</th>
                    <th className="py-3 px-4">Last Failure Reason</th>
                    <th className="py-3 px-4 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E7E8EC]">
                  {replayableDeliveries.map((del) => {
                    const isSelected = selectedIds.includes(del.id)
                    return (
                      <tr
                        key={del.id}
                        onClick={() => handleInspect(del)}
                        className={`hover:bg-[#F7F6F2]/70 transition-colors cursor-pointer ${
                          isSelected ? 'bg-[#EAF0FF]/30' : ''
                        }`}
                      >
                        <td className="py-3 px-3 text-center" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={(e) => handleToggleSelectRow(del.id, e as unknown as React.MouseEvent)}
                            title="Select delivery for bulk replay"
                            aria-label={`Select delivery ${del.id} for replay`}
                            className="rounded border-[#E7E8EC] text-[#5277D9] focus:ring-[#5277D9] cursor-pointer"
                          />
                        </td>
                        <td className="py-3 px-4 font-mono font-semibold text-[#202938]">
                          {truncateId(del.id, 8)}
                        </td>
                        <td className="py-3 px-4 font-mono text-[#64748B]">
                          {truncateId(del.event_id, 8)}
                        </td>
                        <td className="py-3 px-4 font-mono text-[#64748B] max-w-xs truncate">
                          {del.endpoint_url || del.endpoint_id}
                        </td>
                        <td className="py-3 px-4 font-semibold text-[#E76B64]">
                          {del.attempt_count} attempts
                        </td>
                        <td className="py-3 px-4 max-w-sm">
                          <span className="font-mono text-2xs text-[#E76B64] bg-[#E76B64]/10 px-2 py-0.5 rounded truncate block border border-[#E76B64]/20">
                            {del.last_error || 'Exhausted retry budget'}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation()
                                handleInspect(del)
                              }}
                              className="text-xs text-[#5277D9] hover:text-[#4366C4]"
                            >
                              Details
                            </Button>
                            <Button
                              variant="primary"
                              size="sm"
                              leftIcon={<RotateCw className="w-3 h-3" />}
                              onClick={(e) => {
                                e.stopPropagation()
                                handleOpenReplay(del)
                              }}
                            >
                              Replay
                            </Button>
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
      </Card>

      {/* Detail Drawer */}
      <DeliveryDetailDrawer
        delivery={selectedDelivery}
        isOpen={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onReplayRequest={(del) => {
          handleOpenReplay(del)
        }}
        onReplaySuccess={(updated) => {
          setSelectedDelivery(updated)
          loadData()
        }}
        onResendSuccess={(updated) => {
          if (updated) setSelectedDelivery(updated)
          loadData()
        }}
      />

      {/* Replay Confirmation Modal */}
      <ReplayModal
        delivery={deliveryToReplay}
        isOpen={replayModalOpen}
        onClose={() => setReplayModalOpen(false)}
        onSuccess={(updated) => {
          loadData()
          if (updated && selectedDelivery && updated.id === selectedDelivery.id) {
            setSelectedDelivery(updated)
          } else if (selectedDelivery && deliveryToReplay && selectedDelivery.id === deliveryToReplay.id) {
            service
              .getDeliveryById(selectedDelivery.id)
              .then((fresh) => {
                if (fresh) setSelectedDelivery(fresh)
              })
              .catch(() => {})
          }
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
          loadData()
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
