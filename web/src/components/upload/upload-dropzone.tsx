"use client";

import { useId, useRef, useState, type DragEvent, type ReactNode } from "react";

import { cn } from "@/lib/utils";

interface UploadDropzoneProps {
  title: string;
  hint: string;
  accept: string;
  multiple?: boolean;
  disabled?: boolean;
  /** Reason shown in place of the hint when disabled (e.g. quote cap reached). */
  disabledReason?: string;
  icon: ReactNode;
  tone?: "default" | "accent" | "warn";
  onFiles: (files: File[]) => void;
}

/**
 * Wireframe upload tile: dashed card, icon box, title, hint and a
 * "Choose files" button. Dropping files on the tile also works.
 */
export function UploadDropzone({
  title,
  hint,
  accept,
  multiple = true,
  disabled = false,
  disabledReason,
  icon,
  tone = "default",
  onFiles,
}: UploadDropzoneProps) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const depth = useRef(0);

  const pick = (list: FileList | File[] | null) => {
    if (!list) return;
    const files = Array.from(list);
    if (!files.length) return;
    onFiles(multiple ? files : files.slice(0, 1));
  };

  const onDragEnter = (e: DragEvent) => {
    e.preventDefault();
    if (disabled) return;
    depth.current += 1;
    setOver(true);
  };
  const onDragLeave = (e: DragEvent) => {
    e.preventDefault();
    depth.current = Math.max(0, depth.current - 1);
    if (depth.current === 0) setOver(false);
  };
  const onDragOver = (e: DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = disabled ? "none" : "copy";
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    depth.current = 0;
    setOver(false);
    if (disabled) return;
    pick(e.dataTransfer?.files ?? null);
  };

  return (
    <div
      role="group"
      aria-label={title}
      aria-disabled={disabled || undefined}
      data-drop-active={over || undefined}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
      className={cn(
        "rounded-xl border-[1.5px] border-dashed px-[18px] py-6 text-center transition-colors",
        tone === "warn" ? "border-warn bg-warn-soft" : "border-line bg-surface",
        over && !disabled && "border-primary bg-accent",
        disabled && "opacity-60",
      )}
    >
      <span
        className={cn(
          "mx-auto mb-3 grid size-[38px] place-items-center rounded-[9px]",
          tone === "accent" && "bg-accent text-primary",
          tone === "default" && "bg-panel text-ink-2",
          tone === "warn" && "bg-white text-warn",
        )}
      >
        {icon}
      </span>
      <div className="mb-[3px] text-sm font-semibold text-ink">{title}</div>
      <p className={cn("mb-3.5 text-xs", tone === "warn" ? "text-warn" : "text-ink-2")}>
        {disabled && disabledReason ? disabledReason : hint}
      </p>
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept={accept}
        multiple={multiple}
        hidden
        disabled={disabled}
        onChange={(e) => {
          pick(e.target.files);
          e.target.value = ""; // allow re-picking the same file later
        }}
      />
      <button
        type="button"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        className={cn(
          "rounded-[7px] px-3.5 py-2 text-[12.5px] font-semibold transition-colors focus-visible:ring-3 focus-visible:ring-accent focus-visible:outline-none disabled:pointer-events-none",
          tone === "accent" && "bg-accent text-primary hover:bg-[#e3e6fd]",
          tone === "default" && "border border-line bg-panel text-ink-2 hover:text-ink",
          tone === "warn" && "border border-warn bg-white text-warn",
        )}
      >
        {multiple ? "Choose files" : "Choose file"}
      </button>
    </div>
  );
}
