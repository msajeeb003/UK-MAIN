import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

interface PageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  /** Right-aligned content on the title row (legend, a button). */
  actions?: ReactNode;
  className?: string;
}

/** Wireframe page title: 26px bold heading over a 13.5px muted line. */
export function PageHeader({ title, description, actions, className }: PageHeaderProps) {
  return (
    <div className={cn("flex flex-wrap items-end justify-between gap-4", className)}>
      <div className="min-w-0">
        <h1 className="mb-1.5 text-[26px] font-bold tracking-[-0.4px] text-ink">{title}</h1>
        {description && <p className="text-[13.5px] text-ink-2">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}
