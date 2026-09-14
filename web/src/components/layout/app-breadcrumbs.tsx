"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Fragment } from "react";

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { PROJECT_STEPS, parseProjectPath, routes } from "@/lib/navigation";

interface Crumb {
  label: string;
  href?: string;
}

function crumbsFor(pathname: string): Crumb[] {
  const { projectId, step } = parseProjectPath(pathname);
  if (!projectId) {
    if (pathname === routes.projects) return [{ label: "Projects" }];
    return [];
  }
  const crumbs: Crumb[] = [{ label: "Projects", href: routes.projects }];
  const stepMeta = step ? PROJECT_STEPS.find((s) => s.id === step) : undefined;
  if (stepMeta) {
    crumbs.push({ label: "Project", href: routes.project(projectId) });
    crumbs.push({ label: stepMeta.label });
  } else {
    crumbs.push({ label: "Project" });
  }
  return crumbs;
}

/** Breadcrumb trail derived from the current URL. */
export function AppBreadcrumbs() {
  const pathname = usePathname();
  const crumbs = crumbsFor(pathname);
  if (!crumbs.length) return null;

  return (
    <Breadcrumb>
      <BreadcrumbList>
        {crumbs.map((crumb, index) => {
          const last = index === crumbs.length - 1;
          return (
            <Fragment key={`${crumb.label}-${index}`}>
              <BreadcrumbItem className={index === 0 ? "hidden md:inline-flex" : undefined}>
                {last || !crumb.href ? (
                  <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
                ) : (
                  <BreadcrumbLink render={<Link href={crumb.href} />}>{crumb.label}</BreadcrumbLink>
                )}
              </BreadcrumbItem>
              {!last && <BreadcrumbSeparator className={index === 0 ? "hidden md:block" : undefined} />}
            </Fragment>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
