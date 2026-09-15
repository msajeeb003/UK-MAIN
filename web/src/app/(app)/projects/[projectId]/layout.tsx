import { ProjectCrumb } from "@/components/layout/project-crumb";
import { ProjectStepper } from "@/components/layout/project-stepper";
import { ProjectProvider } from "@/components/providers/project-provider";

/** The wizard frame: stepper bar, then the step's content in a 1180px column. */
export default async function ProjectLayout({
  children,
  params,
}: LayoutProps<"/projects/[projectId]">) {
  const { projectId } = await params;
  return (
    <ProjectProvider projectId={projectId}>
      <ProjectCrumb />
      <ProjectStepper projectId={projectId} />
      <main className="flex-1">
        <div className="animate-qcfade mx-auto w-full max-w-[1180px] px-[26px] pt-[30px] pb-10">{children}</div>
      </main>
    </ProjectProvider>
  );
}
