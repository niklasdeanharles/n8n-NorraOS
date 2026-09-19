import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import type { ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

const button = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md font-medium ' +
    'transition-[background-color,color,box-shadow,transform] duration-200 ease-norra ' +
    'active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 ' +
    '[&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        primary: 'bg-brand text-brand-fg shadow-soft hover:bg-brand-hover',
        accent: 'bg-accent text-accent-fg shadow-soft hover:brightness-110',
        secondary: 'bg-surface text-text border border-border-hair shadow-soft hover:bg-surface-muted',
        ghost: 'bg-transparent text-muted hover:bg-surface-muted hover:text-text',
        danger: 'bg-error text-white shadow-soft hover:brightness-110',
      },
      size: {
        sm: 'h-8 px-3 text-[13px]',
        md: 'h-10 px-4 text-sm',
        lg: 'h-12 px-6 text-[15px]',
        icon: 'h-9 w-9 p-0',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof button> & {
    /** Rendert das Kind statt eines <button> -- fuer Links, die wie Knoepfe aussehen. */
    asChild?: boolean;
  };

export function Button({ className, variant, size, asChild = false, ...props }: ButtonProps) {
  const Component = asChild ? Slot : 'button';
  return <Component className={cn(button({ variant, size }), className)} {...props} />;
}

export { button as buttonVariants };
