/**
 * Badge — etiquetas pequenas para status, vereditos, contadores.
 *
 * Variantes especiais para casos do domínio jurídico:
 *  - `procedente` (verde)
 *  - `improcedente` (vermelho)
 *  - `parcial` (amarelo)
 *  - `pendente` (cinza)
 */
import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-[color:var(--color-ring)] focus:ring-offset-2",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-[color:var(--color-primary)] text-[color:var(--color-primary-foreground)]",
        secondary:
          "border-transparent bg-[color:var(--color-secondary)] text-[color:var(--color-secondary-foreground)]",
        destructive:
          "border-transparent bg-[color:var(--color-destructive)] text-[color:var(--color-destructive-foreground)]",
        success:
          "border-transparent bg-[color:var(--color-success)] text-[color:var(--color-success-foreground)]",
        warning:
          "border-transparent bg-[color:var(--color-warning)] text-[color:var(--color-warning-foreground)]",
        outline:
          "border-[color:var(--color-border)] text-[color:var(--color-foreground)]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
