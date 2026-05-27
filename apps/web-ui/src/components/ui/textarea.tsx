/**
 * Textarea — campo de texto multilinha no padrão shadcn/ui.
 */
import * as React from "react";
import { cn } from "@/lib/utils";

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>;

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        className={cn(
          "flex min-h-[80px] w-full rounded-md border border-[color:var(--color-input)] bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-[color:var(--color-muted-foreground)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--color-ring)] disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Textarea.displayName = "Textarea";

export { Textarea };
