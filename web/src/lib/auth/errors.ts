import { AuthError, isAuthApiError, isAuthRetryableFetchError } from "@supabase/supabase-js";

/**
 * Turn a Supabase auth failure into a message safe to show on the login
 * screen. Deliberately never reveals whether an email address exists.
 */
export function loginErrorMessage(error: unknown): string {
  if (isAuthRetryableFetchError(error)) {
    return "Could not reach the sign-in service. Check your connection and try again.";
  }
  if (error instanceof AuthError) {
    const code = error.code ?? "";
    if (code === "invalid_credentials" || error.status === 400) {
      return "Wrong email or password.";
    }
    if (code === "email_not_confirmed") {
      return "This account has not been activated yet. Ask your administrator.";
    }
    if (code === "user_banned") {
      return "This account has been disabled. Ask your administrator.";
    }
    if (code === "over_request_rate_limit" || error.status === 429) {
      return "Too many sign-in attempts. Wait a few minutes and try again.";
    }
    if (code === "signup_disabled") {
      return "New accounts are created by an administrator.";
    }
    if (isAuthApiError(error) && error.status >= 500) {
      return "The sign-in service is temporarily unavailable. Try again shortly.";
    }
    return "Sign-in failed. Please try again.";
  }
  if (error instanceof TypeError) {
    return "Could not reach the sign-in service. Check your connection and try again.";
  }
  return "Sign-in failed. Please try again.";
}
