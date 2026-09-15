"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { CircleAlert, LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useInsurers } from "@/hooks/use-insurers";
import { useProject } from "@/hooks/use-project";
import { errorMessage, type ProjectState } from "@/lib/api";
import { routes } from "@/lib/navigation";
import {
  POLICY_TYPES,
  POLICY_TYPE_HINTS,
  PROJECT_TYPES,
  applySetup,
  setupDefaults,
  setupSchema,
  type SetupValues,
} from "@/lib/project-schema";
import { cn } from "@/lib/utils";

interface SetupFormProps {
  project: ProjectState;
}

/** Wireframe copy for the two project-type cards. */
const TYPE_CARDS: Record<(typeof PROJECT_TYPES)[number], { title: string; hint: string }> = {
  new: { title: "New business", hint: "Front page: “Credit Insurance Proposals”" },
  renewal: { title: "Renewal", hint: "Compares against the expiring policy" },
};

const LABEL = "mb-1.5 block text-[12.5px] font-medium text-ink-2";

function ErrorText({ message, id }: { message?: string; id: string }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="mt-1.5 text-xs text-destructive">
      {message}
    </p>
  );
}

/**
 * S3 — New project (wireframe): client and reference, the project-type
 * cards, the policy-type chips and the insurers-approached tick list.
 * React Hook Form + zod; validates on blur and on submit. Saving writes
 * the project back and moves to Upload.
 */
export function SetupForm({ project }: SetupFormProps) {
  const router = useRouter();
  const { save } = useProject();
  const { insurers, loading: insurersLoading, stale } = useInsurers();
  const [submitError, setSubmitError] = useState<string | null>(null);

  const form = useForm<SetupValues>({
    resolver: zodResolver(setupSchema),
    defaultValues: useMemo(() => setupDefaults(project), [project]),
    mode: "onBlur",
    reValidateMode: "onChange",
  });
  const { control, register, handleSubmit, setValue, formState } = form;
  const { errors, isDirty, isSubmitting } = formState;

  // useWatch (not watch) so the React Compiler can memoize this component.
  const projectType = useWatch({ control, name: "projectType" });
  const approached = useWatch({ control, name: "approached" });

  // Warn before the tab closes with unsaved edits.
  useEffect(() => {
    if (!isDirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [isDirty]);

  const onSubmit = handleSubmit(async (values) => {
    setSubmitError(null);
    try {
      await save(applySetup(project, values));
      toast.success("Project saved");
      router.push(routes.projectStep(project.id, "upload"));
    } catch (err) {
      setSubmitError(errorMessage(err, "Could not save the project"));
    }
  });

  const errorCount = Object.keys(errors).length;
  const toggleInsurer = (id: string, on: boolean) => {
    const next = on ? [...new Set([...approached, id])] : approached.filter((x) => x !== id);
    setValue("approached", next, { shouldDirty: true, shouldValidate: true });
  };
  const approachedError = (errors.approached as { message?: string } | undefined)?.message;

  return (
    <form onSubmit={onSubmit} noValidate>
      <h1 className="mb-1.5 text-[26px] font-bold tracking-[-0.4px] text-ink">
        {project.clientName ? "Project setup" : "New project"}
      </h1>
      <p className="mb-[26px] text-[13.5px] text-ink-2">Set up the client and choose which insurers were approached.</p>

      {(submitError || errorCount > 0) && (
        <Alert variant="destructive" role="alert" className="mb-5">
          <CircleAlert />
          <AlertTitle>{submitError ? "Could not save" : "Check the highlighted fields"}</AlertTitle>
          <AlertDescription>
            {submitError ?? `${errorCount} ${errorCount === 1 ? "field needs" : "fields need"} attention before you continue.`}
          </AlertDescription>
        </Alert>
      )}

      <div className="grid items-start gap-5 lg:grid-cols-[1.35fr_1fr]">
        {/* ── Client, type, policy ─────────────────────────────────── */}
        <section className="rounded-[14px] border border-line bg-surface p-[26px] shadow-card">
          <div className="mb-6 grid gap-[18px] sm:grid-cols-2">
            <div>
              <label htmlFor="clientName" className={LABEL}>
                Client name
              </label>
              <Input
                id="clientName"
                placeholder="e.g. Aldgate Timber Ltd"
                autoComplete="organization"
                aria-invalid={Boolean(errors.clientName)}
                aria-describedby={errors.clientName ? "clientName-error" : undefined}
                {...register("clientName")}
              />
              <ErrorText id="clientName-error" message={errors.clientName?.message} />
            </div>
            <div>
              <label htmlFor="ref" className={LABEL}>
                Reference
              </label>
              <Input
                id="ref"
                placeholder="e.g. UKCIB-2418"
                className="font-mono"
                autoCapitalize="characters"
                spellCheck={false}
                aria-invalid={Boolean(errors.ref)}
                aria-describedby={errors.ref ? "ref-error" : undefined}
                {...register("ref")}
              />
              <ErrorText id="ref-error" message={errors.ref?.message} />
            </div>
          </div>

          <Controller
            control={control}
            name="projectType"
            render={({ field }) => (
              <div role="radiogroup" aria-label="Project type" onBlur={field.onBlur} className={cn(projectType === "renewal" ? "mb-[18px]" : "mb-6")}>
                <span className="mb-2 block text-[12.5px] font-medium text-ink-2">Project type</span>
                <div className="flex flex-col gap-2.5 sm:flex-row">
                  {PROJECT_TYPES.map((t) => {
                    const on = field.value === t;
                    return (
                      <button
                        key={t}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        onClick={() => field.onChange(t)}
                        className={cn(
                          "flex-1 rounded-[10px] border-[1.5px] px-4 py-3.5 text-left transition-colors",
                          on ? "border-primary bg-accent" : "border-line bg-surface hover:border-ink-3",
                        )}
                      >
                        <div className="mb-0.5 text-sm font-semibold text-ink">{TYPE_CARDS[t].title}</div>
                        <div className="text-xs text-ink-2">{TYPE_CARDS[t].hint}</div>
                      </button>
                    );
                  })}
                </div>
                <ErrorText id="projectType-error" message={errors.projectType?.message} />
              </div>
            )}
          />

          {projectType === "renewal" && (
            <p className="mb-6 rounded-[7px] bg-warn-soft px-3 py-[9px] text-[12.5px] text-warn">
              Renewal selected — the expiring policy must be uploaded on the next step as the comparison baseline.
            </p>
          )}

          <Controller
            control={control}
            name="policyType"
            render={({ field }) => (
              <div role="radiogroup" aria-label="Policy type" onBlur={field.onBlur}>
                <span className="mb-2 block text-[12.5px] font-medium text-ink-2">
                  Policy type <span className="font-normal text-ink-3">— applies to every insurer column, overridable at review</span>
                </span>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {POLICY_TYPES.map((pt) => {
                    const on = field.value === pt;
                    return (
                      <button
                        key={pt}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        title={POLICY_TYPE_HINTS[pt]}
                        onClick={() => field.onChange(pt)}
                        className={cn(
                          "rounded-[9px] border-[1.5px] px-2 py-[11px] text-center text-[13px] transition-colors",
                          on ? "border-primary bg-accent font-semibold text-primary" : "border-line bg-surface font-medium text-ink-2 hover:border-ink-3",
                        )}
                      >
                        {pt}
                      </button>
                    );
                  })}
                </div>
                <ErrorText id="policyType-error" message={errors.policyType?.message} />
              </div>
            )}
          />
        </section>

        {/* ── Insurers approached ──────────────────────────────────── */}
        <section className="rounded-[14px] border border-line bg-surface p-[26px] shadow-card">
          <div className="mb-1 flex items-center justify-between gap-2.5">
            <span className="text-[12.5px] font-medium whitespace-nowrap text-ink-2" id="approached-label">
              Insurers approached
            </span>
            <span className="shrink-0 rounded-[5px] bg-accent px-2 py-0.5 font-mono text-[11px] font-medium whitespace-nowrap text-primary">
              {approached.length} of {insurers.length}
            </span>
          </div>
          <p className="mb-3.5 text-xs text-ink-3">
            From the standing list — up to {insurers.length}. Ticked insurers with no quote uploaded show as declined on the
            presentation.
          </p>
          {stale && <p className="mb-3 text-xs text-warn">Showing the built-in list (live list unavailable).</p>}
          <Controller
            control={control}
            name="approached"
            render={({ field }) =>
              insurersLoading ? (
                <div className="grid gap-2 sm:grid-cols-2">
                  {Array.from({ length: 8 }).map((_, i) => (
                    <Skeleton key={i} className="h-11" />
                  ))}
                </div>
              ) : (
                <div
                  role="group"
                  aria-labelledby="approached-label"
                  aria-describedby={approachedError ? "approached-error" : undefined}
                  className="grid gap-2 sm:grid-cols-2"
                  onBlur={field.onBlur}
                >
                  {insurers.map((ins) => {
                    const checked = approached.includes(ins.id);
                    return (
                      <label
                        key={ins.id}
                        className={cn(
                          "flex cursor-pointer items-center gap-2.5 rounded-[9px] border px-[13px] py-[11px] transition-colors has-focus-visible:ring-3 has-focus-visible:ring-accent",
                          checked ? "border-primary bg-accent" : "border-line bg-surface hover:border-ink-3",
                        )}
                      >
                        <input
                          type="checkbox"
                          className="sr-only"
                          checked={checked}
                          onChange={(e) => toggleInsurer(ins.id, e.target.checked)}
                        />
                        <span
                          aria-hidden
                          className={cn(
                            "grid size-[18px] shrink-0 place-items-center rounded-[5px] border-[1.5px] text-[11px] font-bold text-white",
                            checked ? "border-primary bg-primary" : "border-[#c5cdd8] bg-white",
                          )}
                        >
                          {checked ? "✓" : ""}
                        </span>
                        <span className="min-w-0 truncate text-[13.5px] font-medium text-ink">{ins.name}</span>
                        {ins.debt_collection === "included" && (
                          <span
                            className="ml-auto rounded bg-set-soft px-1.5 py-0.5 font-mono text-[10px] font-medium text-set"
                            title="Debt collection support included by insurer rule"
                          >
                            DEBT INCL
                          </span>
                        )}
                      </label>
                    );
                  })}
                </div>
              )
            }
          />
          <ErrorText id="approached-error" message={approachedError} />
        </section>
      </div>

      <div className="mt-5 flex flex-col-reverse gap-2.5 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" nativeButton={false} render={<Link href={routes.projects} />} disabled={isSubmitting}>
          Cancel
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting && <LoaderCircle className="animate-spin" />}
          {isSubmitting ? "Saving…" : "Continue to upload →"}
        </Button>
      </div>
    </form>
  );
}
