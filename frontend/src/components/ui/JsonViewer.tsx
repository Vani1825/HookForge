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
        let cls = 'text-[#B8871E]' // number
        if (/^"/.test(match)) {
          if (/:$/.test(match)) {
            cls = 'text-[#202938] font-semibold' // key
          } else {
            cls = 'text-[#159B78]' // string
          }
        } else if (/true|false/.test(match)) {
          cls = 'text-[#5277D9] font-medium' // boolean
        } else if (/null/.test(match)) {
          cls = 'text-[#E76B64] italic' // null
        }
        return `<span class="${cls}">${match}</span>`
      }
    )

    return <pre className="font-mono text-xs leading-relaxed" dangerouslySetInnerHTML={{ __html: highlighted }} />
  }

  return (
    <div className={cn('rounded-lg border border-[#E7E8EC] bg-white overflow-hidden text-left', className)}>
      <div className="flex items-center justify-between px-3 py-2 bg-[#F7F6F2] border-b border-[#E7E8EC] text-xs">
        <span className="font-semibold text-[#202938]">{title}</span>
        <button
          onClick={handleCopy}
          type="button"
          aria-label="Copy JSON"
          className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-[#202938] bg-white border border-[#E7E8EC] rounded hover:bg-[#F7F6F2] transition-colors cursor-pointer"
        >
          {copied ? (
            <>
              <Check className="w-3.5 h-3.5 text-[#159B78]" />
              <span className="text-[#159B78]">Copied</span>
            </>
          ) : (
            <>
              <Copy className="w-3.5 h-3.5 text-[#64748B]" />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>
      <div className={cn('p-4 overflow-auto bg-[#F7F6F2]/30', maxHeight)}>
        {highlightSyntax(formattedJson)}
      </div>
    </div>
  )
}
