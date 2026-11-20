import React, { useState } from 'react'
import { Modal } from './ui/Modal'
import { Button } from './ui/Button'
import { Badge } from './ui/Badge'
import { CheckCircle2, AlertTriangle, XCircle } from 'lucide-react'
import type { BulkReplayResult } from '../types'
import { truncateId } from '../utils/formatters'

interface BulkReplayResultModalProps {
  result: BulkReplayResult | null
  isOpen: boolean
  onClose: () => void
}

export const BulkReplayResultModal: React.FC<BulkReplayResultModalProps> = ({
  result,
  isOpen,
  onClose,
}) => {
  const [activeTab, setActiveTab] = useState<'all' | 'successful' | 'ineligible' | 'rejected'>('all')

  if (!isOpen || !result) return null

  const { summary, successful = [], ineligible = [], rejected = [] } = result

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Bulk Replay Results"
      description="Detailed breakdown of processed delivery replay requests."
      maxWidth="lg"
      footer={
        <div className="flex items-center justify-end w-full">
          <Button variant="primary" size="sm" onClick={onClose}>
            Done
          </Button>
        </div>
      }
    >
      <div className="space-y-4 text-left text-xs">
        {/* Summary Badges Grid */}
        <div className="grid grid-cols-4 gap-2 text-center">
          <div className="p-3 bg-[#F7F6F2] rounded-lg border border-[#E7E8EC]">
            <span className="text-2xs text-[#64748B] block font-semibold uppercase">Total</span>
            <span className="text-lg font-bold text-[#202938]">{summary.total}</span>
          </div>
          <div className="p-3 bg-[#159B78]/10 rounded-lg border border-[#159B78]/25">
            <span className="text-2xs text-[#159B78] block font-semibold uppercase">Replayed</span>
            <span className="text-lg font-bold text-[#159B78]">{summary.successfulCount}</span>
          </div>
          <div className="p-3 bg-[#E5B34B]/15 rounded-lg border border-[#E5B34B]/30">
            <span className="text-2xs text-[#B8871E] block font-semibold uppercase">Ineligible</span>
            <span className="text-lg font-bold text-[#B8871E]">{summary.ineligibleCount}</span>
          </div>
          <div className="p-3 bg-[#E76B64]/10 rounded-lg border border-[#E76B64]/25">
            <span className="text-2xs text-[#E76B64] block font-semibold uppercase">Rejected</span>
            <span className="text-lg font-bold text-[#E76B64]">{summary.rejectedCount}</span>
          </div>
        </div>

        {/* Tab Selection */}
        <div className="flex items-center gap-1 border-b border-[#E7E8EC] pb-2">
          <button
            type="button"
            onClick={() => setActiveTab('all')}
            className={`px-3 py-1 rounded-md text-xs font-semibold cursor-pointer ${
              activeTab === 'all'
                ? 'bg-[#EAF0FF] text-[#5277D9]'
                : 'text-[#64748B] hover:text-[#202938]'
            }`}
          >
            All Items ({summary.total})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('successful')}
            className={`px-3 py-1 rounded-md text-xs font-semibold cursor-pointer ${
              activeTab === 'successful'
                ? 'bg-[#159B78]/15 text-[#159B78]'
                : 'text-[#64748B] hover:text-[#202938]'
            }`}
          >
            Replayed ({summary.successfulCount})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('ineligible')}
            className={`px-3 py-1 rounded-md text-xs font-semibold cursor-pointer ${
              activeTab === 'ineligible'
                ? 'bg-[#E5B34B]/20 text-[#B8871E]'
                : 'text-[#64748B] hover:text-[#202938]'
            }`}
          >
            Ineligible ({summary.ineligibleCount})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('rejected')}
            className={`px-3 py-1 rounded-md text-xs font-semibold cursor-pointer ${
              activeTab === 'rejected'
                ? 'bg-[#E76B64]/15 text-[#E76B64]'
                : 'text-[#64748B] hover:text-[#202938]'
            }`}
          >
            Rejected ({summary.rejectedCount})
          </button>
        </div>

        {/* Content Lists */}
        <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
          {/* Successful Items */}
          {(activeTab === 'all' || activeTab === 'successful') && successful.length > 0 && (
            <div className="space-y-1.5">
              <span className="text-2xs font-bold text-[#159B78] uppercase tracking-wider flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Successfully Replayed ({successful.length})</span>
              </span>
              <div className="divide-y divide-[#E7E8EC] border border-[#E7E8EC] rounded-lg overflow-hidden bg-white">
                {successful.map((item) => (
                  <div key={item.id} className="p-2.5 flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-semibold text-[#202938]">
                        {truncateId(item.id, 10)}
                      </span>
                      <span className="text-2xs font-mono text-[#64748B] truncate max-w-xs">
                        {item.endpoint_url || item.endpointId || item.endpoint_id}
                      </span>
                    </div>
                    <Badge variant="info">Enqueued as PENDING</Badge>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Ineligible Items */}
          {(activeTab === 'all' || activeTab === 'ineligible') && ineligible.length > 0 && (
            <div className="space-y-1.5">
              <span className="text-2xs font-bold text-[#B8871E] uppercase tracking-wider flex items-center gap-1">
                <AlertTriangle className="w-3.5 h-3.5" />
                <span>Ineligible Deliveries ({ineligible.length})</span>
              </span>
              <div className="divide-y divide-[#E7E8EC] border border-[#E7E8EC] rounded-lg overflow-hidden bg-white">
                {ineligible.map((item, idx) => (
                  <div key={item.id || idx} className="p-2.5 flex items-start justify-between text-xs gap-2">
                    <div>
                      <span className="font-mono font-semibold text-[#202938] block">
                        {truncateId(item.id || item.deliveryId || '', 10)}
                      </span>
                      <span className="text-2xs text-[#64748B] mt-0.5 block">{item.reason}</span>
                    </div>
                    {item.state && <Badge variant="warning">{item.state}</Badge>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Rejected Items */}
          {(activeTab === 'all' || activeTab === 'rejected') && rejected.length > 0 && (
            <div className="space-y-1.5">
              <span className="text-2xs font-bold text-[#E76B64] uppercase tracking-wider flex items-center gap-1">
                <XCircle className="w-3.5 h-3.5" />
                <span>Rejected / Not Found ({rejected.length})</span>
              </span>
              <div className="divide-y divide-[#E7E8EC] border border-[#E7E8EC] rounded-lg overflow-hidden bg-white">
                {rejected.map((item, idx) => (
                  <div key={item.id || idx} className="p-2.5 flex items-start justify-between text-xs gap-2">
                    <div>
                      <span className="font-mono font-semibold text-[#202938] block">
                        {truncateId(item.id || item.deliveryId || '', 10)}
                      </span>
                      <span className="text-2xs text-[#E76B64] mt-0.5 block">{item.reason}</span>
                    </div>
                    <Badge variant="danger">Rejected</Badge>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}

