import React, { useState, useEffect, useCallback } from 'react'
import {
  Globe2,
  Plus,
  Search,
  RefreshCw,
  Power,
  ExternalLink,
} from 'lucide-react'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { CircuitBadge } from '../components/CircuitBadge'
import { TableSkeleton } from '../components/ui/LoadingSkeleton'
import { EmptyState } from '../components/ui/EmptyState'
import { CreateEndpointModal } from '../components/CreateEndpointModal'
import { useApp } from '../context/AppContext'
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
      const msg = err instanceof Error ? err.message : 'Failed to fetch endpoints'
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

  const filteredEndpoints = endpoints.filter((ep) => {
    if (stateFilter === 'ACTIVE' && !ep.active) return false
    if (stateFilter === 'INACTIVE' && ep.active) return false
    if (circuitFilter !== 'ALL' && ep.circuit_state !== circuitFilter) return false

    if (searchQuery) {
      const q = searchQuery.toLowerCase()
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
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight">Webhook Endpoints</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Registered subscriber URLs, rate limits, and circuit breaker states.
          </p>
        </div>

        <div className="flex items-center gap-2">
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
        </div>
      </div>

      {/* Filter / Search Bar */}
      <Card className="p-4 bg-white">
        <div className="flex flex-col sm:flex-row items-center gap-3">
          <div className="flex-1 w-full">
            <Input
              placeholder="Search by URL, ID, or description..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              leftIcon={<Search className="w-4 h-4 text-slate-400" />}
            />
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            {/* Active Status filter */}
            <select
              value={stateFilter}
              onChange={(e) => setStateFilter(e.target.value as 'ALL' | 'ACTIVE' | 'INACTIVE')}
              className="text-xs bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-slate-700 focus:outline-none focus:ring-1 focus:ring-slate-900"
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
              className="text-xs bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-slate-700 focus:outline-none focus:ring-1 focus:ring-slate-900"
            >
              <option value="ALL">All Circuits</option>
              <option value="CLOSED">Closed (Healthy)</option>
              <option value="HALF_OPEN">Half-Open (Probing)</option>
              <option value="OPEN">Open (Tripped)</option>
            </select>
          </div>
        </div>
      </Card>

      {/* Main Endpoints Table */}
      <Card className="overflow-hidden">
        {isLoading ? (
          <TableSkeleton rows={5} cols={6} />
        ) : error && mode === 'live' ? (
          <div className="p-8 text-center text-xs text-rose-600 space-y-2">
            <p className="font-semibold">Failed to fetch endpoints from backend API.</p>
            <p className="text-slate-500 font-mono">{error}</p>
          </div>
        ) : filteredEndpoints.length === 0 ? (
          <EmptyState
            icon={<Globe2 className="w-6 h-6 text-slate-400" />}
            title="No Endpoints Found"
            description={
              searchQuery
                ? 'No webhook endpoints matched your current search filters.'
                : 'Get started by creating your first webhook endpoint.'
            }
            action={
              <Button
                variant="primary"
                size="sm"
                onClick={() => setCreateModalOpen(true)}
                leftIcon={<Plus className="w-3.5 h-3.5" />}
              >
                Add Endpoint
              </Button>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50/70 border-b border-slate-200 text-slate-500 font-medium">
                <tr>
                  <th className="py-3 px-4">Endpoint Destination</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Circuit Breaker</th>
                  <th className="py-3 px-4">Rate Limit</th>
                  <th className="py-3 px-4">Next Sequence</th>
                  <th className="py-3 px-4">Created</th>
                  <th className="py-3 px-4 text-right">Toggle Active</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredEndpoints.map((ep) => (
                  <tr key={ep.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="py-3 px-4">
                      <div className="flex flex-col">
                        <div className="flex items-center gap-1.5 font-mono font-semibold text-slate-900 break-all">
                          <span>{ep.url}</span>
                          <a
                            href={ep.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-slate-400 hover:text-slate-600"
                          >
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        </div>
                        {ep.description && (
                          <span className="text-2xs text-slate-500 mt-0.5">{ep.description}</span>
                        )}
                        <span className="text-2xs font-mono text-slate-400 mt-0.5">
                          ID: {truncateId(ep.id, 8)}
                        </span>
                      </div>
                    </td>

                    <td className="py-3 px-4">
                      {ep.active ? (
                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-2xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                          Active
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-2xs font-medium bg-slate-100 text-slate-600 border border-slate-200">
                          <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
                          Paused
                        </span>
                      )}
                    </td>

                    <td className="py-3 px-4">
                      <CircuitBadge
                        state={ep.circuit_state}
                        consecutiveFailures={ep.consecutive_failures}
                      />
                    </td>

                    <td className="py-3 px-4 text-slate-700 font-medium">
                      {ep.rate_limit_rps} RPS
                    </td>

                    <td className="py-3 px-4 font-mono text-slate-600">
                      #{ep.next_seq ?? 1}
                    </td>

                    <td className="py-3 px-4 text-slate-500">
                      {formatDateTime(ep.created_at)}
                    </td>

                    <td className="py-3 px-4 text-right">
                      <button
                        onClick={() => handleToggle(ep)}
                        disabled={togglingId === ep.id}
                        title={ep.active ? 'Pause delivery dispatches' : 'Resume delivery dispatches'}
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-2xs font-medium border transition-colors cursor-pointer ${
                          ep.active
                            ? 'bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100'
                            : 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
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
