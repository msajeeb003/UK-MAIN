"use client";

import { useId, useRef, useState, type DragEvent, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface UploadDropzoneProps {
  title: string;
  hint: string;
  accept: string;
  multiple?: boolean;
  disabled?: boolean;
  /** Reason shown when disabled (e.g. quote cap reached). */
  disabledReason?: string;
  icon: ReactNode;
  tone?: "default" | "accent" | "warn";
  /** Small line under the button, e.g. "3 of 6 used". */
  footer?: ReactNode;
  onFiles: (files: File[]) => void;
}

/**
 * Drag-and-drop slot with a file-picker fallback. Only the browser's
 * native drag events are used, so folders and multiple files work anywhere
 * the OS supports them; the keyboard path is the button.
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
  footer,
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
        "flex flex-col items-center rounded-xl border-[1.5px] border-dashed px-4 py-6 text-center transition-colors",
        tone === "warn" ? "border-warn/60 bg-warn-soft" : "border-border bg-card",
        over && !disabled && "border-primary bg-accent",
        disabled && "opacity-60",
      )}
    >
      <span
        className={cn(
          "mb-3 grid size-10 place-items-center rounded-lg",
          tone === "accent" && "bg-accent text-primary",
          tone === "default" && "bg-panel text-muted-foreground",
          tone === "warn" && "bg-card text-warn",
        )}
      >
        {icon}
      </span>
      <div className="text-sm font-semibold">{title}</div>
      <p className={cn("mt-0.5 mb-3.5 text-xs", tone === "warn" ? "text-warn" : "text-muted-foreground")}>
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
      <Button
        type="button"
        variant={tone === "accent" ? "secondary" : "outline"}
        size="sm"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        className={cn(tone === "warn" && "border-warn/50 text-warn hover:bg-card")}
      >
        {multiple ? "Choose files" : "Choose file"}
      </Button>
      <p className="mt-2 text-[11px] text-muted-foreground">or drag and drop here</p>
      {footer && <div className="mt-2 text-xs text-muted-foreground">{footer}</div>}
    </div>
  );
}
