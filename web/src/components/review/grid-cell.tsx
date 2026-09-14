"use client";

import { TriangleAlert } from "lucide-react";
import { useState, type KeyboardEvent } from "react";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { ProjectState } from "@/lib/api/types";
import type { FieldDef } from "@/lib/fields";
import {
  DEBT_OPTIONS,
  cellPage,
  cellProvenance,
  cellRaw,
  cellUncertain,
  cellValue,
  confirmedFlags,
  hasTypeOverride,
  isZeroValue,
  policyTypeOptions,
  type CellProvenance,
} from "@/lib/review";
import type { ProjectColumn } from "@/lib/uploads";
import { cn } from "@/lib/utils";

export interface GridCellProps {
  project: ProjectState;
  col: ProjectColumn;
  field: FieldDef;
  recommended: boolean;
  onChange: (value: string) => void;
  /** Page chip clicked: open the source at that page (and expand it). */
  onOpenSource: (page: number) => void;
  /** Cell focused/clicked: point the source viewer at this value's page. */
  onSelect: (page: number | null) => void;
  /** Enter / Shift+Enter: move to the same column in the next / previous row. */
  onMove: (direction: 1 | -1) => void;
}

export const cellDomId = (colId: string, fieldKey: string) => `cell-${colId}-${fieldKey}`;

const PROVENANCE_TITLE: Record<CellProvenance, string> = {
  set: "Set field: pre-filled at setup or by the insurer rule, never extracted",
  extracted: "Extracted by AI from the document; click the page chip to check the source",
  edited: "Edited by the broker (the AI value is kept for the edit-rate metric)",
  manual: "Entered by the broker (no AI value)",
  blank: "Blank: nothing found in the document, and nothing is guessed",
};

/**
 * One editable grid cell. Conditional styling:
 * - set fields (policy type, debt collection): purple tint + Select, with a
 *   "default" tag while the policy type is inherited from setup;
 * - key rows: amber until confirmed, green once confirmed;
 * - low-confidence values: warning icon; hover shows the raw text the AI read;
 * - broker-edited values: accent dot;
 * - blank vs zero: a blank renders as "—" in a dashed field, a zero keeps
 *   its literal text ("0", "£0", "Nil") plus a "zero" tag.
 */
export function GridCell({ project, col, field, recommended, onChange, onOpenSource, onSelect, onMove }: GridCellProps) {
  const value = cellValue(project, col, field);
  const provenance = cellProvenance(project, col, field);
  const uncertain = cellUncertain(col, field);
  const page = cellPage(col, field);
  const flags = confirmedFlags(project);
  const keyConfirmed = field.confirm ? flags[field.confirm] : null;
  const zero = isZeroValue(value);

  // Local text while typing; committed on blur / Enter so a keystroke does
  // not re-render the whole grid. When the stored value changes underneath
  // (undo, another upload), adopt it (derived-state-during-render pattern).
  const [text, setText] = useState(value);
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    setText(value);
  }
  const commit = () => {
    if (text !== value) onChange(text);
  };

  const tint = recommended
    ? "bg-rec"
    : field.set
      ? "bg-set-soft/70"
      : keyConfirmed === true
        ? "bg-ok-soft/70"
        : keyConfirmed === false
          ? "bg-warn-soft/70"
          : uncertain
            ? "bg-warn-soft/70"
            : "";

  const inputId = cellDomId(col.id, field.key);
  const label = `${field.label} for ${col.name}`;

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commit();
      onMove(e.shiftKey ? -1 : 1);
    } else if (e.key === "Escape") {
      setText(value);
    }
    // Tab: native order runs along the row (next insurer), as expected.
  };

  if (field.key === "type" || field.key === "debt") {
    const options = field.key === "type" ? policyTypeOptions() : DEBT_OPTIONS;
    const known = options.includes(value);
    const inherited = field.key === "type" && !hasTypeOverride(col);
    return (
      <td className={cn("border-l border-b border-line-2 p-1.5 align-middle", tint)} data-provenance={provenance}>
        <div className="flex items-center gap-1.5">
          <Select value={known ? value : ""} onValueChange={(v) => v !== null && onChange(String(v))}>
            <SelectTrigger
              id={inputId}
              size="sm"
              aria-label={label}
              title={inherited ? "Inherited from setup; choose a value to override for this insurer" : PROVENANCE_TITLE.set}
              className={cn("h-7 w-full border-set/30 bg-card text-[13px]", inherited && "text-ink-2")}
            >
              <SelectValue placeholder={value || "—"}>{known ? value : value || "—"}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {options.map((o) => (
                <SelectItem key={o} value={o}>
                  {o}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="label-mono shrink-0 text-set" title={inherited ? "Default from setup" : PROVENANCE_TITLE.set}>
            {inherited ? "default" : "set"}
          </span>
        </div>
      </td>
    );
  }

  return (
    <td className={cn("border-l border-b border-line-2 p-0 align-middle", tint)} data-provenance={provenance}>
      <div className="flex items-center gap-1.5 px-2 py-1">
        <div className="relative min-w-0 flex-1">
          <input
            id={inputId}
            aria-label={label}
            title={PROVENANCE_TITLE[provenance]}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onFocus={() => onSelect(page)}
            onBlur={commit}
            onKeyDown={onKeyDown}
            placeholder={provenance === "blank" ? "—" : undefined}
            data-provenance={provenance}
            className={cn(
              "w-full rounded-md bg-transparent px-1.5 py-1 text-[13px] text-foreground outline-none placeholder:text-ink-3 focus:bg-card focus:ring-2 focus:ring-primary",
              provenance === "blank" && "border border-dashed border-ink-3/60",
              provenance === "edited" && "pl-4",
            )}
          />
          {provenance === "edited" && (
            <span
              aria-hidden
              title={PROVENANCE_TITLE.edited}
              className="absolute top-1/2 left-1 size-1.5 -translate-y-1/2 rounded-full bg-primary"
            />
          )}
        </div>
        {zero && (
          <span
            className="label-mono shrink-0 rounded bg-muted px-1 text-ink-2"
            title="A genuine zero / nil from the document, not a blank"
          >
            zero
          </span>
        )}
        {uncertain && (
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  aria-label="Low-confidence extraction"
                  className="grid size-5 shrink-0 place-items-center rounded text-warn hover:bg-warn-soft"
                />
              }
            >
              <TriangleAlert className="size-3.5" />
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-xs">
              <div className="flex flex-col gap-1 text-left">
                <span className="font-medium">Low confidence: verify against the source</span>
                <span className="font-mono text-[11px]">
                  AI read: “{cellRaw(col, field) || "(nothing)"}”{page ? ` · page ${page}` : ""}
                </span>
                <span className="text-[11px] opacity-80">Editing the cell clears this flag.</span>
              </div>
            </TooltipContent>
          </Tooltip>
        )}
        {page && (
          <button
            type="button"
            onClick={() => onOpenSource(page)}
            title={`Open source page ${page}`}
            className="label-mono shrink-0 text-primary opacity-75 hover:underline hover:opacity-100"
          >
            p{page}
          </button>
        )}
      </div>
    </td>
  );
}
