"use client";

import {
  FileOutput,
  FolderKanban,
  Settings2,
  ShieldCheck,
  Sparkles,
  Table2,
  Upload,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { Logo } from "@/components/layout/logo";
import { UserMenu } from "@/components/layout/user-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
import { PROJECT_STEPS, parseProjectPath, routes, type ProjectStepId } from "@/lib/navigation";

const STEP_ICONS: Record<ProjectStepId, LucideIcon> = {
  setup: Settings2,
  upload: Upload,
  review: Table2,
  limits: ShieldCheck,
  recommend: Sparkles,
  export: FileOutput,
};

export function AppSidebar() {
  const pathname = usePathname();
  const { state } = useSidebar();
  const { projectId, step } = parseProjectPath(pathname);
  const onProjectsList = pathname === routes.projects;

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="h-14 justify-center border-b border-sidebar-border px-3">
        <Logo compact={state === "collapsed"} />
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Workspace</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={onProjectsList}
                  tooltip="Projects"
                  render={<Link href={routes.projects} />}
                >
                  <FolderKanban />
                  <span>Projects</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {projectId && (
          <SidebarGroup>
            <SidebarGroupLabel>Current project</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {PROJECT_STEPS.map((s, index) => {
                  const Icon = STEP_ICONS[s.id];
                  return (
                    <SidebarMenuItem key={s.id}>
                      <SidebarMenuButton
                        isActive={step === s.id}
                        tooltip={s.label}
                        render={<Link href={routes.projectStep(projectId, s.id)} />}
                      >
                        <Icon />
                        <span className="flex-1 truncate">{s.label}</span>
                        <span className="label-mono group-data-[collapsible=icon]:hidden">
                          {index + 1}
                        </span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border">
        <UserMenu variant="sidebar" />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
