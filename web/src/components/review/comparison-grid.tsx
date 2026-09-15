"use client";

import { useState } from "react";

import { GridCell, cellDomId } from "@/components/review/grid-cell";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Insurer, ProjectState } from "@/lib/api/types";
import { FIELDS, type FieldDef } from "@/lib/fields";
import { debtOptions, displayColumns } from "@/lib/review";
import type { ProjectColumn } from "@/lib/uploads";
import { cn } from "@/lib/utils";

export interface ComparisonGridProps {
  project: ProjectState;
  insurers: Insurer[];
  onCell: (colId: string, field: FieldDef, value: string) => void;
  onRename: (colId: string, name: string) => void;
  onRemove: (colId: string) => void;
  /** "Set rec" / "★ REC" in a column header. */
  onPickRecommended: (colId: string | null) => void;
  /** Page chip: open the source at that page, expanded. */
  onOpenSource: (col: ProjectColumn, field: FieldDef, page: number) => void;
  /** Cell focused: follow the value in the source panel. */
  onSelectCell: (col: ProjectColumn, field: FieldDef, page: number | null) => void;
}

function HeaderName({ col, rec, onRename }: { col: ProjectColumn; rec: boolean; onRename: (name: string) => void }) {
  const [text, setText] = useState(col.name);
  const commit = () => {
    const name = text.trim() || col.name;
    setText(name);
    if (name !== col.name) onRename(name);
  };
  return (
    <input
      aria-label={`Insurer name for column ${col.name}`}
      title={col.fileName ? `From ${col.fileName}` : undefined}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      className={cn(
        "w-full min-w-0 rounded-[5px] bg-transparent px-0 py-0.5 text-sm font-semibold outline-none focus:bg-white focus:px-[5px] focus:ring-2 focus:ring-primary",
        rec ? "text-primary" : "text-ink",
      )}
    />
  );
}

/** Focus the same field in the next/previous row (Enter / Shift+Enter). */
function moveFocus(colId: string, fieldKey: string, direction: 1 | -1) {
  const index = FIELDS.findIndex((f) => f.key === fieldKey);
  for (let i = index + direction; i >= 0 && i < FIELDS.length; i += direction) {
    const el = document.getElementById(cellDomId(colId, FIELDS[i].key)) as HTMLElement | null;
    if (el) {
      el.focus();
      if (el instanceof HTMLInputElement) el.select();
      return;
    }
  }
}

/**
 * The wireframe's comparison grid: the standard term rows × one column
 * per quote (BRD 2.3 / 2.5). Columns follow the order ticked at setup; a
 * ticked insurer without a quote shows a greyed "Declined" column; a
 * renewal's expiring policy comes first. Header row and the Field column
 * stay pinned; wide comparisons scroll horizontally inside the card.
 */
export function ComparisonGrid({ project, insurers, onCell, onRename, onRemove, onPickRecommended, onOpenSource, onSelectCell }: ComparisonGridProps) {
  const display = displayColumns(project, insurers);
  const debtWordings = debtOptions(insurers);
  const [removing, setRemoving] = useState<ProjectColumn | null>(null);

  return (
    <div className="overflow-hidden rounded-[14px] border border-line bg-surface shadow-card">
      <div className="max-h-[70vh] overflow-auto">
        <table className="w-full border-collapse" style={{ minWidth: 200 + display.length * 150 }}>
          <thead className="sticky top-0 z-20">
            <tr>
              <th className="label-mono sticky left-0 z-30 min-w-[200px] border-b border-line bg-panel px-4 py-[13px] text-left font-normal">
                Field
              </th>
              {display.map((d) => {
                if (d.kind === "declined") {
                  return (
                    <th
                      key={`declined-${d.insurerId}`}
                      scope="col"
                      className="min-w-[150px] border-b border-l border-line border-l-line-2 bg-muted/60 px-3.5 py-[11px] text-left align-top"
                    >
                      <div className="truncate text-sm font-semibold text-ink-2">{d.name}</div>
                      <span className="mt-[5px] inline-block rounded bg-muted px-1.5 py-0.5 font-mono text-[9px] font-medium text-ink-2 uppercase">Declined</span>
                    </th>
                  );
                }
                const { col } = d;
                const rec = col.id === project.recommended;
                return (
                  <th
                    key={col.id}
                    scope="col"
                    className={cn("min-w-[150px] border-b border-l border-line border-l-line-2 px-3.5 py-[11px] text-left align-top", rec ? "bg-rec" : "bg-panel")}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <HeaderName col={col} rec={rec} onRename={(name) => onRename(col.id, name)} />
                      <div className="flex shrink-0 items-center gap-1.5">
                        <button
                          type="button"
                          aria-label={`Remove column ${col.name}`}
                          title={col.manual ? "Remove column" : "Remove this column and its uploaded file"}
                          onClick={() => setRemoving(col)}
                          className="text-[15px] leading-none text-ink-3 hover:text-warn"
                        >
                          ×
                        </button>
                        {!col.expiring && (
                          <button
                            type="button"
                            aria-pressed={rec}
                            title={rec ? "Recommended insurer (click to clear)" : "Set as the recommended insurer"}
                            onClick={() => onPickRecommended(rec ? null : col.id)}
                            className={cn(
                              "rounded-[5px] border px-[7px] py-[3px] font-mono text-[10px] font-medium",
                              rec ? "border-primary bg-primary text-white" : "border-line bg-white text-ink-3 hover:text-ink-2",
                            )}
                          >
                            {rec ? "★ REC" : "Set rec"}
                          </button>
                        )}
                      </div>
                    </div>
                    {(col.manual || col.expiring) && (
                      <span
                        className={cn(
                          "mt-[5px] inline-block rounded px-1.5 py-0.5 font-mono text-[9px] font-medium uppercase",
                          col.manual ? "bg-warn-soft text-warn" : "bg-muted text-ink-2",
                        )}
                      >
                        {col.manual ? "Free format" : "Expiring policy"}
                      </span>
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {FIELDS.map((f) => (
              <tr key={f.key} className="group hover:bg-panel">
                <th scope="row" className="sticky left-0 z-10 border-b border-line-2 bg-surface px-4 py-[11px] text-left align-top group-hover:bg-panel">
                  <div className="flex items-center gap-[7px]">
                    <span className="text-[13px] font-medium text-ink">{f.label}</span>
                    {f.tag && <span className="rounded bg-set-soft px-1.5 py-0.5 font-mono text-[9px] font-medium text-set">{f.tag}</span>}
                  </div>
                  {f.note && <div className="mt-0.5 text-[11px] text-ink-3">{f.note}</div>}
                </th>
                {display.map((d) =>
                  d.kind === "declined" ? (
                    <td
                      key={`declined-${d.insurerId}-${f.key}`}
                      className="border-b border-l border-line-2 bg-muted/40 px-3 py-2 text-center text-xs text-ink-3"
                      aria-label={`${f.label}: ${d.name} declined to quote`}
                    >
                      —
                    </td>
                  ) : (
                    <GridCell
                      key={d.col.id}
                      project={project}
                      col={d.col}
                      field={f}
                      recommended={d.col.id === project.recommended}
                      onChange={(v) => onCell(d.col.id, f, v)}
                      onOpenSource={(page) => onOpenSource(d.col, f, page)}
                      onSelect={(page) => onSelectCell(d.col, f, page)}
                      onMove={(dir) => moveFocus(d.col.id, f.key, dir)}
                      debtOptions={debtWordings}
                    />
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Dialog open={Boolean(removing)} onOpenChange={(open) => !open && setRemoving(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove {removing?.name}?</DialogTitle>
            <DialogDescription>
              {removing?.manual
                ? "The free-format column and anything typed into it will be removed."
                : "The column, its credit-limit offers and its upload card will be removed. The document stays retained on the server; re-upload it to restore the column."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Keep it</DialogClose>
            <Button
              variant="destructive"
              onClick={() => {
                if (removing) onRemove(removing.id);
                setRemoving(null);
              }}
            >
              Remove column
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
