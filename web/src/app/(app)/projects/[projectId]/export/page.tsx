import type { Metadata } from "next";

import { StepPlaceholder } from "@/components/shared/step-placeholder";

export const metadata: Metadata = { title: "Generate" };

export default async function Page({ params }: PageProps<"/projects/[projectId]/export">) {
  const { projectId } = await params;
  return <StepPlaceholder projectId={projectId} step="export" />;
}
