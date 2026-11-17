import React from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from './Button'
import type { PaginationMeta } from '../../types'

export interface PaginationProps {
  pagination: PaginationMeta
  onPageChange: (newPage: number) => void
  onPageSizeChange?: (newPageSize: number) => void
  isLoading?: boolean
  itemName?: string
  pageSizeOptions?: number[]
  className?: string
}

export const Pagination: React.FC<PaginationProps> = ({
  pagination,
  onPageChange,
  onPageSizeChange,
  isLoading = false,
  itemName = 'items',
  pageSizeOptions = [10, 20, 50, 100],
  className = '',
}) => {
  const { page, pageSize, totalRecords, totalPages, hasNext, hasPrev } = pagination

  const startRecord = totalRecords === 0 ? 0 : (page - 1) * pageSize + 1
  const endRecord = Math.min(totalRecords, page * pageSize)

  // Generate page numbers to display around the current page
  const getPageNumbers = () => {
    if (totalPages <= 7) {
      return Array.from({ length: totalPages }, (_, i) => i + 1)
    }

    const pages: (number | 'ellipsis')[] = []
    pages.push(1)

    if (page > 3) {
      pages.push('ellipsis')
    }

    const start = Math.max(2, page - 1)
    const end = Math.min(totalPages - 1, page + 1)

    for (let p = start; p <= end; p++) {
      pages.push(p)
    }

    if (page < totalPages - 2) {
      pages.push('ellipsis')
    }

    pages.push(totalPages)
    return pages
  }

  const pageNumbers = getPageNumbers()

  return (
    <nav
      role="navigation"
      aria-label="Pagination Navigation"
      className={`flex flex-col sm:flex-row items-center justify-between gap-3 sm:gap-4 px-3 sm:px-4 py-3 bg-white border-t border-[#E7E8EC] select-none ${className}`}
    >
      {/* Record info & page size */}
      <div className="flex flex-wrap items-center justify-between sm:justify-start gap-2 sm:gap-3 text-xs text-[#64748B] w-full sm:w-auto">
        <span>
          Showing{' '}
          <span className="font-semibold text-[#202938]">{startRecord}</span> to{' '}
          <span className="font-semibold text-[#202938]">{endRecord}</span> of{' '}
          <span className="font-semibold text-[#202938]">{totalRecords}</span> {itemName}
        </span>

        {onPageSizeChange && (
          <div className="flex items-center gap-1.5 pl-2 border-l border-[#E7E8EC]">
            <label htmlFor="page-size-select" className="text-[#64748B]">
              Per page:
            </label>
            <select
              id="page-size-select"
              value={pageSize}
              disabled={isLoading}
              onChange={(e) => onPageSizeChange(Number(e.target.value))}
              aria-label={`Select number of ${itemName} per page`}
              className="text-xs bg-[#F7F6F2] border border-[#E7E8EC] rounded px-2 py-1 text-[#202938] focus:outline-none focus:ring-1 focus:ring-[#5277D9] disabled:opacity-50"
            >
              {pageSizeOptions.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Page navigation controls */}
      <div className="flex items-center justify-between sm:justify-end gap-1 w-full sm:w-auto">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!hasPrev || isLoading}
          onClick={() => onPageChange(page - 1)}
          aria-label="Go to previous page"
          leftIcon={<ChevronLeft className="w-3.5 h-3.5" />}
          className="px-2.5 py-1 text-xs"
        >
          Previous
        </Button>

        {/* Page pills for desktop */}
        <div className="hidden md:flex items-center gap-1 mx-1">
          {pageNumbers.map((p, idx) => {
            if (p === 'ellipsis') {
              return (
                <span key={`ellipsis-${idx}`} className="px-2 py-1 text-xs text-[#64748B] select-none">
                  ...
                </span>
              )
            }
            const isCurrent = p === page
            return (
              <button
                key={p}
                type="button"
                onClick={() => onPageChange(p)}
                disabled={isLoading}
                aria-label={`Go to page ${p}`}
                aria-current={isCurrent ? 'page' : undefined}
                className={`w-7 h-7 text-xs rounded-md font-medium transition-colors cursor-pointer flex items-center justify-center ${
                  isCurrent
                    ? 'bg-[#5277D9] text-white font-semibold shadow-2xs'
                    : 'text-[#202938] hover:bg-[#EAF0FF] hover:text-[#5277D9]'
                }`}
              >
                {p}
              </button>
            )
          })}
        </div>

        {/* Current page indicator for small screens */}
        <span className="md:hidden text-xs text-[#64748B] px-2 font-medium">
          {page} / {totalPages || 1}
        </span>

        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!hasNext || isLoading}
          onClick={() => onPageChange(page + 1)}
          aria-label="Go to next page"
          rightIcon={<ChevronRight className="w-3.5 h-3.5" />}
          className="px-2.5 py-1 text-xs"
        >
          Next
        </Button>
      </div>
    </nav>
  )
}
