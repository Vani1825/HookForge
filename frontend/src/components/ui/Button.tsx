import React, { type ButtonHTMLAttributes } from 'react'
import { Loader2 } from 'lucide-react'
import { cn } from '../../utils/cn'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger'
  size?: 'sm' | 'md' | 'lg'
  isLoading?: boolean
  leftIcon?: React.ReactNode
  rightIcon?: React.ReactNode
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant = 'primary',
      size = 'md',
      isLoading = false,
      leftIcon,
      rightIcon,
      disabled,
      children,
      ...props
    },
    ref
  ) => {
    const baseStyles =
      'inline-flex items-center justify-center font-medium transition-colors rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none select-none cursor-pointer'

    const sizeStyles = {
      sm: 'text-xs px-2.5 py-1.5 gap-1.5',
      md: 'text-sm px-3.5 py-2 gap-2',
      lg: 'text-base px-4 py-2.5 gap-2.5',
    }

    const variantStyles = {
      primary:
        'bg-[#5277D9] text-white hover:bg-[#4366C4] active:bg-[#3856AD] focus-visible:ring-[#5277D9] border border-[#5277D9] shadow-xs',
      secondary:
        'bg-[#EAF0FF] text-[#5277D9] hover:bg-[#DCE5FA] focus-visible:ring-[#5277D9] border border-[#DCE5FA]',
      outline:
        'bg-white text-[#202938] hover:bg-[#F7F6F2] hover:border-[#D1D5DB] focus-visible:ring-[#5277D9] border border-[#E7E8EC] shadow-2xs',
      ghost:
        'bg-transparent text-[#64748B] hover:bg-[#F7F6F2] hover:text-[#202938] focus-visible:ring-[#5277D9]',
      danger:
        'bg-[#E76B64] text-white hover:bg-[#D9564F] active:bg-[#C94740] focus-visible:ring-[#E76B64] border border-[#E76B64] shadow-xs',
    }

    return (
      <button
        ref={ref}
        disabled={disabled || isLoading}
        className={cn(baseStyles, sizeStyles[size], variantStyles[variant], className)}
        {...props}
      >
        {isLoading && <Loader2 className="w-4 h-4 animate-spin" />}
        {!isLoading && leftIcon}
        <span>{children}</span>
        {!isLoading && rightIcon}
      </button>
    )
  }
)

Button.displayName = 'Button'
