// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { Pagination } from '../components/ui/Pagination'
import type { PaginationMeta } from '../types'

describe('Pagination Component UI', () => {
  afterEach(() => {
    cleanup()
  })
  const basePagination: PaginationMeta = {
    page: 2,
    pageSize: 20,
    totalRecords: 95,
    totalPages: 5,
    hasNext: true,
    hasPrev: true,
  }

  it('renders record counts and current page summary correctly', () => {
    render(
      <Pagination
        pagination={basePagination}
        onPageChange={vi.fn()}
        onPageSizeChange={vi.fn()}
        itemName="deliveries"
      />
    )

    // Showing 21 to 40 of 95 deliveries
    expect(screen.getByText('21')).toBeDefined()
    expect(screen.getByText('40')).toBeDefined()
    expect(screen.getByText('95')).toBeDefined()
    expect(screen.getByText(/deliveries/)).toBeDefined()
  })

  it('disables previous button on first page', () => {
    const firstPagePagination: PaginationMeta = {
      ...basePagination,
      page: 1,
      hasPrev: false,
      hasNext: true,
    }

    render(
      <Pagination
        pagination={firstPagePagination}
        onPageChange={vi.fn()}
        itemName="deliveries"
      />
    )

    const prevButton = screen.getByRole('button', { name: /previous page/i })
    expect(prevButton.hasAttribute('disabled')).toBe(true)

    const nextButton = screen.getByRole('button', { name: /next page/i })
    expect(nextButton.hasAttribute('disabled')).toBe(false)
  })

  it('disables next button on last page', () => {
    const lastPagePagination: PaginationMeta = {
      ...basePagination,
      page: 5,
      hasPrev: true,
      hasNext: false,
    }

    render(
      <Pagination
        pagination={lastPagePagination}
        onPageChange={vi.fn()}
        itemName="deliveries"
      />
    )

    const prevButton = screen.getByRole('button', { name: /previous page/i })
    expect(prevButton.hasAttribute('disabled')).toBe(false)

    const nextButton = screen.getByRole('button', { name: /next page/i })
    expect(nextButton.hasAttribute('disabled')).toBe(true)
  })

  it('triggers onPageChange when clicking next and previous buttons', () => {
    const onPageChange = vi.fn()

    render(
      <Pagination
        pagination={basePagination}
        onPageChange={onPageChange}
        itemName="deliveries"
      />
    )

    const prevButton = screen.getByRole('button', { name: /previous page/i })
    fireEvent.click(prevButton)
    expect(onPageChange).toHaveBeenCalledWith(1)

    const nextButton = screen.getByRole('button', { name: /next page/i })
    fireEvent.click(nextButton)
    expect(onPageChange).toHaveBeenCalledWith(3)
  })

  it('triggers onPageChange when clicking specific page number pill', () => {
    const onPageChange = vi.fn()

    render(
      <Pagination
        pagination={basePagination}
        onPageChange={onPageChange}
        itemName="deliveries"
      />
    )

    const page3Button = screen.getByRole('button', { name: /go to page 3/i })
    fireEvent.click(page3Button)
    expect(onPageChange).toHaveBeenCalledWith(3)
  })

  it('triggers onPageSizeChange when selecting a different page size', () => {
    const onPageSizeChange = vi.fn()

    render(
      <Pagination
        pagination={basePagination}
        onPageChange={vi.fn()}
        onPageSizeChange={onPageSizeChange}
        itemName="deliveries"
      />
    )

    const select = screen.getByRole('combobox', { name: /select number of deliveries per page/i })
    fireEvent.change(select, { target: { value: '50' } })
    expect(onPageSizeChange).toHaveBeenCalledWith(50)
  })

  it('disables controls when isLoading is true', () => {
    render(
      <Pagination
        pagination={basePagination}
        onPageChange={vi.fn()}
        onPageSizeChange={vi.fn()}
        isLoading={true}
        itemName="deliveries"
      />
    )

    const prevButton = screen.getByRole('button', { name: /previous page/i })
    const nextButton = screen.getByRole('button', { name: /next page/i })
    expect(prevButton.hasAttribute('disabled')).toBe(true)
    expect(nextButton.hasAttribute('disabled')).toBe(true)
  })
})
