"use client";

import { Check, CircleAlert, CircleCheck } from "lucide-react";

import type { ConfirmKey } from "@/lib/fields";
import { CONFIRM_KEYS, CONFIRM_LABELS } from "@/lib/review";
import { cn } from "@/lib/utils";

interface ConfirmBarProps {
  flags: Record<ConfirmKey, boolean>;
  onToggle: (key: ConfirmKey) => void;
  onConfirmAll: () => void;
  /** No quote columns yet: nothing to confirm. */
  disabled?: boolean;
}

/**
 * BRD 2.5 confirmation gate: estimated annual premium, indemnity, excess
 * and max annual liability must be confirmed by the broker. The chips and
 * the highlighted grid rows share the same flags.
 */
export function ConfirmBar({ flags, onToggle, onConfirmAll, disabled }: ConfirmBarProps) {
  const left = CONFIRM_KEYS.filter((k) => !flags[k]).length;
  const done = left === 0;

  return (
    <div
      role="region"
      aria-label="Confirmation gate"
      className={cn(
        "flex flex-col gap-3 rounded-xl border px-4 py-3 md:flex-row md:items-center",
        done ? "border-ok/40 bg-ok-soft" : "border-warn/40 bg-warn-soft",
      )}
    >
      <div className={cn("flex items-center gap-2 text-sm font-semibold", done ? "text-ok" : "text-warn")}>
        {done ? <CircleCheck className="size-4" /> : <CircleAlert className="size-4" />}
        {done
          ? "All four key values confirmed. Export is enabled."
          : `Confirm ${left} of ${CONFIRM_KEYS.length} key values before export.`}
      </div>
      <div className="flex flex-wrap items-center gap-2 md:ml-auto">
        {CONFIRM_KEYS.map((k) => {
          const on = flags[k];
          return (
            <button
              key={k}
              type="button"
              role="checkbox"
              aria-checked={on}
              disabled={disabled}
              onClick={() => onToggle(k)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors disabled:opacity-50",
                on ? "border-ok bg-ok-soft text-ok" : "border-border bg-card text-muted-foreground hover:text-foreground",
              )}
            >
              <span
                aria-hidden
                className={cn(
                  "grid size-3.5 place-items-center rounded-full border",
                  on ? "border-ok bg-ok text-white" : "border-ink-3",
                )}
              >
                {on && <Check className="size-2.5" strokeWidth={3} />}
              </span>
              {CONFIRM_LABELS[k]}
            </button>
          );
        })}
        {!done && !disabled && (
          <button
            type="button"
            onClick={onConfirmAll}
            className="text-xs font-medium text-warn underline-offset-2 hover:underline"
          >
            Confirm all
          </button>
        )}
      </div>
    </div>
  );
}
