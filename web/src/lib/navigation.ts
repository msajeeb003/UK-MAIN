/**
 * Route table for the app. The screen order mirrors the approved wireframe:
 * Login -> Projects -> Setup -> Upload -> Review -> Credit limits ->
 * Recommendation -> Export.
 */
export type ProjectStepId =
  | "setup"
  | "upload"
  | "review"
  | "limits"
  | "recommend"
  | "export";

export interface ProjectStep {
  id: ProjectStepId;
  label: string;
  /** Short line shown under the label in the stepper / page header. */
  hint: string;
}

export const PROJECT_STEPS: readonly ProjectStep[] = [
  { id: "setup", label: "Setup", hint: "Client, reference and insurers approached" },
  { id: "upload", label: "Upload", hint: "Quotes, expiring policy and credit-limit schedules" },
  { id: "review", label: "Review", hint: "Check every extracted value against its source" },
  { id: "limits", label: "Credit limits", hint: "Buyer limits required vs offered" },
  { id: "recommend", label: "Recommendation", hint: "Pick the recommended quote and reasons" },
  { id: "export", label: "Generate", hint: "Confirm key values and export the presentation" },
] as const;

export const FIRST_STEP: ProjectStepId = "setup";

export const routes = {
  home: "/",
  login: "/login",
  projects: "/projects",
  project: (projectId: string) => `/projects/${encodeURIComponent(projectId)}`,
  projectStep: (projectId: string, step: ProjectStepId) =>
    `/projects/${encodeURIComponent(projectId)}/${step}`,
} as const;

export function isProjectStepId(value: string): value is ProjectStepId {
  return PROJECT_STEPS.some((s) => s.id === value);
}

export function stepIndex(step: ProjectStepId): number {
  return PROJECT_STEPS.findIndex((s) => s.id === step);
}

/** Parse `/projects/<id>/<step>` out of a pathname, if it is one. */
export function parseProjectPath(pathname: string): {
  projectId: string | null;
  step: ProjectStepId | null;
} {
  const match = pathname.match(/^\/projects\/([^/]+)(?:\/([^/]+))?/);
  if (!match) return { projectId: null, step: null };
  const projectId = decodeURIComponent(match[1]);
  const step = match[2] && isProjectStepId(match[2]) ? match[2] : null;
  return { projectId, step };
}
