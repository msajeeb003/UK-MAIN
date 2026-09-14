"use client";

import { Trash, X } from "lucide-react";
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

const FIELD_ORDER: readonly string[] = ["buyer", "reg", "req"];

/** Enter / Shift+Enter: same cell in the next / previous buyer row. */
function moveFocus(rows: LimitRow[], rowId: string, cellKey: string, direction: 1 | -1) {
  const index = rows.findIndex((r) => r.id === rowId);
  const next = rows[index + direction];
  if (!next) return;
  const el = document.getElementById(`limit-${next.id}-${cellKey}`) as HTMLInputElement | null;
  el?.focus();
  el?.select();
}

function TotalCell({ value, className }: { value: number | null; className?: string }) {
  return (
    <td className={cn("border-t px-3 py-2.5 text-right text-sm font-semibold tabular-nums", className)}>
      {value === null ? <span className="text-ink-3">—</span> : formatPounds(value)}
    </td>
  );
}

/**
 * Buyer-by-buyer limits: Buyer, Company no., Required, then one column per
 * insurer with a quote; a computed Total row (same as the exported slide).
 */
export function LimitsGrid({ project, onBuyerField, onOffer, onRemoveRow, onRemoveColumn }: LimitsGridProps) {
  const rows = creditRows(project);
  const columns = limitColumns(project);
  const [removingRow, setRemovingRow] = useState<LimitRow | null>(null);
  const [removingCol, setRemovingCol] = useState<ProjectColumn | null>(null);
  const keys = [...FIELD_ORDER, ...columns.map((c) => c.id)];

  return (
    <div className="overflow-hidden rounded-xl border bg-card shadow-card">
      <div className="max-h-[65vh] overflow-auto">
        <table className="w-full border-collapse text-sm" style={{ minWidth: 470 + columns.length * 150 }}>
          <thead className="sticky top-0 z-20 bg-panel">
            <tr>
              <th className="label-mono min-w-[180px] border-b px-4 py-3 text-left">Buyer</th>
              <th className="label-mono min-w-[120px] border-b px-3 py-3 text-left">Company no.</th>
              <th className="label-mono min-w-[130px] border-b px-3 py-3 text-right">
                Required
                <span className="ml-1 normal-case text-ink-3">£</span>
              </th>
              {columns.map((col) => {
                const rec = col.id === project.recommended;
                return (
                  <th key={col.id} scope="col" className={cn("min-w-[150px] border-b border-l border-line-2 px-3 py-2 text-left", rec && "bg-rec")}>
                    <div className="flex items-center gap-1">
                      <span className={cn("truncate text-sm font-semibold", rec && "text-primary")} title={col.name}>
                        {col.name}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label={`Remove ${col.name} from the credit-limit table`}
                        title="Remove this insurer's column from the credit-limit table"
                        onClick={() => setRemovingCol(col)}
                      >
                        <X />
                      </Button>
                    </div>
                    <div className="label-mono mt-0.5 normal-case">offered · £</div>
                  </th>
                );
              })}
              <th className="w-12 border-b" aria-label="Row actions" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="group">
                <LimitCell row={r} cellKey="buyer" value={r.buyer ?? ""} label={`Buyer name, row ${r.buyer || r.id}`} placeholder="Buyer name" onChange={(v) => onBuyerField(r.id, "buyer", v)} onMove={(d) => moveFocus(rows, r.id, "buyer", d)} />
                <LimitCell row={r} cellKey="reg" value={r.reg ?? ""} label={`Company number for ${r.buyer || "buyer"}`} mono onChange={(v) => onBuyerField(r.id, "reg", v)} onMove={(d) => moveFocus(rows, r.id, "reg", d)} />
                <LimitCell row={r} cellKey="req" value={r.req ?? ""} label={`Limit required for ${r.buyer || "buyer"}`} money onChange={(v) => onBuyerField(r.id, "req", v)} onMove={(d) => moveFocus(rows, r.id, "req", d)} />
                {columns.map((col) => (
                  <LimitCell
                    key={col.id}
                    row={r}
                    cellKey={col.id}
                    value={r.offers?.[col.id] ?? ""}
                    label={`${col.name} limit offered for ${r.buyer || "buyer"}`}
                    money
                    recommended={col.id === project.recommended}
                    onChange={(v) => onOffer(r.id, col.id, v)}
                    onMove={(d) => moveFocus(rows, r.id, col.id, d)}
                  />
                ))}
                <td className="border-b border-line-2 text-center">
                  <Button variant="ghost" size="icon-xs" aria-label={`Remove buyer ${r.buyer || "row"}`} title="Remove buyer row" onClick={() => setRemovingRow(r)}>
                    <Trash />
                  </Button>
                </td>
              </tr>
            ))}
            {rows.length > 0 && (
              <tr className="bg-panel">
                <td className="border-t px-4 py-2.5 text-sm font-semibold">Total</td>
                <td className="border-t" />
                <TotalCell value={total(rows.map((r) => r.req ?? ""))} />
                {columns.map((col) => (
                  <TotalCell key={col.id} value={total(rows.map((r) => r.offers?.[col.id] ?? ""))} className={cn("border-l border-line-2", col.id === project.recommended && "bg-rec")} />
                ))}
                <td className="border-t" />
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="sr-only">Enter moves to the next buyer row; Tab moves across. Cells: {keys.length} per row.</p>

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
              Its offered limits are cleared from every buyer row and the column is dropped from the credit-limit
              slide. The insurer stays in the comparison. A later limits upload for this insurer brings the column back.
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
