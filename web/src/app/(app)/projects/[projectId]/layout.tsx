import { ProjectStepper } from "@/components/layout/project-stepper";
import { ProjectProvider } from "@/components/providers/project-provider";

export default async function ProjectLayout({
  children,
  params,
}: LayoutProps<"/projects/[projectId]">) {
  const { projectId } = await params;
  return (
    <ProjectProvider projectId={projectId}>
      <ProjectStepper projectId={projectId} />
      {children}
    </ProjectProvider>
  );
}
