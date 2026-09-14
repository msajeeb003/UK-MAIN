/**
 * S3 "New project" form contract (BRD 2.1): client name and reference,
 * new business vs renewal, one of four policy types, insurers approached.
 */
import { z } from "zod";

import type { ProjectState } from "@/lib/api/types";

export const POLICY_TYPES = ["Whole Turnover", "Top-Up", "Single Risk", "Gap-Fill"] as const;
export type PolicyType = (typeof POLICY_TYPES)[number];

export const POLICY_TYPE_HINTS: Record<PolicyType, string> = {
  "Whole Turnover": "Covers the client's full insurable turnover",
  "Top-Up": "Adds cover above a primary policy's limits",
  "Single Risk": "One buyer or contract only",
  "Gap-Fill": "Fills specific gaps in existing cover",
};

export const PROJECT_TYPES = ["new", "renewal"] as const;
export type ProjectType = (typeof PROJECT_TYPES)[number];

export const PROJECT_TYPE_META: Record<ProjectType, { label: string; hint: string }> = {
  new: { label: "New business", hint: "Front page: “Credit Insurance Proposals”" },
  renewal: { label: "Renewal", hint: "Front page: “Renewal of Credit Insurance”; compares against the expiring policy" },
};

export const setupSchema = z.object({
  clientName: z
    .string()
    .trim()
    .min(2, "Enter the client's name (at least 2 characters).")
    .max(200, "Client name is too long (200 characters max)."),
  ref: z
    .string()
    .trim()
    .min(1, "Enter the project reference.")
    .max(60, "Reference is too long (60 characters max)."),
  projectType: z.enum(PROJECT_TYPES, { error: "Choose new business or renewal." }),
  policyType: z.enum(POLICY_TYPES, { error: "Choose one of the four policy types." }),
  approached: z
    .array(z.string().min(1))
    .min(1, "Tick at least one insurer that was approached."),
});

export type SetupValues = z.infer<typeof setupSchema>;

function isPolicyType(value: unknown): value is PolicyType {
  return typeof value === "string" && (POLICY_TYPES as readonly string[]).includes(value);
}

/** Form defaults from a stored project (tolerant of partial / older shapes). */
export function setupDefaults(p: ProjectState): SetupValues {
  return {
    clientName: typeof p.clientName === "string" ? p.clientName : "",
    ref: typeof p.ref === "string" ? p.ref : "",
    projectType: p.projectType === "renewal" ? "renewal" : "new",
    policyType: isPolicyType(p.policyType) ? p.policyType : "Whole Turnover",
    approached: Array.isArray(p.approached)
      ? p.approached.filter((x): x is string => typeof x === "string")
      : [],
  };
}

/** Merge validated form values back into the stored project. */
export function applySetup(p: ProjectState, values: SetupValues): ProjectState {
  return {
    ...p,
    clientName: values.clientName,
    ref: values.ref,
    projectType: values.projectType,
    policyType: values.policyType,
    approached: values.approached,
    updated: Date.now(),
  };
}
