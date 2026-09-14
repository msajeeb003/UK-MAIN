"use client";

import { CircleAlert, Eye, EyeOff, LoaderCircle } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useId, useState, type FormEvent } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSession } from "@/hooks/use-session";
import { loginErrorMessage } from "@/lib/auth/errors";
import { routes } from "@/lib/navigation";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function safeNext(value: string | null): string {
  return value && value.startsWith("/") && !value.startsWith("//") ? value : routes.projects;
}

/**
 * S1 Login (BRD 2.10): email + password via Supabase Auth. There is no
 * sign-up, password-reset or magic-link path on purpose: accounts are
 * created and reset by an administrator.
 */
export function LoginForm() {
  const { login } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const errorId = useId();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [fieldError, setFieldError] = useState<{ email?: string; password?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const validate = (): boolean => {
    const next: typeof fieldError = {};
    if (!EMAIL_RE.test(email.trim())) next.email = "Enter a valid email address.";
    if (!password) next.password = "Enter your password.";
    setFieldError(next);
    return !next.email && !next.password;
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    if (!validate()) return;
    setSubmitting(true);
    try {
      await login(email.trim().toLowerCase(), password);
      setPassword("");
      router.replace(safeNext(searchParams.get("next")));
      router.refresh(); // let the proxy / server components see the new cookies
    } catch (err) {
      setError(loginErrorMessage(err));
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={onSubmit} className="space-y-5" noValidate aria-describedby={error ? errorId : undefined}>
      {error && (
        <Alert variant="destructive" id={errorId} role="alert" aria-live="assertive">
          <CircleAlert />
          <AlertTitle>Sign-in failed</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="you@brokerage.co.uk"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            if (fieldError.email) setFieldError((f) => ({ ...f, email: undefined }));
          }}
          aria-invalid={Boolean(fieldError.email)}
          aria-describedby={fieldError.email ? "email-error" : undefined}
          disabled={submitting}
          required
          autoFocus
        />
        {fieldError.email && (
          <p id="email-error" className="text-xs text-destructive">
            {fieldError.email}
          </p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="password">Password</Label>
        <div className="relative">
          <Input
            id="password"
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              if (fieldError.password) setFieldError((f) => ({ ...f, password: undefined }));
            }}
            aria-invalid={Boolean(fieldError.password)}
            aria-describedby={fieldError.password ? "password-error" : undefined}
            disabled={submitting}
            required
            className="pr-10"
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? "Hide password" : "Show password"}
            aria-pressed={showPassword}
            tabIndex={-1}
            className="absolute inset-y-0 right-0 grid w-10 place-items-center text-muted-foreground hover:text-foreground"
          >
            {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>
        {fieldError.password && (
          <p id="password-error" className="text-xs text-destructive">
            {fieldError.password}
          </p>
        )}
      </div>

      <Button type="submit" size="lg" className="w-full" disabled={submitting}>
        {submitting && <LoaderCircle className="animate-spin" data-icon="inline-start" />}
        {submitting ? "Signing in…" : "Sign in"}
      </Button>

      <p className="text-center text-xs text-muted-foreground">
        Accounts are created by an administrator. There is no self-registration. Forgotten your
        password? Ask your administrator to reset it.
      </p>
    </form>
  );
}
