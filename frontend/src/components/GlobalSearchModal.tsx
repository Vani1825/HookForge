import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Search,
  X,
  Globe2,
  Inbox,
  Send,
  Loader2,
  ArrowRight,
  Sparkles,
} from 'lucide-react'
import { useApp } from '../context/AppContext'
import { CircuitBadge } from './CircuitBadge'
import { StatusBadge } from './StatusBadge'
import { truncateId, formatRelativeTime } from '../utils/formatters'
import type { Endpoint, WebhookEvent, Delivery } from '../types'
import { cn } from '../utils/cn'

interface GlobalSearchModalProps {
  isOpen: boolean
  onClose: () => void
}

type SearchResultItem =
  | { type: 'endpoint'; data: Endpoint }
  | { type: 'event'; data: WebhookEvent }
  | { type: 'delivery'; data: Delivery }

export const GlobalSearchModal: React.FC<GlobalSearchModalProps> = ({ isOpen, onClose }) => {
  const { service, mode } = useApp()
  const navigate = useNavigate()

  const [query, setQuery] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [endpoints, setEndpoints] = useState<Endpoint[]>([])
  const [events, setEvents] = useState<WebhookEvent[]>([])
  const [deliveries, setDeliveries] = useState<Delivery[]>([])
  const [selectedIndex, setSelectedIndex] = useState(0)

  const inputRef = useRef<HTMLInputElement>(null)

  // Focus input when opened and reset query
  useEffect(() => {
    if (isOpen) {
      setQuery('')
      setEndpoints([])
      setEvents([])
      setDeliveries([])
      setSelectedIndex(0)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [isOpen])

  // Perform search across available entities using actual APIs
  const performSearch = useCallback(
    async (searchTerm: string) => {
      const q = searchTerm.trim().toLowerCase()
      if (!q) {
        setEndpoints([])
        setEvents([])
        setDeliveries([])
        setIsLoading(false)
        return
      }

      setIsLoading(true)
      try {
        const [eps, evtsRes, delsRes] = await Promise.all([
          service.getEndpoints(),
          service.getEvents({ q, pageSize: 5 }).catch(() => ({ data: [] })),
          service.getDeliveries({ q, pageSize: 5 }).catch(() => ({ data: [] })),
        ])

        // Filter endpoints client-side by URL, description, or ID
        const matchedEndpoints = eps
          .filter(
            (ep) =>
              ep.url.toLowerCase().includes(q) ||
              (ep.description && ep.description.toLowerCase().includes(q)) ||
              ep.id.toLowerCase().includes(q)
          )
          .slice(0, 4)

        const rawEvents = Array.isArray(evtsRes) ? evtsRes : (evtsRes as { data?: WebhookEvent[] }).data || []
        const matchedEvents = rawEvents.slice(0, 4)

        const rawDeliveries = Array.isArray(delsRes) ? delsRes : (delsRes as { data?: Delivery[] }).data || []
        const matchedDeliveries = rawDeliveries.slice(0, 4)

        setEndpoints(matchedEndpoints)
        setEvents(matchedEvents)
        setDeliveries(matchedDeliveries)
        setSelectedIndex(0)
      } catch (err) {
        console.error('Global search error:', err)
      } finally {
        setIsLoading(false)
      }
    },
    [service]
  )

  // Debounced search trigger
  useEffect(() => {
    const timer = setTimeout(() => {
      if (query.trim()) {
        performSearch(query)
      } else {
        setEndpoints([])
        setEvents([])
        setDeliveries([])
        setIsLoading(false)
      }
    }, 200)

    return () => clearTimeout(timer)
  }, [query, performSearch])

  // Build flattened list of results for keyboard navigation
  const flattenedResults: SearchResultItem[] = [
    ...endpoints.map((ep) => ({ type: 'endpoint' as const, data: ep })),
    ...events.map((evt) => ({ type: 'event' as const, data: evt })),
    ...deliveries.map((del) => ({ type: 'delivery' as const, data: del })),
  ]

  const totalResults = flattenedResults.length

  const handleSelectResult = (item: SearchResultItem) => {
    onClose()
    if (item.type === 'endpoint') {
      navigate('/endpoints')
    } else if (item.type === 'event') {
      navigate('/events')
    } else if (item.type === 'delivery') {
      navigate('/deliveries')
    }
  }

  // Keyboard navigation within modal
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (totalResults > 0) {
        setSelectedIndex((prev) => (prev + 1) % totalResults)
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (totalResults > 0) {
        setSelectedIndex((prev) => (prev - 1 + totalResults) % totalResults)
      }
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (totalResults > 0 && flattenedResults[selectedIndex]) {
        handleSelectResult(flattenedResults[selectedIndex])
      }
    }
  }

  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-12 sm:pt-20 px-3 sm:px-4 bg-slate-900/40 backdrop-blur-xs animate-fade-in"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Global Search Palette"
        className="w-full max-w-xl bg-white rounded-xl shadow-2xl border border-[#E7E8EC] overflow-hidden flex flex-col max-h-[85vh] text-left"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {/* Search Input Bar */}
        <div className="flex items-center gap-2.5 px-3 sm:px-4 py-3 border-b border-[#E7E8EC] bg-white">
          <Search className="w-5 h-5 text-[#5277D9] shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search endpoints, events, deliveries..."
            className="flex-1 text-sm bg-transparent border-0 outline-none text-[#202938] placeholder-[#64748B] focus:ring-0 min-w-0"
          />

          {isLoading ? (
            <Loader2 className="w-4 h-4 text-[#5277D9] animate-spin shrink-0" />
          ) : query ? (
            <button
              onClick={() => setQuery('')}
              className="p-1 rounded text-[#64748B] hover:text-[#202938] hover:bg-[#F7F6F2] cursor-pointer"
              aria-label="Clear search input"
            >
              <X className="w-4 h-4" />
            </button>
          ) : (
            <kbd className="px-1.5 py-0.5 text-3xs font-semibold bg-[#F7F6F2] text-[#64748B] border border-[#E7E8EC] rounded shadow-2xs">
              ESC
            </kbd>
          )}
        </div>

        {/* Results Container */}
        <div className="flex-1 overflow-y-auto p-2 divide-y divide-[#E7E8EC]/60 space-y-3">
          {/* Default suggestion state when query is empty */}
          {!query.trim() && (
            <div className="p-3 sm:p-4 space-y-3 text-xs">
              <span className="text-3xs font-bold text-[#64748B] uppercase tracking-wider block">
                Quick Navigation
              </span>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {[
                  { label: 'System Overview', path: '/', icon: Sparkles },
                  { label: 'Webhook Endpoints', path: '/endpoints', icon: Globe2 },
                  { label: 'Event Explorer', path: '/events', icon: Inbox },
                  { label: 'Delivery Monitor', path: '/deliveries', icon: Send },
                ].map((item) => (
                  <button
                    key={item.path}
                    onClick={() => {
                      onClose()
                      navigate(item.path)
                    }}
                    className="flex items-center gap-2 p-2.5 rounded-lg border border-[#E7E8EC] bg-[#F7F6F2] hover:bg-[#EAF0FF] hover:border-[#DCE5FA] hover:text-[#5277D9] text-[#202938] font-medium transition-all text-left cursor-pointer"
                  >
                    <item.icon className="w-4 h-4 text-[#5277D9] shrink-0" />
                    <span>{item.label}</span>
                  </button>
                ))}
              </div>
              <p className="text-3xs text-[#64748B] pt-1">
                Type keywords to find endpoints by URL/ID, events by key, or deliveries by status.
              </p>
            </div>
          )}

          {/* Empty state when query produces 0 results */}
          {query.trim() && !isLoading && totalResults === 0 && (
            <div className="p-6 sm:p-8 text-center text-xs space-y-2">
              <div className="w-10 h-10 rounded-full bg-[#F7F6F2] border border-[#E7E8EC] flex items-center justify-center text-[#64748B] mx-auto">
                <Search className="w-5 h-5 text-[#64748B]" />
              </div>
              <p className="font-semibold text-[#202938]">No results found for &ldquo;{query}&rdquo;</p>
              <p className="text-[#64748B] text-2xs">
                No matching endpoints, events, or deliveries were found. Check your search terms or filters.
              </p>
            </div>
          )}

          {/* 1. Endpoints Section */}
          {endpoints.length > 0 && (
            <div className="pt-2 space-y-1">
              <div className="px-3 py-1 flex items-center justify-between text-3xs font-bold text-[#64748B] uppercase tracking-wider">
                <span className="flex items-center gap-1.5">
                  <Globe2 className="w-3 h-3 text-[#5277D9]" />
                  <span>Endpoints ({endpoints.length})</span>
                </span>
                <span className="hidden sm:inline">Enter &crarr;</span>
              </div>
              {endpoints.map((ep) => {
                const globalIdx = flattenedResults.findIndex(
                  (r) => r.type === 'endpoint' && r.data.id === ep.id
                )
                const isSelected = globalIdx === selectedIndex

                return (
                  <div
                    key={ep.id}
                    onClick={() => handleSelectResult({ type: 'endpoint', data: ep })}
                    onMouseEnter={() => setSelectedIndex(globalIdx)}
                    className={cn(
                      'flex items-center justify-between p-2.5 rounded-lg text-xs cursor-pointer transition-all gap-2',
                      isSelected
                        ? 'bg-[#EAF0FF] text-[#5277D9] border border-[#DCE5FA]'
                        : 'hover:bg-[#F7F6F2] text-[#202938]'
                    )}
                  >
                    <div className="flex flex-col min-w-0 pr-1 flex-1">
                      <div className="flex items-center gap-1.5 font-mono font-semibold truncate">
                        <span className="truncate">{ep.url}</span>
                      </div>
                      <div className="flex items-center gap-2 text-2xs text-[#64748B] mt-0.5">
                        {ep.description && <span className="truncate max-w-[140px] sm:max-w-xs">{ep.description}</span>}
                        <span>ID: {truncateId(ep.id, 8)}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <CircuitBadge state={ep.circuit_state} consecutiveFailures={ep.consecutive_failures} />
                      <ArrowRight className="w-3.5 h-3.5 opacity-60 hidden sm:block" />
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* 2. Events Section */}
          {events.length > 0 && (
            <div className="pt-2 space-y-1">
              <div className="px-3 py-1 flex items-center justify-between text-3xs font-bold text-[#64748B] uppercase tracking-wider">
                <span className="flex items-center gap-1.5">
                  <Inbox className="w-3 h-3 text-[#5277D9]" />
                  <span>Events ({events.length})</span>
                </span>
                <span className="hidden sm:inline">Enter &crarr;</span>
              </div>
              {events.map((evt) => {
                const globalIdx = flattenedResults.findIndex(
                  (r) => r.type === 'event' && r.data.id === evt.id
                )
                const isSelected = globalIdx === selectedIndex

                return (
                  <div
                    key={evt.id}
                    onClick={() => handleSelectResult({ type: 'event', data: evt })}
                    onMouseEnter={() => setSelectedIndex(globalIdx)}
                    className={cn(
                      'flex items-center justify-between p-2.5 rounded-lg text-xs cursor-pointer transition-all gap-2',
                      isSelected
                        ? 'bg-[#EAF0FF] text-[#5277D9] border border-[#DCE5FA]'
                        : 'hover:bg-[#F7F6F2] text-[#202938]'
                    )}
                  >
                    <div className="flex flex-col min-w-0 pr-1 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-semibold">{truncateId(evt.id, 8)}</span>
                        {evt.idempotency_key && (
                          <span className="text-2xs font-mono px-1.5 py-0.2 rounded bg-white border border-[#E7E8EC] text-[#64748B] truncate max-w-[120px]">
                            {truncateId(evt.idempotency_key, 12)}
                          </span>
                        )}
                      </div>
                      <span className="text-2xs text-[#64748B] mt-0.5">
                        Created {formatRelativeTime(evt.created_at)}
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="text-2xs text-[#64748B] hidden sm:inline">View event</span>
                      <ArrowRight className="w-3.5 h-3.5 opacity-60" />
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* 3. Deliveries Section */}
          {deliveries.length > 0 && (
            <div className="pt-2 space-y-1">
              <div className="px-3 py-1 flex items-center justify-between text-3xs font-bold text-[#64748B] uppercase tracking-wider">
                <span className="flex items-center gap-1.5">
                  <Send className="w-3 h-3 text-[#5277D9]" />
                  <span>Deliveries ({deliveries.length})</span>
                </span>
                <span className="hidden sm:inline">Enter &crarr;</span>
              </div>
              {deliveries.map((del) => {
                const globalIdx = flattenedResults.findIndex(
                  (r) => r.type === 'delivery' && r.data.id === del.id
                )
                const isSelected = globalIdx === selectedIndex

                return (
                  <div
                    key={del.id}
                    onClick={() => handleSelectResult({ type: 'delivery', data: del })}
                    onMouseEnter={() => setSelectedIndex(globalIdx)}
                    className={cn(
                      'flex items-center justify-between p-2.5 rounded-lg text-xs cursor-pointer transition-all gap-2',
                      isSelected
                        ? 'bg-[#EAF0FF] text-[#5277D9] border border-[#DCE5FA]'
                        : 'hover:bg-[#F7F6F2] text-[#202938]'
                    )}
                  >
                    <div className="flex flex-col min-w-0 pr-1 flex-1">
                      <div className="flex items-center gap-2 font-mono">
                        <span className="font-semibold">{truncateId(del.id, 8)}</span>
                        <span className="text-2xs text-[#64748B] truncate max-w-[120px] sm:max-w-[160px]">
                          {del.endpoint_url || del.endpoint_id}
                        </span>
                      </div>
                      <span className="text-2xs text-[#64748B] mt-0.5">
                        Attempt #{del.attempt_count} &bull; {formatRelativeTime(del.updated_at)}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <StatusBadge state={del.state} />
                      <ArrowRight className="w-3.5 h-3.5 opacity-60 hidden sm:block" />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Footer command legend */}
        <div className="px-3 sm:px-4 py-2 bg-[#F7F6F2] border-t border-[#E7E8EC] flex flex-wrap items-center justify-between gap-2 text-3xs text-[#64748B]">
          <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
            <span>
              <kbd className="px-1 py-0.5 bg-white border border-[#E7E8EC] rounded text-3xs font-semibold mr-1">
                &uarr;&darr;
              </kbd>
              Navigate
            </span>
            <span>
              <kbd className="px-1 py-0.5 bg-white border border-[#E7E8EC] rounded text-3xs font-semibold mr-1">
                &crarr;
              </kbd>
              Select
            </span>
            <span>
              <kbd className="px-1 py-0.5 bg-white border border-[#E7E8EC] rounded text-3xs font-semibold mr-1">
                ESC
              </kbd>
              Close
            </span>
          </div>

          <span className="hidden sm:inline text-3xs text-[#64748B]">
            Mode: <strong className="text-[#202938]">{mode === 'live' ? 'Live API' : 'Demo Fixtures'}</strong>
          </span>
        </div>
      </div>
    </div>
  )
}
