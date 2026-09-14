import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PROJECT_STEPS, routes, stepIndex, type ProjectStepId } from "@/lib/navigation";

interface StepPlaceholderProps {
  projectId: string;
  step: ProjectStepId;
}

/**
 * Scaffold page body for a project step. Each step's real screen replaces
 * this component; the header, numbering and next/previous wiring stay.
 */
export function StepPlaceholder({ projectId, step }: StepPlaceholderProps) {
  const index = stepIndex(step);
  const meta = PROJECT_STEPS[index];
  const previous = PROJECT_STEPS[index - 1];
  const next = PROJECT_STEPS[index + 1];

  return (
    <>
      <PageHeader
        eyebrow={`Step ${index + 1} of ${PROJECT_STEPS.length}`}
        title={meta.label}
        description={meta.hint}
      />
      <Card>
        <CardHeader>
          <CardTitle>{meta.label} screen</CardTitle>
          <CardDescription>
            This step is scaffolded and routed. Its content is built against the approved
            wireframe in a follow-up.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {previous && (
            <Button
              variant="outline"
              nativeButton={false}
              render={<Link href={routes.projectStep(projectId, previous.id)} />}
            >
              Back to {previous.label}
            </Button>
          )}
          {next && (
            <Button nativeButton={false} render={<Link href={routes.projectStep(projectId, next.id)} />}>
              Continue to {next.label}
              <ArrowRight data-icon="inline-end" />
            </Button>
          )}
        </CardContent>
      </Card>
    </>
  );
}
