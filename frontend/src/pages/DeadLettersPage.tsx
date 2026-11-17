import React, { useState, useEffect, useCallback } from 'react'
import {
  AlertOctagon,
  RotateCw,
  Search,
  RefreshCw,
  ShieldAlert,
} from 'lucide-react'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { PageHeader } from '../components/ui/PageHeader'
import { Input } from '../components/ui/Input'
import { TableSkeleton } from '../components/ui/LoadingSkeleton'
import { EmptyState } from '../components/ui/EmptyState'
import { DeliveryDetailDrawer } from '../components/DeliveryDetailDrawer'
import { ReplayModal } from '../components/ReplayModal'
import { useApp } from '../context/AppContext'
import { formatErrorMessage } from '../api/client'
import { formatRelativeTime, truncateId } from '../utils/formatters'
import type { Delivery } from '../types'

export const DeadLettersPage: React.FC = () => {
  const { service, mode } = useApp()

  const [deadLetters, setDeadLetters] = useState<Delivery[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')

  const [selectedDelivery, setSelectedDelivery] = useState<Delivery | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)

  const [replayModalOpen, setReplayModalOpen] = useState(false)
  const [deliveryToReplay, setDeliveryToReplay] = useState<Delivery | null>(null)

  const loadDeadLetters = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const data = await service.getDeadLetters()
      setDeadLetters(data)
    } catch (err: unknown) {
      const msg = formatErrorMessage(err)
      setError(msg)
    } finally {
      setIsLoading(false)
    }
  }, [service])

  useEffect(() => {
    loadDeadLetters()
  }, [loadDeadLetters, mode])

  const handleInspect = async (del: Delivery) => {
    try {
      const full = await service.getDeliveryById(del.id)
      setSelectedDelivery(full || del)
    } catch {
      setSelectedDelivery(del)
    }
    setDrawerOpen(true)
  }

  const handleOpenReplay = (del: Delivery, e: React.MouseEvent) => {
    e.stopPropagation()
    setDeliveryToReplay(del)
    setReplayModalOpen(true)
  }

  const filtered = deadLetters.filter((del) => {
    if (!searchQuery) return true
    const q = searchQuery.toLowerCase()
    return (
      del.id.toLowerCase().includes(q) ||
      del.event_id.toLowerCase().includes(q) ||
      del.endpoint_url?.toLowerCase().includes(q) ||
      (del.last_error && del.last_error.toLowerCase().includes(q))
    )
  })

  return (
    <div className="space-y-6 text-left">
      {/* Page Header */}
      <PageHeader
        title="Dead Letter Queue (DLQ)"
        description="Deliveries that have permanently failed after exhausting exponential retry policies."
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={loadDeadLetters}
            isLoading={isLoading}
            leftIcon={<RefreshCw className="w-3.5 h-3.5" />}
          >
            Refresh
          </Button>
        }
      />

      {/* Head of line notice */}
      <div className="p-4 bg-[#E5B34B]/10 border border-[#E5B34B]/25 rounded-xl flex items-start gap-3">
        <ShieldAlert className="w-5 h-5 text-[#B8871E] shrink-0 mt-0.5" />
        <div className="text-xs text-[#202938] space-y-1">
          <p className="font-semibold text-[#B8871E]">Head-of-Line Architecture Note</p>
          <p className="text-[#64748B]">
            A delivery entering <strong>DEAD</strong> status releases that endpoint&apos;s sequence lock so
            future events can proceed. Replaying a dead delivery is supported, but will <u>not</u> preserve
            strict FIFO sequence ordering relative to newer deliveries that have already succeeded.
          </p>
        </div>
      </div>

      {/* Search Input */}
      <Card className="p-4 bg-white">
        <Input
          placeholder="Search dead letters by ID, URL, or error diagnostics..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          leftIcon={<Search className="w-4 h-4 text-[#64748B]" />}
        />
      </Card>

      {/* Dead Letters Table */}
      <Card className="overflow-hidden">
        {isLoading ? (
          <TableSkeleton rows={4} cols={6} />
        ) : error && mode === 'live' ? (
          <div className="p-8 text-center text-xs text-[#E76B64] space-y-2">
            <p className="font-semibold">Failed to load dead letters from backend.</p>
            <p className="text-[#64748B] font-mono">{error}</p>
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<AlertOctagon className="w-6 h-6 text-[#159B78]" />}
            title="Dead Letter Queue Clean"
            description={
              searchQuery
                ? 'No dead letters match your filter.'
                : 'All webhooks delivered cleanly or in active retry cycles. No dead letters currently stored.'
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#F7F6F2] border-b border-[#E7E8EC] text-[#64748B] font-semibold">
                <tr>
                  <th className="py-3 px-4">Delivery ID</th>
                  <th className="py-3 px-4">Destination Endpoint</th>
                  <th className="py-3 px-4">Diagnostic / Error</th>
                  <th className="py-3 px-4">Attempts Exhausted</th>
                  <th className="py-3 px-4">Failed At</th>
                  <th className="py-3 px-4 text-right">Replay Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E7E8EC]">
                {filtered.map((del) => (
                  <tr
                    key={del.id}
                    onClick={() => handleInspect(del)}
                    className="hover:bg-[#F7F6F2]/70 transition-colors cursor-pointer"
                  >
                    <td className="py-3 px-4">
                      <div className="flex flex-col">
                        <span className="font-mono font-semibold text-[#202938]">{truncateId(del.id, 8)}</span>
                        <span className="text-2xs font-mono text-[#64748B] mt-0.5">Seq #{del.seq}</span>
                      </div>
                    </td>

                    <td className="py-3 px-4 text-[#64748B] font-mono max-w-xs truncate">
                      {del.endpoint_url || del.endpoint_id}
                    </td>

                    <td className="py-3 px-4 max-w-md">
                      <span className="font-mono text-2xs text-[#E76B64] bg-[#E76B64]/10 px-2 py-1 rounded line-clamp-2 break-all border border-[#E76B64]/20">
                        {del.last_error || 'Delivery timeout / network error'}
                      </span>
                    </td>

                    <td className="py-3 px-4 font-semibold text-[#E76B64]">
                      {del.attempt_count} attempts
                    </td>

                    <td className="py-3 px-4 text-[#64748B]">
                      {formatRelativeTime(del.updated_at)}
                    </td>

                    <td className="py-3 px-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          variant="primary"
                          size="sm"
                          leftIcon={<RotateCw className="w-3 h-3" />}
                          onClick={(e) => handleOpenReplay(del, e)}
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

      {/* Inspection Drawer */}
      <DeliveryDetailDrawer
        delivery={selectedDelivery}
        isOpen={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onReplayRequest={(del) => {
          setDeliveryToReplay(del)
          setReplayModalOpen(true)
        }}
      />

      {/* Replay Modal */}
      <ReplayModal
        delivery={deliveryToReplay}
        isOpen={replayModalOpen}
        onClose={() => setReplayModalOpen(false)}
        onSuccess={() => {
          loadDeadLetters()
        }}
      />
    </div>
  )
}
