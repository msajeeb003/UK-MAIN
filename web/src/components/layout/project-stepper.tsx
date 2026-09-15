"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { PROJECT_STEPS, parseProjectPath, routes, stepIndex } from "@/lib/navigation";
import { cn } from "@/lib/utils";

interface ProjectStepperProps {
  projectId: string;
}

/**
 * The wireframe's stepper bar under the top bar: a full-width white band
 * with six numbered circles joined by lines. Done steps show a tick,
 * the current one is filled, later ones are outlined. URL-driven.
 */
export function ProjectStepper({ projectId }: ProjectStepperProps) {
  const pathname = usePathname();
  const { step } = parseProjectPath(pathname);
  const current = step ? stepIndex(step) : -1;

  return (
    <nav aria-label="Project steps" className="border-b border-line bg-surface px-[26px] py-5">
      <ol className="mx-auto flex max-w-[960px] items-center overflow-x-auto">
        {PROJECT_STEPS.map((s, index) => {
          const state = index < current ? "done" : index === current ? "current" : "todo";
          return (
            <li key={s.id} className="contents">
              {index > 0 && (
                <span
                  aria-hidden
                  className={cn("mx-2.5 h-[2px] min-w-4 flex-1 transition-colors", index <= current ? "bg-primary" : "bg-line")}
                />
              )}
              <Link
                href={routes.projectStep(projectId, s.id)}
                aria-current={state === "current" ? "step" : undefined}
                className="flex flex-none items-center gap-[9px] whitespace-nowrap hover:no-underline"
              >
                <span
                  className={cn(
                    "grid size-[30px] place-items-center rounded-full border-[1.5px] text-[12.5px] font-bold transition-all",
                    state === "current" && "border-primary bg-primary text-white shadow-[0_2px_8px_rgba(79,70,229,.4)]",
                    state === "done" && "border-accent bg-accent text-primary",
                    state === "todo" && "border-line bg-surface text-ink-3",
                  )}
                >
                  {state === "done" ? "✓" : index + 1}
                </span>
                <span className={cn("text-[12.5px]", state === "current" ? "font-bold text-ink" : state === "done" ? "font-medium text-ink" : "font-medium text-ink-3")}>
                  {s.label}
                </span>
              </Link>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
