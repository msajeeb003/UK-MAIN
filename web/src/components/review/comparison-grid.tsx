"use client";

import { Check, Star, X } from "lucide-react";
import { useState } from "react";

import { GridCell, cellDomId } from "@/components/review/grid-cell";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { Insurer, ProjectState } from "@/lib/api/types";
import { FIELDS, type ConfirmKey, type FieldDef } from "@/lib/fields";
import { confirmedFlags, displayColumns } from "@/lib/review";
import type { ProjectColumn } from "@/lib/uploads";
import { cn } from "@/lib/utils";

export interface ComparisonGridProps {
  project: ProjectState;
  insurers: Insurer[];
  onCell: (colId: string, field: FieldDef, value: string) => void;
  onRename: (colId: string, name: string) => void;
  onRemove: (colId: string) => void;
  onToggleConfirm: (key: ConfirmKey) => void;
  /** Page chip: open the source at that page, expanded. */
  onOpenSource: (col: ProjectColumn, field: FieldDef, page: number) => void;
  /** Cell focused: follow the value in the source panel. */
  onSelectCell: (col: ProjectColumn, field: FieldDef, page: number | null) => void;
}

function HeaderName({ col, onRename }: { col: ProjectColumn; onRename: (name: string) => void }) {
  const [text, setText] = useState(col.name);
  const commit = () => {
    const name = text.trim() || col.name;
    setText(name);
    if (name !== col.name) onRename(name);
  };
  return (
    <input
      aria-label={`Insurer name for column ${col.name}`}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      className="w-full min-w-0 rounded bg-transparent px-1 py-0.5 text-sm font-semibold outline-none focus:bg-card focus:ring-2 focus:ring-primary"
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
 * The 16 standard term rows × one column per insurer (BRD 2.3 / 2.5).
 * Columns follow the order ticked at setup; a ticked insurer without a
 * quote shows a greyed "Declined" column; a renewal's expiring policy comes
 * first. Header row and first column stay pinned; six or more columns
 * scroll horizontally inside the card.
 */
export function ComparisonGrid({ project, insurers, onCell, onRename, onRemove, onToggleConfirm, onOpenSource, onSelectCell }: ComparisonGridProps) {
  const display = displayColumns(project, insurers);
  const flags = confirmedFlags(project);
  const [removing, setRemoving] = useState<ProjectColumn | null>(null);

  return (
    <div className="overflow-hidden rounded-xl border bg-card shadow-card">
      <div className="max-h-[70vh] overflow-auto">
        <table className="w-full border-collapse text-sm" style={{ minWidth: 200 + display.length * 170 }}>
          <thead className="sticky top-0 z-20">
            <tr>
              <th className="label-mono sticky left-0 z-30 min-w-[200px] border-b bg-panel px-4 py-3 text-left">
                Term
              </th>
              {display.map((d) => {
                if (d.kind === "declined") {
                  return (
                    <th
                      key={`declined-${d.insurerId}`}
                      scope="col"
                      className="min-w-[170px] border-b border-l border-line-2 bg-muted/60 px-3 py-2 text-left align-top text-muted-foreground"
                    >
                      <div className="truncate text-sm font-semibold">{d.name}</div>
                      <span className="label-mono mt-1 inline-block rounded bg-muted px-1.5 text-[9px]">Declined</span>
                    </th>
                  );
                }
                const { col } = d;
                const rec = col.id === project.recommended;
                return (
                  <th
                    key={col.id}
                    scope="col"
                    className={cn("min-w-[170px] border-b border-l border-line-2 px-3 py-2 text-left align-top", rec ? "bg-rec" : "bg-panel")}
                  >
                    <div className="flex items-center gap-1">
                      {rec && <Star className="size-3.5 shrink-0 fill-primary text-primary" aria-label="Recommended" />}
                      <HeaderName col={col} onRename={(name) => onRename(col.id, name)} />
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label={`Remove column ${col.name}`}
                        title={col.manual ? "Remove column" : "Remove this column and its uploaded file"}
                        onClick={() => setRemoving(col)}
                      >
                        <X />
                      </Button>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      {col.manual && <span className="label-mono rounded bg-warn-soft px-1.5 text-[9px] text-warn">Free format</span>}
                      {col.expiring && <span className="label-mono rounded bg-muted px-1.5 text-[9px] text-ink-2">Expiring policy</span>}
                      {col.fileName && (
                        <span className="truncate font-mono text-[10px] text-ink-3" title={col.fileName}>
                          {col.fileName}
                        </span>
                      )}
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {FIELDS.map((f) => {
              const key = f.confirm;
              const confirmed = key ? flags[key] : null;
              return (
                <tr key={f.key} className="group">
                  <th
                    scope="row"
                    className={cn(
                      "sticky left-0 z-10 border-b border-line-2 px-4 py-2 text-left align-top",
                      confirmed === true ? "bg-ok-soft" : confirmed === false ? "bg-warn-soft" : "bg-card",
                    )}
                  >
                    <div className="flex items-center gap-2">
                      {key ? (
                        <button
                          type="button"
                          role="checkbox"
                          aria-checked={confirmed === true}
                          onClick={() => onToggleConfirm(key)}
                          title={confirmed ? "Confirmed. Click to un-confirm" : "Key value: click to confirm it for export"}
                          className={cn(
                            "grid size-4 shrink-0 place-items-center rounded border",
                            confirmed ? "border-ok bg-ok text-white" : "border-warn bg-card text-warn",
                          )}
                        >
                          {confirmed && <Check className="size-3" strokeWidth={3} />}
                        </button>
                      ) : null}
                      <span className="text-[13px] font-medium">{f.label}</span>
                      {f.tag && <span className="label-mono rounded bg-set-soft px-1.5 text-[9px] text-set">{f.tag}</span>}
                    </div>
                    {f.note && <div className="mt-0.5 text-[11px] text-ink-3">{f.note}</div>}
                  </th>
                  {display.map((d) =>
                    d.kind === "declined" ? (
                      <td
                        key={`declined-${d.insurerId}-${f.key}`}
                        className="border-l border-b border-line-2 bg-muted/40 px-3 py-2 text-center text-xs text-muted-foreground"
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
                      />
                    ),
                  )}
                </tr>
              );
            })}
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
