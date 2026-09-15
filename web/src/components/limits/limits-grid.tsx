"use client";

import { useState } from "react";

import { LimitCell } from "@/components/limits/limit-cell";
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
import type { ProjectState } from "@/lib/api/types";
import { creditRows, formatPounds, limitColumns, total, type BuyerField, type LimitRow } from "@/lib/limits";
import type { ProjectColumn } from "@/lib/uploads";
import { cn } from "@/lib/utils";

export interface LimitsGridProps {
  project: ProjectState;
  onBuyerField: (rowId: string, field: BuyerField, value: string) => void;
  onOffer: (rowId: string, colId: string, value: string) => void;
  onRemoveRow: (rowId: string) => void;
  onRemoveColumn: (colId: string) => void;
}

/** Enter / Shift+Enter: same cell in the next / previous buyer row. */
function moveFocus(rows: LimitRow[], rowId: string, cellKey: string, direction: 1 | -1) {
  const index = rows.findIndex((r) => r.id === rowId);
  const next = rows[index + direction];
  if (!next) return;
  const el = document.getElementById(`limit-${next.id}-${cellKey}`) as HTMLInputElement | null;
  el?.focus();
  el?.select();
}

const TH = "border-b border-line bg-panel px-3.5 py-3 text-left font-mono text-[11px] font-medium tracking-[.4px] text-ink-3 uppercase";

function TotalCell({ value, className }: { value: number | null; className?: string }) {
  return (
    <td className={cn("border-t border-line px-3 py-2.5 text-[13px] font-semibold text-ink tabular-nums", className)}>
      {value === null ? <span className="text-ink-3">—</span> : formatPounds(value)}
    </td>
  );
}

/**
 * The wireframe's credit-limit table: Buyer, Company no., Required, one
 * column per insurer with a quote, and a "×" to drop a row. A computed
 * Total row matches the exported slide.
 */
export function LimitsGrid({ project, onBuyerField, onOffer, onRemoveRow, onRemoveColumn }: LimitsGridProps) {
  const rows = creditRows(project);
  const columns = limitColumns(project);
  const [removingRow, setRemovingRow] = useState<LimitRow | null>(null);
  const [removingCol, setRemovingCol] = useState<ProjectColumn | null>(null);

  return (
    <div className="overflow-hidden rounded-[14px] border border-line bg-surface shadow-card">
      <div className="max-h-[65vh] overflow-auto">
        <table className="w-full border-collapse" style={{ minWidth: 470 + columns.length * 150 }}>
          <thead className="sticky top-0 z-20">
            <tr>
              <th className={cn(TH, "min-w-[180px] px-4")}>Buyer</th>
              <th className={cn(TH, "min-w-[120px]")}>Company no.</th>
              <th className={cn(TH, "min-w-[130px]")}>Required</th>
              {columns.map((col) => {
                const rec = col.id === project.recommended;
                return (
                  <th
                    key={col.id}
                    scope="col"
                    className={cn("min-w-[150px] border-b border-l border-line border-l-line-2 px-3.5 py-3 text-left text-[13px] font-semibold", rec ? "bg-rec text-primary" : "bg-panel text-ink")}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="truncate" title={col.name}>
                        {col.name}
                      </span>
                      <button
                        type="button"
                        aria-label={`Remove ${col.name} from the credit-limit table`}
                        title="Remove this insurer's column from the credit-limit table"
                        onClick={() => setRemovingCol(col)}
                        className="text-[15px] leading-none font-normal text-ink-3 hover:text-warn"
                      >
                        ×
                      </button>
                    </div>
                  </th>
                );
              })}
              <th className="w-10 border-b border-line bg-panel" aria-label="Row actions" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="hover:bg-panel">
                <LimitCell row={r} cellKey="buyer" value={r.buyer ?? ""} label={`Buyer name, row ${r.buyer || r.id}`} placeholder="Buyer name" onChange={(v) => onBuyerField(r.id, "buyer", v)} onMove={(d) => moveFocus(rows, r.id, "buyer", d)} />
                <LimitCell row={r} cellKey="reg" value={r.reg ?? ""} label={`Company number for ${r.buyer || "buyer"}`} mono placeholder="—" onChange={(v) => onBuyerField(r.id, "reg", v)} onMove={(d) => moveFocus(rows, r.id, "reg", d)} />
                <LimitCell row={r} cellKey="req" value={r.req ?? ""} label={`Limit required for ${r.buyer || "buyer"}`} money placeholder="—" onChange={(v) => onBuyerField(r.id, "req", v)} onMove={(d) => moveFocus(rows, r.id, "req", d)} />
                {columns.map((col) => (
                  <LimitCell
                    key={col.id}
                    row={r}
                    cellKey={col.id}
                    value={r.offers?.[col.id] ?? ""}
                    label={`${col.name} limit offered for ${r.buyer || "buyer"}`}
                    money
                    placeholder="Not reviewed"
                    recommended={col.id === project.recommended}
                    onChange={(v) => onOffer(r.id, col.id, v)}
                    onMove={(d) => moveFocus(rows, r.id, col.id, d)}
                  />
                ))}
                <td className="border-b border-line-2 text-center">
                  <button
                    type="button"
                    aria-label={`Remove buyer ${r.buyer || "row"}`}
                    title="Remove buyer row"
                    onClick={() => setRemovingRow(r)}
                    className="px-2 text-base leading-none text-ink-3 hover:text-warn"
                  >
                    ×
                  </button>
                </td>
              </tr>
            ))}
            {rows.length > 0 && (
              <tr className="bg-panel">
                <td className="border-t border-line px-4 py-2.5 text-[13px] font-semibold text-ink">Total</td>
                <td className="border-t border-line" />
                <TotalCell value={total(rows.map((r) => r.req ?? ""))} />
                {columns.map((col) => (
                  <TotalCell key={col.id} value={total(rows.map((r) => r.offers?.[col.id] ?? ""))} className={cn("border-l border-line-2", col.id === project.recommended && "bg-rec")} />
                ))}
                <td className="border-t border-line" />
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Dialog open={Boolean(removingRow)} onOpenChange={(o) => !o && setRemovingRow(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove {removingRow?.buyer || "this buyer"}?</DialogTitle>
            <DialogDescription>The row and its limits are removed from the table and the presentation. This cannot be undone.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Keep it</DialogClose>
            <Button
              variant="destructive"
              onClick={() => {
                if (removingRow) onRemoveRow(removingRow.id);
                setRemovingRow(null);
              }}
            >
              Remove buyer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(removingCol)} onOpenChange={(o) => !o && setRemovingCol(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove {removingCol?.name} from the credit-limit table?</DialogTitle>
            <DialogDescription>
              Its offered limits are cleared from every buyer row and the column is dropped from the credit-limit slide. The insurer
              stays in the comparison. A later limits upload for this insurer brings the column back.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Keep it</DialogClose>
            <Button
              variant="destructive"
              onClick={() => {
                if (removingCol) onRemoveColumn(removingCol.id);
                setRemovingCol(null);
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
