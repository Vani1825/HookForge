import React, { useState, useEffect, useCallback } from 'react'
import {
  RotateCw,
  RefreshCw,
  CheckCircle2,
} from 'lucide-react'
import { Card, CardHeader, CardTitle } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { TableSkeleton } from '../components/ui/LoadingSkeleton'
import { EmptyState } from '../components/ui/EmptyState'
import { ReplayModal } from '../components/ReplayModal'
import { DeliveryDetailDrawer } from '../components/DeliveryDetailDrawer'
import { useApp } from '../context/AppContext'
import { truncateId } from '../utils/formatters'
import type { Delivery } from '../types'

export const ReplayPage: React.FC = () => {
  const { service, mode } = useApp()

  const [replayableDeliveries, setReplayableDeliveries] = useState<Delivery[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [selectedDelivery, setSelectedDelivery] = useState<Delivery | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)

  const [deliveryToReplay, setDeliveryToReplay] = useState<Delivery | null>(null)
  const [replayModalOpen, setReplayModalOpen] = useState(false)

  const loadData = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const data = await service.getDeadLetters()
      setReplayableDeliveries(data)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to fetch replay queue'
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

  return (
    <div className="space-y-6 text-left">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight">Replay Management</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Review exhausted dead deliveries, inspect historical diagnostics, and re-inject into the work queue.
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
        </div>
      </div>

      {/* Replay Protocol Explanation */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="p-4 bg-white space-y-1 text-xs">
          <div className="flex items-center gap-2 font-semibold text-slate-800">
            <span className="w-5 h-5 rounded-full bg-slate-100 flex items-center justify-center text-slate-700 text-2xs">
              1
            </span>
            <span>Eligibility</span>
          </div>
          <p className="text-slate-500">
            Only deliveries in the terminal <strong>DEAD</strong> state can be replayed. In-flight and
            retrying deliveries are actively managed by the lease reaper and retry policy.
          </p>
        </Card>

        <Card className="p-4 bg-white space-y-1 text-xs">
          <div className="flex items-center gap-2 font-semibold text-slate-800">
            <span className="w-5 h-5 rounded-full bg-slate-100 flex items-center justify-center text-slate-700 text-2xs">
              2
            </span>
            <span>Queue Re-enqueue</span>
          </div>
          <p className="text-slate-500">
            Triggering a replay resets the state back to <strong>PENDING</strong>, re-queuing the row in
            PostgreSQL to be claimed by the next available dispatcher worker.
          </p>
        </Card>

        <Card className="p-4 bg-white space-y-1 text-xs">
          <div className="flex items-center gap-2 font-semibold text-slate-800">
            <span className="w-5 h-5 rounded-full bg-slate-100 flex items-center justify-center text-slate-700 text-2xs">
              3
            </span>
            <span>Ordering Semantics</span>
          </div>
          <p className="text-slate-500">
            Because a dead delivery released the endpoint head-of-line lock, replaying it does <u>not</u>
            preserve strict FIFO order relative to later succeeded events.
          </p>
        </Card>
      </div>

      {/* Replayable Deliveries Table */}
      <Card className="overflow-hidden">
        <CardHeader className="bg-slate-50/50 border-b border-slate-100 py-3 flex flex-row items-center justify-between">
          <CardTitle>Replayable Deliveries ({replayableDeliveries.length})</CardTitle>
          <span className="text-2xs text-slate-400">Terminal DEAD deliveries eligible for replay</span>
        </CardHeader>

        {isLoading ? (
          <TableSkeleton rows={4} cols={6} />
        ) : error && mode === 'live' ? (
          <div className="p-8 text-center text-xs text-rose-600 space-y-2">
            <p className="font-semibold">Backend replay API query failed.</p>
            <p className="text-slate-500 font-mono">{error}</p>
          </div>
        ) : replayableDeliveries.length === 0 ? (
          <EmptyState
            icon={<CheckCircle2 className="w-6 h-6 text-emerald-500" />}
            title="No Deliveries Requiring Replay"
            description="All webhook deliveries are currently healthy, pending, or successfully dispatched."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50/70 border-b border-slate-200 text-slate-500 font-medium">
                <tr>
                  <th className="py-3 px-4">Delivery ID</th>
                  <th className="py-3 px-4">Event ID</th>
                  <th className="py-3 px-4">Destination Endpoint</th>
                  <th className="py-3 px-4">Attempts</th>
                  <th className="py-3 px-4">Last Failure Reason</th>
                  <th className="py-3 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {replayableDeliveries.map((del) => (
                  <tr key={del.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="py-3 px-4 font-mono font-medium text-slate-800">
                      {truncateId(del.id, 8)}
                    </td>
                    <td className="py-3 px-4 font-mono text-slate-600">
                      {truncateId(del.event_id, 8)}
                    </td>
                    <td className="py-3 px-4 font-mono text-slate-600 max-w-xs truncate">
                      {del.endpoint_url || del.endpoint_id}
                    </td>
                    <td className="py-3 px-4 font-semibold text-rose-700">
                      {del.attempt_count} attempts
                    </td>
                    <td className="py-3 px-4 max-w-sm">
                      <span className="font-mono text-2xs text-rose-700 bg-rose-50 px-2 py-0.5 rounded truncate block border border-rose-100">
                        {del.last_error || 'Exhausted retry budget'}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleInspect(del)}
                          className="text-xs"
                        >
                          Details
                        </Button>
                        <Button
                          variant="danger"
                          size="sm"
                          leftIcon={<RotateCw className="w-3 h-3" />}
                          onClick={() => handleOpenReplay(del)}
                        >
                          Replay
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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
      />

      {/* Replay Confirmation Modal */}
      <ReplayModal
        delivery={deliveryToReplay}
        isOpen={replayModalOpen}
        onClose={() => setReplayModalOpen(false)}
        onSuccess={() => {
          loadData()
        }}
      />
    </div>
  )
}
