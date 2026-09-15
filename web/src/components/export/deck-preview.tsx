"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage, projectsApi } from "@/lib/api";
import { cn } from "@/lib/utils";

interface DeckPreviewProps {
  projectId: string;
  /** Changes after each generation so the pages are fetched afresh. */
  version: number;
}

interface PageImage {
  page: number;
  url: string;
}

/**
 * Slide preview rendered from the generated PDF itself (backend
 * `/projects/{id}/exports/pdf/page/{n}`), so it matches the download page
 * for page. Thumbnails on the left, the selected page large.
 */
export function DeckPreview({ projectId, version }: DeckPreviewProps) {
  const [pages, setPages] = useState<{ version: number; items: PageImage[]; count: number | null; error: string | null }>({
    version: -1,
    items: [],
    count: null,
    error: null,
  });
  const [current, setCurrent] = useState(1);
  const loading = pages.version !== version;

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const urls: string[] = [];
    (async () => {
      try {
        const first = await projectsApi.exportPdfPage(projectId, 1, controller.signal);
        const count = first.pageCount ?? 1;
        const items: PageImage[] = [{ page: 1, url: URL.createObjectURL(first.blob) }];
        urls.push(items[0].url);
        for (let n = 2; n <= count; n += 1) {
          const { blob } = await projectsApi.exportPdfPage(projectId, n, controller.signal);
          const url = URL.createObjectURL(blob);
          urls.push(url);
          items.push({ page: n, url });
        }
        if (!cancelled) setPages({ version, items, count, error: null });
      } catch (err) {
        if (!cancelled && !controller.signal.aborted) {
          setPages({ version, items: [], count: null, error: errorMessage(err, "Could not load the preview") });
        }
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
      for (const u of urls) URL.revokeObjectURL(u);
    };
  }, [projectId, version]);

  const count = pages.items.length;
  const shown = pages.items.find((p) => p.page === current) ?? pages.items[0];

  if (loading) {
    return (
      <div className="grid gap-3 lg:grid-cols-[120px_1fr]">
        <div className="hidden space-y-2 lg:block">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="aspect-video w-full" />
          ))}
        </div>
        <Skeleton className="aspect-video w-full" />
      </div>
    );
  }
  if (pages.error) {
    return <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-destructive">{pages.error}</p>;
  }
  if (!shown) return null;

  return (
    <div className="grid gap-3 lg:grid-cols-[120px_1fr]" aria-label="Presentation preview">
      <ol className="flex gap-2 overflow-x-auto lg:flex-col lg:overflow-y-auto lg:pr-1" aria-label="Slides">
        {pages.items.map((p) => (
          <li key={p.page} className="shrink-0">
            <button
              type="button"
              onClick={() => setCurrent(p.page)}
              aria-current={p.page === current ? "true" : undefined}
              aria-label={`Slide ${p.page}`}
              className={cn(
                "block w-28 overflow-hidden rounded-md border bg-white lg:w-full",
                p.page === current ? "border-primary ring-2 ring-primary/30" : "border-border hover:border-ink-3",
              )}
            >
              {/* Object URL of a fetched blob; next/image cannot optimise it. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.url} alt="" className="block w-full" />
              <span className="label-mono block py-0.5 text-center text-[9px]">{p.page}</span>
            </button>
          </li>
        ))}
      </ol>
      <div className="min-w-0">
        <div className="overflow-hidden rounded-lg border bg-white shadow-card">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={shown.url} alt={`Slide ${shown.page} of ${count}`} className="block w-full" />
        </div>
        <div className="mt-2 flex items-center justify-center gap-2">
          <Button variant="ghost" size="icon-sm" aria-label="Previous slide" disabled={current <= 1} onClick={() => setCurrent((c) => Math.max(1, c - 1))}>
            <ChevronLeft />
          </Button>
          <span className="label-mono normal-case">
            Slide {shown.page} of {count}
          </span>
          <Button variant="ghost" size="icon-sm" aria-label="Next slide" disabled={current >= count} onClick={() => setCurrent((c) => Math.min(count, c + 1))}>
            <ChevronRight />
          </Button>
        </div>
      </div>
    </div>
  );
}
