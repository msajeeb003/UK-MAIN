import Link from "next/link";

import { Button } from "@/components/ui/button";
import { routes } from "@/lib/navigation";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center">
      <p className="label-mono">404</p>
      <h1 className="text-2xl font-semibold tracking-tight">Page not found</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        The page you were looking for does not exist or has moved.
      </p>
      <Button nativeButton={false} render={<Link href={routes.projects} />}>
        Go to projects
      </Button>
    </div>
  );
}
