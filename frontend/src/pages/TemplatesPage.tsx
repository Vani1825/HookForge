import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { Modal } from '../components/ui/Modal'
import { PageHeader } from '../components/ui/PageHeader'
import { EmptyState } from '../components/ui/EmptyState'
import { TemplateDetailDrawer } from '../components/TemplateDetailDrawer'
import { TemplateFormModal } from '../components/TemplateFormModal'
import { CreateEndpointModal } from '../components/CreateEndpointModal'
import { useApp } from '../context/AppContext'
import { formatErrorMessage } from '../api/client'
import type { WebhookTemplate, Endpoint } from '../types'
import {
  Search,
  Plus,
  RefreshCw,
  BookmarkCheck,
  Edit3,
  Trash2,
  Code2,
  Zap,
  RotateCcw,
  Shield,
  AlertTriangle,
} from 'lucide-react'

export const TemplatesPage: React.FC = () => {
  const { service, mode, addToast } = useApp()
  const navigate = useNavigate()

  const [templates, setTemplates] = useState<WebhookTemplate[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState<'all' | 'system' | 'custom'>('all')

  // Modals and Drawers state
  const [selectedTemplate, setSelectedTemplate] = useState<WebhookTemplate | null>(null)
  const [detailDrawerOpen, setDetailDrawerOpen] = useState(false)

  const [formModalOpen, setFormModalOpen] = useState(false)
  const [editingTemplate, setEditingTemplate] = useState<WebhookTemplate | null>(null)

  const [deleteModalOpen, setDeleteModalOpen] = useState(false)
  const [deletingTemplate, setDeletingTemplate] = useState<WebhookTemplate | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  // Apply template into endpoint creation modal
  const [applyModalOpen, setApplyModalOpen] = useState(false)
  const [applyingTemplate, setApplyingTemplate] = useState<WebhookTemplate | null>(null)

  const loadTemplates = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const data = await service.getTemplates()
      setTemplates(data)
    } catch (err: unknown) {
      const msg = formatErrorMessage(err)
      setError(msg)
    } finally {
      setIsLoading(false)
    }
  }, [service])

  useEffect(() => {
    loadTemplates()
  }, [loadTemplates, mode])

  // Client-side filtering & search
  const filteredTemplates = useMemo(() => {
    return templates.filter((t) => {
      const isSystem = Boolean(t.is_system || t.isSystem)
      if (typeFilter === 'system' && !isSystem) return false
      if (typeFilter === 'custom' && isSystem) return false

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim()
        const matchName = t.name.toLowerCase().includes(q)
        const matchDesc = (t.description || '').toLowerCase().includes(q)
        const matchMethod = (t.http_method || t.httpMethod || '').toLowerCase().includes(q)
        if (!matchName && !matchDesc && !matchMethod) return false
      }

      return true
    })
  }, [templates, typeFilter, searchQuery])

  const systemCount = useMemo(
    () => templates.filter((t) => Boolean(t.is_system || t.isSystem)).length,
    [templates]
  )
  const customCount = useMemo(
    () => templates.filter((t) => !(t.is_system || t.isSystem)).length,
    [templates]
  )

  const handleApply = (template: WebhookTemplate) => {
    setApplyingTemplate(template)
    setApplyModalOpen(true)
  }

  const handleViewDetails = (template: WebhookTemplate) => {
    setSelectedTemplate(template)
    setDetailDrawerOpen(true)
  }

  const handleEdit = (template: WebhookTemplate) => {
    setEditingTemplate(template)
    setFormModalOpen(true)
  }

  const handleDeletePrompt = (template: WebhookTemplate) => {
    setDeletingTemplate(template)
    setDeleteModalOpen(true)
  }

  const handleConfirmDelete = async () => {
    if (!deletingTemplate) return
    setIsDeleting(true)
    try {
      await service.deleteTemplate(deletingTemplate.id)
      addToast({
        title: 'Template Deleted',
        description: `Template "${deletingTemplate.name}" has been removed.`,
        type: 'success',
      })
      setDeleteModalOpen(false)
      setDeletingTemplate(null)
      loadTemplates()
    } catch (err: unknown) {
      addToast({
        title: 'Delete Failed',
        description: formatErrorMessage(err),
        type: 'error',
      })
    } finally {
      setIsDeleting(false)
    }
  }

  const handleEndpointCreated = (endpoint: Endpoint) => {
    setApplyModalOpen(false)
    setApplyingTemplate(null)
    addToast({
      title: 'Endpoint Created',
      description: `Endpoint ${endpoint.url} created from template successfully.`,
      type: 'success',
    })
    navigate('/endpoints')
  }

  return (
    <div className="space-y-6 text-left">
      <PageHeader
        title="Webhook Templates"
        description="Reusable pre-configured endpoint templates for Slack, Stripe, Discord, and custom webhooks."
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={loadTemplates}
              isLoading={isLoading}
              leftIcon={<RefreshCw className="w-3.5 h-3.5" />}
            >
              Refresh
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                setEditingTemplate(null)
                setFormModalOpen(true)
              }}
              leftIcon={<Plus className="w-3.5 h-3.5" />}
            >
              New Template
            </Button>
          </div>
        }
      />

      {/* Search & Filter Bar */}
      <Card className="p-4 bg-white space-y-3">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
          {/* Search Box */}
          <div className="flex-1 w-full sm:max-w-md">
            <Input
              placeholder="Search templates by name, description, or method..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              leftIcon={<Search className="w-4 h-4 text-stone-400" />}
            />
          </div>

          {/* Type Filter Buttons */}
          <div className="flex items-center gap-1.5 p-1 bg-stone-100 rounded-lg w-full sm:w-auto text-xs font-medium">
            <button
              onClick={() => setTypeFilter('all')}
              className={`flex-1 sm:flex-none px-3 py-1.5 rounded-md transition-colors ${
                typeFilter === 'all'
                  ? 'bg-white text-stone-900 shadow-sm font-semibold'
                  : 'text-stone-600 hover:text-stone-900'
              }`}
            >
              All ({templates.length})
            </button>
            <button
              onClick={() => setTypeFilter('system')}
              className={`flex-1 sm:flex-none px-3 py-1.5 rounded-md transition-colors ${
                typeFilter === 'system'
                  ? 'bg-white text-stone-900 shadow-sm font-semibold'
                  : 'text-stone-600 hover:text-stone-900'
              }`}
            >
              System ({systemCount})
            </button>
            <button
              onClick={() => setTypeFilter('custom')}
              className={`flex-1 sm:flex-none px-3 py-1.5 rounded-md transition-colors ${
                typeFilter === 'custom'
                  ? 'bg-white text-stone-900 shadow-sm font-semibold'
                  : 'text-stone-600 hover:text-stone-900'
              }`}
            >
              Custom ({customCount})
            </button>
          </div>
        </div>
      </Card>

      {/* Error state */}
      {error && (
        <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700 flex items-center justify-between">
          <span>{error}</span>
          <Button variant="outline" size="sm" onClick={loadTemplates}>
            Try Again
          </Button>
        </div>
      )}

      {/* Loading Skeleton */}
      {isLoading && templates.length === 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3, 4, 5, 6].map((idx) => (
            <div
              key={idx}
              className="p-5 bg-white border border-stone-200 rounded-xl animate-pulse space-y-3"
            >
              <div className="flex items-center justify-between">
                <div className="h-5 w-16 bg-stone-200 rounded" />
                <div className="h-5 w-20 bg-stone-200 rounded" />
              </div>
              <div className="h-4 w-3/4 bg-stone-200 rounded" />
              <div className="h-10 w-full bg-stone-100 rounded" />
              <div className="pt-3 border-t border-stone-100 flex justify-between">
                <div className="h-7 w-20 bg-stone-200 rounded" />
                <div className="h-7 w-24 bg-stone-200 rounded" />
              </div>
            </div>
          ))}
        </div>
      ) : filteredTemplates.length === 0 ? (
        <Card className="p-12 text-center bg-white">
          <EmptyState
            title="No templates found"
            description={
              searchQuery
                ? `No templates matching "${searchQuery}". Try adjusting your search query.`
                : typeFilter !== 'all'
                ? `No ${typeFilter} templates available.`
                : 'Get started by creating your first custom webhook template.'
            }
            action={
              <Button
                size="sm"
                variant="primary"
                onClick={() => {
                  if (searchQuery || typeFilter !== 'all') {
                    setSearchQuery('')
                    setTypeFilter('all')
                  } else {
                    setEditingTemplate(null)
                    setFormModalOpen(true)
                  }
                }}
              >
                {searchQuery || typeFilter !== 'all' ? 'Reset Filters' : 'Create Template'}
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredTemplates.map((template) => {
            const isSystem = Boolean(template.is_system || template.isSystem)
            const method = (template.http_method || template.httpMethod || 'POST').toUpperCase()
            const headersCount = Object.keys(
              template.custom_headers || template.customHeaders || {}
            ).length

            const strategy = (
              template.retry_strategy ||
              template.retryStrategy ||
              'EXPONENTIAL'
            ).toUpperCase()
            const maxAttempts =
              template.retry_max_attempts ?? template.retryMaxAttempts ?? 8

            return (
              <Card
                key={template.id}
                className="p-5 bg-white border border-stone-200/90 hover:border-stone-400/80 transition-all shadow-xs flex flex-col justify-between"
              >
                <div className="space-y-3">
                  {/* Card Header: Method & System Tag */}
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={`px-2 py-0.5 text-[11px] font-mono font-bold rounded border ${
                        method === 'POST'
                          ? 'bg-blue-50 text-blue-700 border-blue-200'
                          : method === 'PUT'
                          ? 'bg-amber-50 text-amber-700 border-amber-200'
                          : method === 'PATCH'
                          ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
                          : 'bg-stone-100 text-stone-700 border-stone-200'
                      }`}
                    >
                      {method}
                    </span>

                    <span
                      className={`px-2 py-0.5 text-[11px] font-semibold rounded-full border flex items-center gap-1 ${
                        isSystem
                          ? 'bg-purple-50 text-purple-700 border-purple-200'
                          : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                      }`}
                    >
                      {isSystem ? (
                        <>
                          <Shield className="w-3 h-3 text-purple-600" />
                          System
                        </>
                      ) : (
                        'Custom'
                      )}
                    </span>
                  </div>

                  {/* Title & Description */}
                  <div>
                    <h3 className="text-sm font-bold text-stone-900 group-hover:text-indigo-600 transition-colors line-clamp-1">
                      {template.name}
                    </h3>
                    <p className="text-xs text-stone-500 mt-1 line-clamp-2 min-h-[2rem] leading-relaxed">
                      {template.description || 'No description provided.'}
                    </p>
                  </div>

                  {/* Config Highlights */}
                  <div className="grid grid-cols-2 gap-2 text-[11px] py-2 border-y border-stone-100 bg-stone-50/50 rounded-lg px-2.5">
                    <div className="flex items-center gap-1.5 text-stone-600">
                      <Zap className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                      <span>{template.rate_limit_rps || template.rateLimitRps || 10} RPS</span>
                    </div>

                    <div className="flex items-center gap-1.5 text-stone-600">
                      <RotateCcw className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                      <span className="truncate">
                        {strategy === 'FIXED' ? 'Fixed' : 'Exp'} ({maxAttempts}x)
                      </span>
                    </div>

                    {headersCount > 0 && (
                      <div className="flex items-center gap-1.5 text-stone-600 col-span-2">
                        <Code2 className="w-3.5 h-3.5 text-stone-400 shrink-0" />
                        <span>{headersCount} custom header{headersCount > 1 ? 's' : ''} configured</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Card Actions Footer */}
                <div className="pt-4 mt-3 flex items-center justify-between gap-2 border-t border-stone-100">
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleViewDetails(template)}
                      className="text-xs text-stone-600 hover:text-stone-900"
                    >
                      Details
                    </Button>

                    {!isSystem && (
                      <>
                        <button
                          onClick={() => handleEdit(template)}
                          className="p-1.5 text-stone-400 hover:text-stone-800 rounded transition-colors"
                          title="Edit Template"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleDeletePrompt(template)}
                          className="p-1.5 text-stone-400 hover:text-rose-600 rounded transition-colors"
                          title="Delete Template"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </>
                    )}
                  </div>

                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => handleApply(template)}
                    leftIcon={<BookmarkCheck className="w-3.5 h-3.5" />}
                  >
                    Apply
                  </Button>
                </div>
              </Card>
            )
          })}
        </div>
      )}

      {/* Template Detail Drawer */}
      <TemplateDetailDrawer
        isOpen={detailDrawerOpen}
        onClose={() => {
          setDetailDrawerOpen(false)
          setSelectedTemplate(null)
        }}
        template={selectedTemplate}
        onApply={handleApply}
        onEdit={handleEdit}
        onDelete={handleDeletePrompt}
      />

      {/* Template Create / Edit Form Modal */}
      <TemplateFormModal
        isOpen={formModalOpen}
        onClose={() => {
          setFormModalOpen(false)
          setEditingTemplate(null)
        }}
        onSuccess={() => {
          loadTemplates()
        }}
        template={editingTemplate}
      />

      {/* Delete Confirmation Modal */}
      <Modal
        isOpen={deleteModalOpen}
        onClose={() => {
          setDeleteModalOpen(false)
          setDeletingTemplate(null)
        }}
        title="Delete Webhook Template"
        description="Are you sure you want to delete this custom template?"
        maxWidth="md"
        footer={
          <div className="flex items-center justify-end gap-2 w-full">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setDeleteModalOpen(false)
                setDeletingTemplate(null)
              }}
              disabled={isDeleting}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={handleConfirmDelete}
              isLoading={isDeleting}
              leftIcon={<Trash2 className="w-3.5 h-3.5" />}
            >
              Delete Template
            </Button>
          </div>
        }
      >
        <div className="space-y-3 text-left">
          <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg flex items-start gap-2.5 text-xs text-rose-800">
            <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">This action cannot be undone.</p>
              <p className="mt-0.5">
                Deleting template <strong>{deletingTemplate?.name}</strong> will remove it
                from your saved templates. Existing endpoints created from this template
                will not be affected.
              </p>
            </div>
          </div>
        </div>
      </Modal>

      {/* Apply Template Modal (Reuses CreateEndpointModal!) */}
      <CreateEndpointModal
        isOpen={applyModalOpen}
        onClose={() => {
          setApplyModalOpen(false)
          setApplyingTemplate(null)
        }}
        onSuccess={handleEndpointCreated}
        initialTemplate={applyingTemplate}
      />
    </div>
  )
}

export default TemplatesPage

