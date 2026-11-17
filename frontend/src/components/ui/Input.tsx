import React, { type InputHTMLAttributes, type SelectHTMLAttributes } from 'react'
import { cn } from '../../utils/cn'

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  helperText?: string
  error?: string
  leftIcon?: React.ReactNode
  rightIcon?: React.ReactNode
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, helperText, error, leftIcon, rightIcon, id, ...props }, ref) => {
    const inputId = id || (label ? label.toLowerCase().replace(/\s+/g, '-') : undefined)

    return (
      <div className="w-full space-y-1.5 text-left">
        {label && (
          <label htmlFor={inputId} className="block text-xs font-semibold text-[#202938]">
            {label}
          </label>
        )}
        <div className="relative rounded-lg shadow-2xs">
          {leftIcon && (
            <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-[#64748B]">
              {leftIcon}
            </div>
          )}
          <input
            id={inputId}
            ref={ref}
            className={cn(
              'block w-full rounded-lg border bg-white px-3 py-2 text-sm text-[#202938] placeholder-[#94A3B8]',
              'border-[#E7E8EC] focus:border-[#5277D9] focus:outline-none focus:ring-1 focus:ring-[#5277D9]',
              'disabled:cursor-not-allowed disabled:bg-[#F7F6F2] disabled:text-[#64748B]',
              leftIcon && 'pl-9',
              rightIcon && 'pr-9',
              error && 'border-[#E76B64] focus:border-[#E76B64] focus:ring-[#E76B64]',
              className
            )}
            {...props}
          />
          {rightIcon && (
            <div className="absolute inset-y-0 right-0 flex items-center pr-3 text-[#64748B]">
              {rightIcon}
            </div>
          )}
        </div>
        {error && <p className="text-xs text-[#E76B64] font-medium">{error}</p>}
        {helperText && !error && <p className="text-xs text-[#64748B]">{helperText}</p>}
      </div>
    )
  }
)

Input.displayName = 'Input'

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string
  helperText?: string
  error?: string
}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, label, helperText, error, id, children, ...props }, ref) => {
    const selectId = id || (label ? label.toLowerCase().replace(/\s+/g, '-') : undefined)

    return (
      <div className="w-full space-y-1.5 text-left">
        {label && (
          <label htmlFor={selectId} className="block text-xs font-semibold text-[#202938]">
            {label}
          </label>
        )}
        <select
          id={selectId}
          ref={ref}
          className={cn(
            'block w-full rounded-lg border bg-white px-3 py-2 text-sm text-[#202938]',
            'border-[#E7E8EC] focus:border-[#5277D9] focus:outline-none focus:ring-1 focus:ring-[#5277D9]',
            'disabled:cursor-not-allowed disabled:bg-[#F7F6F2] disabled:text-[#64748B]',
            error && 'border-[#E76B64] focus:border-[#E76B64] focus:ring-[#E76B64]',
            className
          )}
          {...props}
        >
          {children}
        </select>
        {error && <p className="text-xs text-[#E76B64] font-medium">{error}</p>}
        {helperText && !error && <p className="text-xs text-[#64748B]">{helperText}</p>}
      </div>
    )
  }
)

Select.displayName = 'Select'
