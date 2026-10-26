import React, { useState } from 'react'
import { Copy, Check } from 'lucide-react'
import { copyToClipboard } from '../../utils/formatters'
import { cn } from '../../utils/cn'

interface JsonViewerProps {
  data: unknown
  className?: string
  maxHeight?: string
  title?: string
}

export const JsonViewer: React.FC<JsonViewerProps> = ({
  data,
  className,
  maxHeight = 'max-h-96',
  title = 'Payload JSON',
}) => {
  const [copied, setCopied] = useState(false)

  let formattedJson = ''
  try {
    if (typeof data === 'string') {
      try {
        const parsed = JSON.parse(data)
        formattedJson = JSON.stringify(parsed, null, 2)
      } catch {
        formattedJson = data
      }
    } else {
      formattedJson = JSON.stringify(data, null, 2)
    }
  } catch {
    formattedJson = String(data)
  }

  const handleCopy = async () => {
    const success = await copyToClipboard(formattedJson)
    if (success) {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  // Syntax highlighting helper
  const highlightSyntax = (jsonStr: string) => {
    if (!jsonStr) return null

    // Simple robust tokenizer for JSON syntax highlighting
    const htmlSafe = jsonStr
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')

    const highlighted = htmlSafe.replace(
      /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)/g,
      (match) => {
        let cls = 'text-amber-700' // number
        if (/^"/.test(match)) {
          if (/:$/.test(match)) {
            cls = 'text-slate-800 font-semibold' // key
          } else {
            cls = 'text-emerald-700' // string
          }
        } else if (/true|false/.test(match)) {
          cls = 'text-purple-700 font-medium' // boolean
        } else if (/null/.test(match)) {
          cls = 'text-rose-600 italic' // null
        }
        return `<span class="${cls}">${match}</span>`
      }
    )

    return <pre className="font-mono text-xs leading-relaxed" dangerouslySetInnerHTML={{ __html: highlighted }} />
  }

  return (
    <div className={cn('rounded-lg border border-slate-200 bg-slate-900/2 overflow-hidden text-left', className)}>
      <div className="flex items-center justify-between px-3 py-2 bg-slate-100/70 border-b border-slate-200 text-xs">
        <span className="font-medium text-slate-700">{title}</span>
        <button
          onClick={handleCopy}
          type="button"
          aria-label="Copy JSON"
          className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-slate-600 bg-white border border-slate-200 rounded hover:bg-slate-50 hover:text-slate-900 transition-colors cursor-pointer"
        >
          {copied ? (
            <>
              <Check className="w-3.5 h-3.5 text-emerald-600" />
              <span className="text-emerald-700">Copied</span>
            </>
          ) : (
            <>
              <Copy className="w-3.5 h-3.5" />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>
      <div className={cn('p-4 overflow-auto bg-slate-50/50', maxHeight)}>
        {highlightSyntax(formattedJson)}
      </div>
    </div>
  )
}
