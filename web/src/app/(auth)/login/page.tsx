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
    <div>
      <h2 className="mb-1.5 text-[22px] font-semibold text-ink">Sign in</h2>
      <p className="mb-7 text-[13.5px] text-ink-2">Use your brokerage email account.</p>

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
