"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";
import { systemApi } from "@/lib/api";
import { routes } from "@/lib/navigation";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const router = useRouter();
  useEffect(() => {
    // Scrubbed, best-effort report to the backend's /client-error sink.
    void systemApi.reportClientError({
      message: error.message.slice(0, 500),
      kind: "render-error",
      where: typeof window !== "undefined" ? window.location.pathname : "",
      stack: (error.stack ?? "").slice(0, 4000),
    });
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-8 text-center">
      <p className="label-mono">Something went wrong</p>
      <h1 className="text-2xl font-semibold tracking-tight">This page failed to render</h1>
      <p className="max-w-md text-sm text-muted-foreground">
        The error has been reported. You can try again, or return to your projects.
      </p>
      <div className="flex gap-2">
        <Button variant="outline" onClick={reset}>
          Try again
        </Button>
        <Button onClick={() => router.push(routes.projects)}>Go to projects</Button>
      </div>
    </div>
  );
}
