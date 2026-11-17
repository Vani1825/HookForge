import React, { useState, useEffect, useCallback } from 'react'
import {
  Globe2,
  Plus,
  Search,
  RefreshCw,
  Power,
  ExternalLink,
  X,
} from 'lucide-react'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { PageHeader } from '../components/ui/PageHeader'
import { Input } from '../components/ui/Input'
import { CircuitBadge } from '../components/CircuitBadge'
import { TableSkeleton } from '../components/ui/LoadingSkeleton'
import { EmptyState } from '../components/ui/EmptyState'
import { CreateEndpointModal } from '../components/CreateEndpointModal'
import { useApp } from '../context/AppContext'
import { formatErrorMessage } from '../api/client'
import { formatDateTime, truncateId } from '../utils/formatters'
import type { Endpoint } from '../types'

export const EndpointsPage: React.FC = () => {
  const { service, mode, addToast } = useApp()

  const [endpoints, setEndpoints] = useState<Endpoint[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [stateFilter, setStateFilter] = useState<'ALL' | 'ACTIVE' | 'INACTIVE'>('ALL')
  const [circuitFilter, setCircuitFilter] = useState<'ALL' | 'CLOSED' | 'OPEN' | 'HALF_OPEN'>('ALL')

  const [createModalOpen, setCreateModalOpen] = useState(false)
  const [togglingId, setTogglingId] = useState<string | null>(null)

  const loadEndpoints = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const data = await service.getEndpoints()
      setEndpoints(data)
    } catch (err: unknown) {
      const msg = formatErrorMessage(err)
      setError(msg)
    } finally {
      setIsLoading(false)
    }
  }, [service])

  useEffect(() => {
    loadEndpoints()
  }, [loadEndpoints, mode])

  const handleToggle = async (endpoint: Endpoint) => {
    setTogglingId(endpoint.id)
    try {
      const updated = await service.toggleEndpoint(endpoint.id, !endpoint.active)
      setEndpoints((prev) => prev.map((e) => (e.id === endpoint.id ? updated : e)))
      addToast({
        title: updated.active ? 'Endpoint Activated' : 'Endpoint Paused',
        description: `${updated.url} is now ${updated.active ? 'active' : 'inactive'}.`,
        type: 'info',
      })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to toggle endpoint'
      addToast({
        title: 'Action Failed',
        description: msg,
        type: 'error',
      })
    } finally {
      setTogglingId(null)
    }
  }

  const hasActiveFilters =
    Boolean(searchQuery.trim()) || stateFilter !== 'ALL' || circuitFilter !== 'ALL'

  const handleClearAllFilters = () => {
    setSearchQuery('')
    setStateFilter('ALL')
    setCircuitFilter('ALL')
  }

  const filteredEndpoints = endpoints.filter((ep) => {
    if (stateFilter === 'ACTIVE' && !ep.active) return false
    if (stateFilter === 'INACTIVE' && ep.active) return false
    if (circuitFilter !== 'ALL' && ep.circuit_state !== circuitFilter) return false

    if (searchQuery) {
      const q = searchQuery.toLowerCase().trim()
      return (
        ep.url.toLowerCase().includes(q) ||
        (ep.description && ep.description.toLowerCase().includes(q)) ||
        ep.id.toLowerCase().includes(q)
      )
    }
    return true
  })

  return (
    <div className="space-y-6 text-left">
      {/* Page Header */}
      <PageHeader
        title="Webhook Endpoints"
        description="Registered subscriber URLs, rate limits, and circuit breaker states."
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={loadEndpoints}
              isLoading={isLoading}
              leftIcon={<RefreshCw className="w-3.5 h-3.5" />}
            >
              Refresh
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => setCreateModalOpen(true)}
              leftIcon={<Plus className="w-3.5 h-3.5" />}
            >
              Add Endpoint
            </Button>
          </>
        }
      />

      {/* Filter / Search Bar */}
      <Card className="p-4 bg-white space-y-3">
        <div className="flex flex-col sm:flex-row items-center gap-3">
          <div className="flex-1 w-full">
            <Input
              placeholder="Search by URL, ID, or description..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              leftIcon={<Search className="w-4 h-4 text-[#64748B]" />}
            />
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            {/* Active Status filter */}
            <select
              value={stateFilter}
              onChange={(e) => setStateFilter(e.target.value as 'ALL' | 'ACTIVE' | 'INACTIVE')}
              className="text-xs bg-[#F7F6F2] border border-[#E7E8EC] rounded-lg px-3 py-2 text-[#202938] focus:outline-none focus:ring-1 focus:ring-[#5277D9] cursor-pointer"
            >
              <option value="ALL">All States</option>
              <option value="ACTIVE">Active Only</option>
              <option value="INACTIVE">Paused Only</option>
            </select>

            {/* Circuit filter */}
            <select
              value={circuitFilter}
              onChange={(e) =>
                setCircuitFilter(e.target.value as 'ALL' | 'CLOSED' | 'OPEN' | 'HALF_OPEN')
              }
              className="text-xs bg-[#F7F6F2] border border-[#E7E8EC] rounded-lg px-3 py-2 text-[#202938] focus:outline-none focus:ring-1 focus:ring-[#5277D9] cursor-pointer"
            >
              <option value="ALL">All Circuits</option>
              <option value="CLOSED">Closed (Healthy)</option>
              <option value="HALF_OPEN">Half-Open (Probing)</option>
              <option value="OPEN">Open (Tripped)</option>
            </select>
          </div>
        </div>

        {/* Active Filter Pills Bar */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-[#E7E8EC] text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[#64748B] text-2xs font-semibold uppercase tracking-wider">
              Showing {filteredEndpoints.length} of {endpoints.length} endpoints
            </span>

            {searchQuery && (
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-[#EAF0FF] text-[#5277D9] border border-[#DCE5FA] text-2xs font-medium">
                Query: <strong className="font-semibold truncate max-w-[120px]">{searchQuery}</strong>
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  aria-label="Clear query filter"
                  className="hover:text-[#4366C4] cursor-pointer"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            )}

            {stateFilter !== 'ALL' && (
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-[#EAF0FF] text-[#5277D9] border border-[#DCE5FA] text-2xs font-medium">
                State: <strong className="font-semibold">{stateFilter}</strong>
                <button
                  type="button"
                  onClick={() => setStateFilter('ALL')}
                  aria-label="Clear state filter"
                  className="hover:text-[#4366C4] cursor-pointer"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            )}

            {circuitFilter !== 'ALL' && (
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-[#EAF0FF] text-[#5277D9] border border-[#DCE5FA] text-2xs font-medium">
                Circuit: <strong className="font-semibold">{circuitFilter}</strong>
                <button
                  type="button"
                  onClick={() => setCircuitFilter('ALL')}
                  aria-label="Clear circuit filter"
                  className="hover:text-[#4366C4] cursor-pointer"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            )}
          </div>

          {hasActiveFilters && (
            <button
              type="button"
              onClick={handleClearAllFilters}
              className="text-xs text-[#E76B64] hover:text-[#D9564F] font-semibold underline cursor-pointer"
            >
              Reset filters
            </button>
          )}
        </div>
      </Card>

      {/* Main Endpoints Table */}
      <Card className="overflow-hidden">
        {isLoading ? (
          <TableSkeleton rows={5} cols={6} />
        ) : error && mode === 'live' ? (
          <div className="p-8 text-center text-xs text-[#E76B64] space-y-2">
            <p className="font-semibold">Failed to fetch endpoints from backend API.</p>
            <p className="text-[#64748B] font-mono">{error}</p>
          </div>
        ) : filteredEndpoints.length === 0 ? (
          <EmptyState
            icon={<Globe2 className="w-6 h-6 text-[#5277D9]" />}
            title={hasActiveFilters ? 'No Matching Endpoints' : 'No Endpoints Found'}
            description={
              hasActiveFilters
                ? 'No webhook endpoints matched your current search filters.'
                : 'Get started by creating your first webhook endpoint.'
            }
            action={
              hasActiveFilters ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleClearAllFilters}
                >
                  Reset Filters
                </Button>
              ) : (
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => setCreateModalOpen(true)}
                  leftIcon={<Plus className="w-3.5 h-3.5" />}
                >
                  Add Endpoint
                </Button>
              )
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#F7F6F2] border-b border-[#E7E8EC] text-[#64748B] font-semibold">
                <tr>
                  <th className="py-3 px-4 min-w-[280px]">Endpoint Destination</th>
                  <th className="py-3 px-4 w-32">Status</th>
                  <th className="py-3 px-4 w-40">Circuit Breaker</th>
                  <th className="py-3 px-4 w-28">Rate Limit</th>
                  <th className="py-3 px-4 w-28">Next Sequence</th>
                  <th className="py-3 px-4 w-36">Created</th>
                  <th className="py-3 px-4 w-32 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E7E8EC]">
                {filteredEndpoints.map((ep) => (
                  <tr key={ep.id} className="hover:bg-[#F7F6F2]/70 transition-colors">
                    <td className="py-3.5 px-4 min-w-[280px]">
                      <div className="flex flex-col space-y-0.5">
                        <div className="flex items-center gap-1.5 font-mono font-medium text-[#202938]">
                          <span className="truncate max-w-xs">{ep.url}</span>
                          <a
                            href={ep.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[#64748B] hover:text-[#5277D9] shrink-0"
                            title="Open URL in new tab"
                          >
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        </div>
                        {ep.description && (
                          <span className="text-2xs text-[#64748B] truncate max-w-xs">
                            {ep.description}
                          </span>
                        )}
                        <span className="text-3xs font-mono text-[#64748B]">
                          ID: {truncateId(ep.id, 8)}
                        </span>
                      </div>
                    </td>

                    <td className="py-3.5 px-4 w-32">
                      {ep.active ? (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-2xs font-semibold bg-[#159B78]/10 text-[#159B78] border border-[#159B78]/25">
                          <span className="w-1.5 h-1.5 rounded-full bg-[#159B78]" />
                          Active
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-2xs font-semibold bg-[#F7F6F2] text-[#64748B] border border-[#E7E8EC]">
                          <span className="w-1.5 h-1.5 rounded-full bg-[#64748B]" />
                          Paused
                        </span>
                      )}
                    </td>

                    <td className="py-3.5 px-4 w-40">
                      <CircuitBadge
                        state={ep.circuit_state}
                        consecutiveFailures={ep.consecutive_failures}
                      />
                    </td>

                    <td className="py-3.5 px-4 w-28 text-[#202938] font-semibold">
                      {ep.rate_limit_rps} RPS
                    </td>

                    <td className="py-3.5 px-4 w-28 font-mono text-[#64748B]">
                      #{ep.next_seq ?? 1}
                    </td>

                    <td className="py-3.5 px-4 w-36 text-[#64748B]">
                      {formatDateTime(ep.created_at)}
                    </td>

                    <td className="py-3.5 px-4 w-32 text-right">
                      <button
                        onClick={() => handleToggle(ep)}
                        disabled={togglingId === ep.id}
                        title={ep.active ? 'Pause delivery dispatches' : 'Resume delivery dispatches'}
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-2xs font-semibold border transition-colors cursor-pointer ${
                          ep.active
                            ? 'bg-[#E76B64]/10 text-[#E76B64] border-[#E76B64]/25 hover:bg-[#E76B64]/20'
                            : 'bg-[#159B78]/10 text-[#159B78] border-[#159B78]/25 hover:bg-[#159B78]/20'
                        }`}
                      >
                        <Power className="w-3 h-3" />
                        <span>{ep.active ? 'Pause' : 'Activate'}</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Create Modal */}
      <CreateEndpointModal
        isOpen={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        onSuccess={(newEp) => {
          setEndpoints((prev) => [newEp, ...prev])
        }}
      />
    </div>
  )
}
