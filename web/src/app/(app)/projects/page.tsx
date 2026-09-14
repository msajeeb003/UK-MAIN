import type { Metadata } from "next";

import { ProjectsList } from "@/components/projects/projects-list";

export const metadata: Metadata = { title: "Projects" };

export default function ProjectsPage() {
  return <ProjectsList />;
}
