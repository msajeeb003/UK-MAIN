"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowRight, CircleAlert, LoaderCircle, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";

import { PageHeader } from "@/components/layout/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
  FieldTitle,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Skeleton } from "@/components/ui/skeleton";
import { useInsurers } from "@/hooks/use-insurers";
import { useProject } from "@/hooks/use-project";
import { errorMessage, type ProjectState } from "@/lib/api";
import { PROJECT_STEPS, routes } from "@/lib/navigation";
import {
  POLICY_TYPES,
  POLICY_TYPE_HINTS,
  PROJECT_TYPES,
  PROJECT_TYPE_META,
  applySetup,
  setupDefaults,
  setupSchema,
  type SetupValues,
} from "@/lib/project-schema";
import { cn } from "@/lib/utils";

interface SetupFormProps {
  project: ProjectState;
}

/**
 * S3 — New project / setup (BRD 2.1). React Hook Form + zod; every field
 * validates on blur and again on submit, and the first invalid field is
 * focused. Saving writes the whole project state back and moves to Upload.
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

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-6">
      <PageHeader
        eyebrow={`Step 1 of ${PROJECT_STEPS.length}`}
        title={project.clientName ? project.clientName : "New project"}
        description="Set up the client and choose which insurers were approached."
      />

      {(submitError || errorCount > 0) && (
        <Alert variant="destructive" role="alert">
          <CircleAlert />
          <AlertTitle>{submitError ? "Could not save" : "Check the highlighted fields"}</AlertTitle>
          <AlertDescription>
            {submitError ??
              `${errorCount} ${errorCount === 1 ? "field needs" : "fields need"} attention before you continue.`}
          </AlertDescription>
        </Alert>
      )}

      <div className="grid items-start gap-6 lg:grid-cols-[1.35fr_1fr]">
        {/* ── Client, type, policy ─────────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle>Client project</CardTitle>
            <CardDescription>Client name and reference, and whether this is new business or a renewal.</CardDescription>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field data-invalid={Boolean(errors.clientName) || undefined}>
                  <FieldLabel htmlFor="clientName">Client name</FieldLabel>
                  <Input
                    id="clientName"
                    placeholder="e.g. Aldgate Timber Ltd"
                    autoComplete="organization"
                    aria-invalid={Boolean(errors.clientName)}
                    {...register("clientName")}
                  />
                  <FieldError errors={[errors.clientName]} />
                </Field>
                <Field data-invalid={Boolean(errors.ref) || undefined}>
                  <FieldLabel htmlFor="ref">Reference</FieldLabel>
                  <Input
                    id="ref"
                    placeholder="e.g. UKCIB-2418"
                    className="font-mono"
                    autoCapitalize="characters"
                    spellCheck={false}
                    aria-invalid={Boolean(errors.ref)}
                    {...register("ref")}
                  />
                  <FieldError errors={[errors.ref]} />
                </Field>
              </div>

              <Controller
                control={control}
                name="projectType"
                render={({ field }) => (
                  <FieldSet data-invalid={Boolean(errors.projectType) || undefined}>
                    <FieldLegend>Project type</FieldLegend>
                    <FieldDescription>Sets the front-page title of the presentation.</FieldDescription>
                    <RadioGroup
                      value={field.value}
                      onValueChange={(v) => field.onChange(v)}
                      onBlur={field.onBlur}
                      aria-invalid={Boolean(errors.projectType)}
                      className="grid gap-3 sm:grid-cols-2"
                    >
                      {PROJECT_TYPES.map((t) => (
                        <FieldLabel key={t} htmlFor={`projectType-${t}`}>
                          <Field orientation="horizontal">
                            <FieldContent>
                              <FieldTitle>{PROJECT_TYPE_META[t].label}</FieldTitle>
                              <FieldDescription>{PROJECT_TYPE_META[t].hint}</FieldDescription>
                            </FieldContent>
                            <RadioGroupItem value={t} id={`projectType-${t}`} aria-label={PROJECT_TYPE_META[t].label} />
                          </Field>
                        </FieldLabel>
                      ))}
                    </RadioGroup>
                    <FieldError errors={[errors.projectType]} />
                  </FieldSet>
                )}
              />

              {projectType === "renewal" && (
                <Alert className="border-warn/30 bg-warn-soft text-warn [&>svg]:text-warn">
                  <TriangleAlert />
                  <AlertDescription className="text-warn">
                    Renewal selected: the expiring policy must be uploaded on the next step as the
                    comparison baseline.
                  </AlertDescription>
                </Alert>
              )}

              <Controller
                control={control}
                name="policyType"
                render={({ field }) => (
                  <FieldSet data-invalid={Boolean(errors.policyType) || undefined}>
                    <FieldLegend>Policy type</FieldLegend>
                    <FieldDescription>
                      Applies to every insurer column; can be overridden per insurer at review.
                    </FieldDescription>
                    <RadioGroup
                      value={field.value}
                      onValueChange={(v) => field.onChange(v)}
                      onBlur={field.onBlur}
                      aria-invalid={Boolean(errors.policyType)}
                      className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
                    >
                      {POLICY_TYPES.map((pt) => (
                        <FieldLabel key={pt} htmlFor={`policyType-${pt}`}>
                          <Field orientation="horizontal">
                            <FieldContent>
                              <FieldTitle>{pt}</FieldTitle>
                              <FieldDescription className="text-xs">{POLICY_TYPE_HINTS[pt]}</FieldDescription>
                            </FieldContent>
                            <RadioGroupItem value={pt} id={`policyType-${pt}`} aria-label={pt} />
                          </Field>
                        </FieldLabel>
                      ))}
                    </RadioGroup>
                    <FieldError errors={[errors.policyType]} />
                  </FieldSet>
                )}
              />
            </FieldGroup>
          </CardContent>
        </Card>

        {/* ── Insurers approached ──────────────────────────────────── */}
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1.5">
                <CardTitle>Insurers approached</CardTitle>
                <CardDescription>
                  From the standing list. Ticked insurers with no quote uploaded are named as
                  declined on the presentation.
                </CardDescription>
              </div>
              <Badge variant="secondary" className="shrink-0 font-mono">
                {approached.length} of {insurers.length}
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            <Controller
              control={control}
              name="approached"
              render={({ field }) => (
                <FieldSet data-invalid={Boolean(errors.approached) || undefined}>
                  <div className="mb-3 flex items-center gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      onClick={() =>
                        setValue("approached", insurers.map((i) => i.id), { shouldDirty: true, shouldValidate: true })
                      }
                      disabled={insurersLoading || approached.length === insurers.length}
                    >
                      Select all
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      onClick={() => setValue("approached", [], { shouldDirty: true, shouldValidate: true })}
                      disabled={!approached.length}
                    >
                      Clear
                    </Button>
                    {stale && (
                      <span className="ml-auto text-xs text-warn">Showing the built-in list (live list unavailable)</span>
                    )}
                  </div>
                  {insurersLoading ? (
                    <div className="grid gap-2 sm:grid-cols-2">
                      {Array.from({ length: 8 }).map((_, i) => (
                        <Skeleton key={i} className="h-11" />
                      ))}
                    </div>
                  ) : (
                    <div
                      role="group"
                      aria-label="Insurers approached"
                      data-invalid={Boolean(errors.approached) || undefined}
                      className="grid gap-2 sm:grid-cols-2"
                      onBlur={field.onBlur}
                    >
                      {insurers.map((ins) => {
                        const checked = approached.includes(ins.id);
                        return (
                          <FieldLabel key={ins.id} htmlFor={`ins-${ins.id}`}>
                            <Field orientation="horizontal" className={cn("items-center", checked && "border-primary/40")}>
                              <Checkbox
                                id={`ins-${ins.id}`}
                                aria-label={ins.name}
                                checked={checked}
                                onCheckedChange={(on) => toggleInsurer(ins.id, Boolean(on))}
                              />
                              <FieldContent>
                                <FieldTitle className="text-[13.5px]">{ins.name}</FieldTitle>
                              </FieldContent>
                              {ins.debt_collection === "included" && (
                                <span
                                  className="label-mono rounded bg-set-soft px-1.5 py-0.5 text-[10px] text-set"
                                  title="Debt collection support included by insurer rule (BRD 2.4)"
                                >
                                  Debt incl
                                </span>
                              )}
                            </Field>
                          </FieldLabel>
                        );
                      })}
                    </div>
                  )}
                  <FieldError errors={[errors.approached as { message?: string } | undefined]} className="mt-3" />
                </FieldSet>
              )}
            />
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button
          type="button"
          variant="outline"
          nativeButton={false}
          render={<Link href={routes.projects} />}
          disabled={isSubmitting}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? (
            <LoaderCircle className="animate-spin" data-icon="inline-start" />
          ) : null}
          {isSubmitting ? "Saving…" : "Save and continue to upload"}
          {!isSubmitting && <ArrowRight data-icon="inline-end" />}
        </Button>
      </div>
    </form>
  );
}
