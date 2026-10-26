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
          <label htmlFor={inputId} className="block text-xs font-medium text-slate-700">
            {label}
          </label>
        )}
        <div className="relative rounded-lg shadow-2xs">
          {leftIcon && (
            <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">
              {leftIcon}
            </div>
          )}
          <input
            id={inputId}
            ref={ref}
            className={cn(
              'block w-full rounded-lg border bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400',
              'border-slate-300 focus:border-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900',
              'disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500',
              leftIcon && 'pl-9',
              rightIcon && 'pr-9',
              error && 'border-rose-400 focus:border-rose-500 focus:ring-rose-500',
              className
            )}
            {...props}
          />
          {rightIcon && (
            <div className="absolute inset-y-0 right-0 flex items-center pr-3 text-slate-400">
              {rightIcon}
            </div>
          )}
        </div>
        {error && <p className="text-xs text-rose-600 font-medium">{error}</p>}
        {helperText && !error && <p className="text-xs text-slate-500">{helperText}</p>}
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
          <label htmlFor={selectId} className="block text-xs font-medium text-slate-700">
            {label}
          </label>
        )}
        <select
          id={selectId}
          ref={ref}
          className={cn(
            'block w-full rounded-lg border bg-white px-3 py-2 text-sm text-slate-900',
            'border-slate-300 focus:border-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900',
            'disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500',
            error && 'border-rose-400 focus:border-rose-500 focus:ring-rose-500',
            className
          )}
          {...props}
        >
          {children}
        </select>
        {error && <p className="text-xs text-rose-600 font-medium">{error}</p>}
        {helperText && !error && <p className="text-xs text-slate-500">{helperText}</p>}
      </div>
    )
  }
)

Select.displayName = 'Select'
