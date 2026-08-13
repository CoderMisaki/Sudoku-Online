import React from 'react';
import { cn } from '../../utils/cn';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  fullWidth?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', fullWidth, type = 'button', ...props }, ref) => {
    return (
      <button
        ref={ref}
        type={type}
        className={cn(
          'inline-flex items-center justify-center rounded-[16px] font-medium transition-all duration-100 ease-out active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground disabled:pointer-events-none disabled:opacity-50 select-none cursor-pointer',
          {
            'bg-foreground text-background hover:bg-foreground/90 active:bg-foreground/80': variant === 'primary',
            'bg-secondary/10 text-foreground hover:bg-secondary/20 active:bg-secondary/30': variant === 'secondary',
            'border border-border bg-background hover:bg-hover active:bg-secondary/10': variant === 'outline',
            'hover:bg-hover active:bg-secondary/10 text-foreground': variant === 'ghost',
            'h-9 px-4 text-sm': size === 'sm',
            'h-11 px-6 text-base': size === 'md',
            'h-14 px-8 text-lg': size === 'lg',
            'w-full': fullWidth,
          },
          className
        )}
        {...props}
      />
    );
  }
);

Button.displayName = 'Button';
