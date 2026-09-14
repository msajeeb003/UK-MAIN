"use client";

import { ProjectScreen } from "@/components/projects/project-screen";
import { SetupForm } from "@/components/projects/setup-form";

/** Client boundary: the page (a Server Component) cannot pass a render function. */
export function SetupScreen() {
  return <ProjectScreen>{(project) => <SetupForm key={project.id} project={project} />}</ProjectScreen>;
}
