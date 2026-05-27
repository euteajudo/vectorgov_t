/**
 * Progress — barra de progresso simples (sem dependência Radix para evitar
 * mais um peer).
 *
 * `value` é percentual 0..100.
 */
"use client";
import * as React from "react";
import { cn } from "@/lib/utils";

interface ProgressProps extends React.HTMLAttributes<HTMLDivElement> {
  value?: number;
}

const Progress = React.forwardRef<HTMLDivElement, ProgressProps>(
  ({ className, value = 0, ...props }, ref) => {
    const pct = Math.max(0, Math.min(100, value));
    return (
      <div
        ref={ref}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        className={cn(
          "relative h-2 w-full overflow-hidden rounded-full bg-[color:var(--color-secondary)]",
          className,
        )}
        {...props}
      >
        <div
          className="h-full bg-[color:var(--color-primary)] transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
    );
  },
);
Progress.displayName = "Progress";

export { Progress };
