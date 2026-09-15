"use client";

import type { ConfirmKey } from "@/lib/fields";
import { CONFIRM_KEYS, CONFIRM_LABELS } from "@/lib/review";
import { cn } from "@/lib/utils";

interface ConfirmBarProps {
  flags: Record<ConfirmKey, boolean>;
  onToggle: (key: ConfirmKey) => void;
  /** No quote columns yet: nothing to confirm. */
  disabled?: boolean;
}

/**
 * The wireframe's confirmation bar (BRD 2.5): estimated annual premium,
 * indemnity, excess and max annual liability must be confirmed by the
 * broker before export. Amber until all four are ticked, then green.
 */
export function ConfirmBar({ flags, onToggle, disabled }: ConfirmBarProps) {
  const left = CONFIRM_KEYS.filter((k) => !flags[k]).length;
  const done = left === 0;

  return (
    <div
      role="region"
      aria-label="Confirmation gate"
      className={cn(
        "my-4 mb-3.5 flex flex-col gap-3 rounded-[10px] border px-4 py-[11px] md:flex-row md:items-center",
        done ? "border-ok bg-ok-soft" : "border-warn bg-warn-soft",
      )}
    >
      <span className={cn("text-[13px] font-semibold", done ? "text-ok" : "text-warn")}>
        {done ? "✓ All four key values confirmed — export enabled." : `⚠ Confirm ${left} of ${CONFIRM_KEYS.length} key values before export`}
      </span>
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
                "inline-flex items-center gap-1.5 rounded-full border px-[11px] py-[5px] text-xs font-medium transition-colors disabled:opacity-50",
                on ? "border-ok bg-ok-soft text-ok" : "border-line bg-white text-ink-2 hover:text-ink",
              )}
            >
              <span aria-hidden>{on ? "✓" : "○"}</span>
              {CONFIRM_LABELS[k]}
            </button>
          );
        })}
      </div>
    </div>
  );
}
