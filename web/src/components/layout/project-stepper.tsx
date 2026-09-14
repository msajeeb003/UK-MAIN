"use client";

import { Check } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { PROJECT_STEPS, parseProjectPath, routes, stepIndex } from "@/lib/navigation";
import { cn } from "@/lib/utils";

interface ProjectStepperProps {
  projectId: string;
}

/**
 * Horizontal step navigation for a project (Setup -> ... -> Generate).
 * Purely URL-driven: the current step comes from the pathname. Completion
 * state can be layered on later from project data.
 */
export function ProjectStepper({ projectId }: ProjectStepperProps) {
  const pathname = usePathname();
  const { step } = parseProjectPath(pathname);
  const current = step ? stepIndex(step) : -1;

  return (
    <nav aria-label="Project steps" className="overflow-x-auto">
      <ol className="flex min-w-max items-center gap-1 rounded-xl border bg-card p-1.5 shadow-card">
        {PROJECT_STEPS.map((s, index) => {
          const state = index < current ? "done" : index === current ? "current" : "todo";
          return (
            <li key={s.id} className="flex items-center">
              <Link
                href={routes.projectStep(projectId, s.id)}
                aria-current={state === "current" ? "step" : undefined}
                className={cn(
                  "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors",
                  state === "current" && "bg-accent font-semibold text-accent-foreground",
                  state === "done" && "text-foreground hover:bg-muted",
                  state === "todo" && "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                <span
                  className={cn(
                    "grid size-6 shrink-0 place-items-center rounded-full border text-[11px] font-semibold",
                    state === "current" && "border-primary bg-primary text-primary-foreground",
                    state === "done" && "border-ok bg-ok-soft text-ok",
                    state === "todo" && "border-border bg-background text-muted-foreground",
                  )}
                >
                  {state === "done" ? <Check className="size-3.5" strokeWidth={3} /> : index + 1}
                </span>
                <span className="whitespace-nowrap">{s.label}</span>
              </Link>
              {index < PROJECT_STEPS.length - 1 && (
                <span aria-hidden className="mx-1 h-px w-4 bg-border" />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
