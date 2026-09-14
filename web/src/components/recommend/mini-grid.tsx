"use client";

import { Star } from "lucide-react";

import type { ProjectState } from "@/lib/api/types";
import { miniFields, miniValue, recommendableColumns } from "@/lib/recommend";
import { projectColumns } from "@/lib/review";
import { cn } from "@/lib/utils";

interface MiniGridProps {
  project: ProjectState;
  recommendedId: string | null;
}

/**
 * Read-only preview of the headline terms with the recommended column
 * filled, so the broker sees what the client will see on the slide. The
 * expiring policy (renewals) is shown first, as on the comparison.
 */
export function MiniGrid({ project, recommendedId }: MiniGridProps) {
  const expiring = projectColumns(project).filter((c) => c.expiring);
  const columns = [...expiring, ...recommendableColumns(project)];
  const fields = miniFields();
  if (!columns.length) return null;

  return (
    <div className="overflow-hidden rounded-xl border bg-card shadow-card">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[13px]" style={{ minWidth: 180 + columns.length * 140 }}>
          <thead>
            <tr>
              <th className="label-mono min-w-[180px] border-b bg-panel px-4 py-2.5 text-left">Preview</th>
              {columns.map((col) => {
                const rec = col.id === recommendedId;
                return (
                  <th
                    key={col.id}
                    scope="col"
                    aria-current={rec ? "true" : undefined}
                    className={cn("min-w-[140px] border-b border-l border-line-2 px-3 py-2.5 text-left", rec ? "bg-rec text-primary" : "bg-panel")}
                  >
                    <span className="flex items-center gap-1.5 font-semibold">
                      {rec && <Star className="size-3.5 fill-primary text-primary" aria-label="Recommended" />}
                      <span className="truncate">{col.name}</span>
                    </span>
                    {col.expiring && <span className="label-mono block text-[9px] text-ink-3">expiring</span>}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {fields.map((f) => (
              <tr key={f.key}>
                <th scope="row" className="border-b border-line-2 px-4 py-2 text-left font-medium">
                  {f.label}
                </th>
                {columns.map((col) => (
                  <td
                    key={col.id}
                    className={cn("border-b border-l border-line-2 px-3 py-2 tabular-nums", col.id === recommendedId && "bg-rec font-medium")}
                  >
                    {miniValue(project, col, f)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
