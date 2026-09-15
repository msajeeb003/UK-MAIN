import * as React from "react"
import { cn } from "cn"

/** Wireframe textarea: hairline border, 8px radius, 13.5px text, accent focus halo. */
function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex min-h-16 w-full resize-y rounded-lg border border-line bg-surface px-3 py-2.5 text-[13.5px] leading-normal text-ink transition-colors outline-none placeholder:text-ink-3 focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-accent disabled:cursor-not-allowed disabled:bg-panel disabled:opacity-60 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
