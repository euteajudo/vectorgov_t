/**
 * Botão base no padrão shadcn/ui.
 *
 * Variantes:
 *  - `default`   — primário azul-marinho (ações principais).
 *  - `secondary` — cinza neutro (ações secundárias).
 *  - `outline`   — borda apenas (ações terciárias / cancelar).
 *  - `ghost`     — sem fundo nem borda (links de navegação).
 *  - `destructive` — vermelho (ações destrutivas).
 *  - `success`   — verde (confirmações positivas).
 *
 * Tamanhos: `sm` (h-8), `default` (h-10), `lg` (h-12), `icon` (10x10).
 *
 * `asChild` permite usar com `<Link>` do Next preservando classes.
 */
import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-ring)] disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default:
          "bg-[color:var(--color-primary)] text-[color:var(--color-primary-foreground)] hover:opacity-90",
        destructive:
          "bg-[color:var(--color-destructive)] text-[color:var(--color-destructive-foreground)] hover:opacity-90",
        success:
          "bg-[color:var(--color-success)] text-[color:var(--color-success-foreground)] hover:opacity-90",
        outline:
          "border border-[color:var(--color-border)] bg-transparent hover:bg-[color:var(--color-accent)]",
        secondary:
          "bg-[color:var(--color-secondary)] text-[color:var(--color-secondary-foreground)] hover:opacity-90",
        ghost: "hover:bg-[color:var(--color-accent)]",
        link: "text-[color:var(--color-primary)] underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-8 rounded-md px-3 text-xs",
        lg: "h-12 rounded-md px-8",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
