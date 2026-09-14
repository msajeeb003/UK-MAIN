"use client";

import { ChevronLeft, ChevronRight, FileText } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError, documentsApi, errorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";

/** What the viewer is showing: a retained document and the page to open. */
export interface SourceRef {
  /** Column / insurer name for the caption. */
  caption: string;
  docId: string | null;
  /** 1-based page from the extraction; null when the value has no page reference. */
  page: number | null;
  /** Known page count, if the extraction recorded it. */
  pages?: number | null;
  /** Term the value belongs to (caption detail). */
  term?: string;
  /** Free-format column: the value was typed by the broker, no document behind it. */
  manual?: boolean;
}

interface SourceViewerProps {
  source: SourceRef | null;
  /** Compact chrome for the side panel; larger for the modal. */
  size?: "panel" | "modal";
  /** Message for the empty state (why there is nothing to show yet). */
  emptyHint?: string;
  className?: string;
}

type PageResult = { url: string; pageCount: number | null } | { error: string; status: number | null };

/** Rendered pages per (document, page), reused across cells and re-opens. */
const pageCache = new Map<string, PageResult>();
const keyOf = (docId: string, page: number) => `${docId}:${page}`;

/**
 * Source PDF viewer (BRD 2.5 "Source link"). Shows the page the selected
 * value came from and lets the broker move through the document. Pages are
 * the backend's rendered images, fetched through the authenticated client
 * (an <img src> cannot carry the Bearer token) and cached for the session.
 */
export function SourceViewer({ source, size = "panel", emptyHint, className }: SourceViewerProps) {
  const docId = source?.docId ?? null;
  const [page, setPage] = useState<number>(source?.page ?? 1);
  const [followed, setFollowed] = useState<string>("");
  // Follow the selected cell whenever the source (doc or page) changes.
  const followKey = `${docId ?? ""}:${source?.page ?? ""}`;
  if (followKey !== followed) {
    setFollowed(followKey);
    setPage(source?.page ?? 1);
  }

  const [result, setResult] = useState<{ key: string; value: PageResult } | null>(null);
  const key = docId ? keyOf(docId, page) : null;
  const current = key && result?.key === key ? result.value : key ? (pageCache.get(key) ?? null) : null;
  const loading = Boolean(key) && !current;
  const imgRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!docId || !page || pageCache.has(keyOf(docId, page))) return;
    const k = keyOf(docId, page);
    const controller = new AbortController();
    documentsApi.pageImage(docId, page, controller.signal).then(
      ({ blob, pageCount }) => {
        const value: PageResult = { url: URL.createObjectURL(blob), pageCount };
        pageCache.set(k, value);
        setResult({ key: k, value });
      },
      (err: unknown) => {
        if (controller.signal.aborted) return;
        const status = err instanceof ApiError ? err.status : null;
        const value: PageResult = { error: errorMessage(err, "Could not load the page"), status };
        if (status === 404) pageCache.set(k, value);
        setResult({ key: k, value });
      },
    );
    return () => controller.abort();
  }, [docId, page]);

  // Scroll the page back to the top when it changes.
  useEffect(() => {
    imgRef.current?.scrollTo({ top: 0 });
  }, [key]);

  const pageCount =
    (current && "pageCount" in current ? current.pageCount : null) ?? source?.pages ?? null;
  const canPrev = page > 1;
  const canNext = pageCount ? page < pageCount : !(current && "status" in current && current.status === 404);

  if (!source) {
    return (
      <div className={cn("flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground", className)}>
        <FileText className="size-6" />
        {emptyHint ?? "Select a value in the grid to see the page it came from."}
      </div>
    );
  }

  return (
    <div className={cn("flex h-full min-h-0 flex-col", className)} aria-label="Source document viewer">
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{source.caption}</div>
          <div className="truncate font-mono text-[11px] text-ink-3">
            {source.term ? `${source.term} · ` : ""}
            {source.manual ? "entered by the broker" : source.page ? `cited on page ${source.page}` : "no page reference for this value"}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button variant="ghost" size="icon-sm" aria-label="Previous page" disabled={!docId || !canPrev} onClick={() => setPage((p) => Math.max(1, p - 1))}>
            <ChevronLeft />
          </Button>
          <span className="label-mono min-w-[4.5rem] text-center normal-case">
            Page {page}
            {pageCount ? ` / ${pageCount}` : ""}
          </span>
          <Button variant="ghost" size="icon-sm" aria-label="Next page" disabled={!docId || !canNext} onClick={() => setPage((p) => p + 1)}>
            <ChevronRight />
          </Button>
        </div>
      </div>

      <div
        ref={imgRef}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft" && canPrev) setPage((p) => p - 1);
          if (e.key === "ArrowRight" && canNext) setPage((p) => p + 1);
        }}
        className="min-h-0 flex-1 overflow-auto bg-background p-3 outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        {!docId ? (
          <div className="grid aspect-[1/1.3] place-items-center rounded border bg-muted p-4 text-center font-mono text-xs text-muted-foreground">
            {source.manual
              ? "Free-format column: this value was entered by the broker, so there is no source document."
              : "No retained document for this column (older project). Re-upload the quote to link its pages."}
          </div>
        ) : loading ? (
          <Skeleton className="aspect-[1/1.3] w-full" />
        ) : current && "error" in current ? (
          <p className="py-10 text-center text-sm text-destructive">{current.error}</p>
        ) : current ? (
          // Object URL of a fetched blob; next/image cannot optimise it.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={current.url}
            alt={`${source.caption}, page ${page}`}
            className={cn("w-full rounded border bg-white", size === "modal" && "mx-auto max-w-3xl")}
          />
        ) : null}
      </div>
    </div>
  );
}
