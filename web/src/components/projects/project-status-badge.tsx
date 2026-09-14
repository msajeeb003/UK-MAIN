import { PROJECT_STATUS_META, type ProjectStatus } from "@/lib/projects";
import { cn } from "@/lib/utils";

const STYLES: Record<ProjectStatus, string> = {
  draft: "bg-muted text-muted-foreground",
  ready: "bg-accent text-accent-foreground",
  sent: "bg-ok-soft text-ok",
  closed: "bg-warn-soft text-warn",
};

const DOTS: Record<ProjectStatus, string> = {
  draft: "bg-ink-3",
  ready: "bg-primary",
  sent: "bg-ok",
  closed: "bg-warn",
};

interface ProjectStatusBadgeProps {
  status: ProjectStatus;
  className?: string;
}

/** Status pill from the wireframe (Draft / Ready / Sent) plus Closed. */
export function ProjectStatusBadge({ status, className }: ProjectStatusBadgeProps) {
  const meta = PROJECT_STATUS_META[status];
  return (
    <span
      title={meta.hint}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap",
        STYLES[status],
        className,
      )}
    >
      <span aria-hidden className={cn("size-1.5 rounded-full", DOTS[status])} />
      {meta.label}
    </span>
  );
}
