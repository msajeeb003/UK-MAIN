import type { Metadata } from "next";

import { ProjectsList } from "@/components/projects/projects-list";

export const metadata: Metadata = { title: "Projects" };

export default function ProjectsPage() {
  return (
    <main className="animate-qcfade mx-auto w-full max-w-[1100px] flex-1 px-[26px] pt-[34px] pb-[60px]">
      <ProjectsList />
    </main>
  );
}
