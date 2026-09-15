"use client";

import { useState, type KeyboardEvent } from "react";

import { cellProvenance, isDeclined, type LimitProvenance, type LimitRow } from "@/lib/limits";
import { cn } from "@/lib/utils";

interface LimitCellProps {
  row: LimitRow;
  /** "buyer" | "reg" | "req" | column id */
  cellKey: string;
  value: string;
  label: string;
  /** Amount cells get the zero/declined tag. */
  money?: boolean;
  mono?: boolean;
  placeholder?: string;
  recommended?: boolean;
  onChange: (value: string) => void;
  onMove?: (direction: 1 | -1) => void;
}

const TITLE: Record<LimitProvenance, string> = {
  extracted: "Extracted from a credit-limit document or quote schedule",
  edited: "Edited by the broker",
  manual: "Entered by the broker (facility agreed offline)",
  blank: "Blank: no limit found in any document",
};

/**
 * One editable credit-limit cell (wireframe: borderless input inside the
 * row, white with an accent ring while focused). Keeps the provenance
 * states: extracted / edited (accent dot) / manual / blank, plus a
 * "declined" tag for an explicit zero. Commits on blur/Enter.
 */
export function LimitCell({ row, cellKey, value, label, money, mono, placeholder, recommended, onChange, onMove }: LimitCellProps) {
  const [text, setText] = useState(value);
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    setText(value);
  }
  const provenance = cellProvenance(row, cellKey, value);
  const declined = money && isDeclined(value);
  const commit = () => {
    if (text !== value) onChange(text);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commit();
      onMove?.(e.shiftKey ? -1 : 1);
    } else if (e.key === "Escape") {
      setText(value);
    }
  };

  return (
    <td className={cn("border-b border-line-2 px-1.5 py-0.5 align-middle", money && "border-l", recommended && "bg-rec")} data-provenance={provenance}>
      <div className="flex items-center gap-1.5">
        <div className="relative min-w-0 flex-1">
          <input
            id={`limit-${row.id}-${cellKey}`}
            aria-label={label}
            title={TITLE[provenance]}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={commit}
            onKeyDown={onKeyDown}
            placeholder={placeholder}
            inputMode={money ? "numeric" : undefined}
            data-provenance={provenance}
            className={cn(
              "w-full rounded-md bg-transparent px-1.5 py-2 text-[13px] text-ink outline-none placeholder:text-ink-3 focus:bg-white focus:ring-2 focus:ring-primary",
              cellKey === "buyer" && "font-medium",
              mono && "font-mono text-[12.5px] text-ink-2",
              money && cellKey !== "req" && "placeholder:italic",
              provenance === "edited" && "pl-4",
            )}
          />
          {provenance === "edited" && (
            <span aria-hidden title={TITLE.edited} className="absolute top-1/2 left-1 size-1.5 -translate-y-1/2 rounded-full bg-primary" />
          )}
        </div>
        {declined && (
          <span className="shrink-0 rounded bg-muted px-1 font-mono text-[10px] text-ink-2 uppercase" title="Limit declined: an explicit zero, not a missing value">
            declined
          </span>
        )}
      </div>
    </td>
  );
}
