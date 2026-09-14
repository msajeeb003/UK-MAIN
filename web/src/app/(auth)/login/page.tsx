import { CircleAlert } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";

import { LoginForm } from "@/components/auth/login-form";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { isSupabaseConfigured } from "@/lib/env";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
        <p className="text-sm text-muted-foreground">Use the account your administrator set up.</p>
      </div>

      {isSupabaseConfigured() ? (
        // useSearchParams() needs a Suspense boundary for static rendering.
        <Suspense fallback={<Skeleton className="h-64 w-full" />}>
          <LoginForm />
        </Suspense>
      ) : (
        <Alert variant="destructive" role="alert">
          <CircleAlert />
          <AlertTitle>Sign-in is not configured</AlertTitle>
          <AlertDescription>
            The app needs NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY. See
            web/.env.example.
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
