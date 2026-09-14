import { redirect } from "next/navigation";

import { FIRST_STEP, routes } from "@/lib/navigation";

export default async function ProjectIndexPage({ params }: PageProps<"/projects/[projectId]">) {
  const { projectId } = await params;
  redirect(routes.projectStep(projectId, FIRST_STEP));
}
