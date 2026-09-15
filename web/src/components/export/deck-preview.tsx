"use client";

import { useEffect, useState } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { ApiError, errorMessage, projectsApi } from "@/lib/api";

interface DeckPreviewProps {
  projectId: string;
  /** Changes after each generation so the pages are fetched afresh. */
  version: number;
  /** The project has no generated PDF (yet): let the screen decide what to do. */
  onMissing?: () => void;
}

interface PageImage {
  page: number;
  url: string;
}

/** Placeholder stack while the pages are fetched (same shape as the wireframe: cover first). */
export function DeckSkeleton({ pages = 3 }: { pages?: number }) {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading the presentation preview">
      {Array.from({ length: pages }).map((_, i) => (
        <Skeleton key={i} className="aspect-video w-full rounded-[10px]" />
      ))}
    </div>
  );
}

/**
 * The generated presentation itself, page by page, rendered by the backend
 * from the PDF the broker downloads (`/projects/{id}/exports/pdf/page/{n}`),
 * so the preview matches the file exactly. Laid out as in the wireframe:
 * the cover first, the remaining pages stacked below it.
 */
export function DeckPreview({ projectId, version, onMissing }: DeckPreviewProps) {
  const [pages, setPages] = useState<{ version: number; items: PageImage[]; error: string | null }>({
    version: -1,
    items: [],
    error: null,
  });
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
        // Show the cover as soon as it is in, then fill in the rest.
        if (!cancelled) setPages({ version, items: [...items], error: null });
        for (let n = 2; n <= count; n += 1) {
          const { blob } = await projectsApi.exportPdfPage(projectId, n, controller.signal);
          const url = URL.createObjectURL(blob);
          urls.push(url);
          items.push({ page: n, url });
          if (!cancelled) setPages({ version, items: [...items], error: null });
        }
      } catch (err) {
        if (cancelled || controller.signal.aborted) return;
        if (err instanceof ApiError && err.status === 404) {
          setPages({ version, items: [], error: null });
          onMissing?.();
          return;
        }
        setPages({ version, items: [], error: errorMessage(err, "Could not load the preview") });
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
      for (const u of urls) URL.revokeObjectURL(u);
    };
    // onMissing is a notification, not an input to what is fetched.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, version]);

  if (loading) return <DeckSkeleton />;
  if (pages.error) {
    return <p className="rounded-[14px] border border-dashed border-line bg-surface px-4 py-8 text-center text-sm text-destructive">{pages.error}</p>;
  }
  if (!pages.items.length) return null;

  return (
    <ol className="flex flex-col gap-4" aria-label="Presentation preview">
      {pages.items.map((p) => (
        <li key={p.page} className="animate-qcfade">
          <figure className="m-0">
            <div className="overflow-hidden rounded-[10px] border border-line bg-white shadow-[0_4px_18px_rgba(20,30,50,.08)]">
              {/* Object URL of a fetched blob; next/image cannot optimise it. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.url} alt={`Page ${p.page} of the presentation`} className="block aspect-video w-full object-contain" />
            </div>
            <figcaption className="mt-1.5 text-right font-mono text-[10.5px] font-medium tracking-[.5px] text-ink-3 uppercase">Page {p.page}</figcaption>
          </figure>
        </li>
      ))}
    </ol>
  );
}
