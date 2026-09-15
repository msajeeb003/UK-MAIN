import { PROJECT_STATUS_META, type ProjectStatus } from "@/lib/projects";
import { cn } from "@/lib/utils";

/** Wireframe pill colours: Ready accent, Draft grey, Sent green; Closed amber. */
const STYLES: Record<ProjectStatus, string> = {
  draft: "bg-[#eef1f5] text-ink-2",
  ready: "bg-accent text-primary",
  sent: "bg-ok-soft text-ok",
  closed: "bg-warn-soft text-warn",
};

interface ProjectStatusBadgeProps {
  status: ProjectStatus;
  className?: string;
}

export function ProjectStatusBadge({ status, className }: ProjectStatusBadgeProps) {
  const meta = PROJECT_STATUS_META[status];
  return (
    <span
      title={meta.hint}
      className={cn("inline-block rounded-full px-2.5 py-[3px] text-xs font-medium whitespace-nowrap", STYLES[status], className)}
    >
      {meta.label}
    </span>
  );
}
