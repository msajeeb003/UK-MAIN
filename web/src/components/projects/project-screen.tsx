"use client";

import { FolderX } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useProject } from "@/hooks/use-project";
import type { ProjectState } from "@/lib/api/types";
import { routes } from "@/lib/navigation";

interface ProjectScreenProps {
  children: (project: ProjectState) => ReactNode;
}

/**
 * Renders a project step once its state is loaded; handles the loading,
 * missing and error cases in one place so each step only deals with data.
 */
export function ProjectScreen({ children }: ProjectScreenProps) {
  const { project, status, error, reload } = useProject();

  if (status === "loading") {
    return (
      <div className="space-y-6">
        <div className="space-y-2">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-96 max-w-full" />
        </div>
        <Skeleton className="h-72 w-full rounded-xl" />
      </div>
    );
  }

  if (status === "error") {
    return (
      <Card>
        <CardContent className="flex items-center justify-between gap-4 py-4">
          <p className="text-sm text-destructive">{error}</p>
          <Button variant="outline" onClick={reload}>
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (status === "missing" || !project) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
          <span className="grid size-12 place-items-center rounded-xl bg-warn-soft text-warn">
            <FolderX className="size-6" />
          </span>
          <div className="space-y-1">
            <p className="font-medium">Project not found</p>
            <p className="text-sm text-muted-foreground">
              It may have been deleted, or the link is out of date.
            </p>
          </div>
          <Button variant="outline" nativeButton={false} render={<Link href={routes.projects} />}>
            Back to projects
          </Button>
        </CardContent>
      </Card>
    );
  }

  return <>{children(project)}</>;
}
