"use client";

import type { ProjectState } from "@/lib/api/types";
import { miniFields, miniValue, recommendableColumns } from "@/lib/recommend";
import { projectColumns } from "@/lib/review";
import { cn } from "@/lib/utils";

interface MiniGridProps {
  project: ProjectState;
  recommendedId: string | null;
}

/**
 * The wireframe's "Terms comparison" mini table (export preview): the
 * headline terms with the recommended column tinted. A renewal's expiring
 * policy is shown first, as on the comparison.
 */
export function MiniGrid({ project, recommendedId }: MiniGridProps) {
  const expiring = projectColumns(project).filter((c) => c.expiring);
  const columns = [...expiring, ...recommendableColumns(project)];
  const fields = miniFields();
  if (!columns.length) return <p className="text-xs text-ink-3">No quotes yet — the terms table fills in once a quote is extracted.</p>;

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[11.5px]">
        <thead>
          <tr>
            <th className="border-b border-line px-2 py-[7px] text-left font-medium text-ink-3">Field</th>
            {columns.map((col) => {
              const rec = col.id === recommendedId;
              return (
                <th
                  key={col.id}
                  scope="col"
                  className={cn("border-b border-line px-2 py-[7px] text-left font-semibold whitespace-nowrap", rec ? "bg-rec text-primary" : "bg-panel text-ink")}
                >
                  {col.name}
                  {col.expiring && <span className="ml-1 font-mono text-[9px] font-normal text-ink-3 uppercase">expiring</span>}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {fields.map((f) => (
            <tr key={f.key}>
              <td className="border-b border-line-2 px-2 py-1.5 text-ink-2">{f.label}</td>
              {columns.map((col) => (
                <td key={col.id} className={cn("border-b border-line-2 px-2 py-1.5 text-ink tabular-nums", col.id === recommendedId && "bg-rec")}>
                  {miniValue(project, col, f)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
