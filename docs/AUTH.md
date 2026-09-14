# Authentication — production hardening

Proportionate for 3–4 internal users with identical permissions. Email +
password, HttpOnly + SameSite=Lax session cookie, CSRF on writes, scrypt
password hashes (only SHA-256 token hashes stored server-side).

## Login lockout / throttle

After `LOGIN_MAX_ATTEMPTS` failed logins (default 5), further attempts are
blocked for `LOGIN_LOCKOUT_MINUTES` (default 15) — tracked **per account** and
**per source IP** (a lock on either blocks the attempt). Locking is stored in
the DB, so it holds across all gunicorn workers. A locked login returns
**HTTP 429** with a `Retry-After` header.

**Unlock paths:**
- **Automatic** after the cooldown elapses.
- **Admin, immediately:**
  ```bash
  python -m app.manage unlock broker@ukcib.co.uk    # clear an account lock
  python -m app.manage unlock-ip 203.0.113.4        # clear an IP lock
  ```
- A password reset also clears the account lock.

## Password reset (admin-initiated)

No email infrastructure is used (undesirable for a tiny internal team and an
extra attack surface). Resets are **admin-initiated via the manage CLI**:

```bash
python -m app.manage reset-password broker@ukcib.co.uk
# prints a strong temporary password ONCE; convey it securely
python -m app.manage set-password broker@ukcib.co.uk
# interactive; the user (or admin) sets a chosen password
```

`reset-password` generates a policy-compliant temporary password, signs the
user out of all sessions, and clears any lockout. The user should then set
their own password with `set-password`. (With identical permissions across the
team, resets are an out-of-band operator action rather than an in-app peer
action, which avoids one user resetting another's — including the admin's —
credentials.)

## Password policy

Enforced at set, reset and seed time, and at startup (fatal in production):
**≥ 12 characters, not a known weak/default, a reasonable variety of
characters** (`app/core/startup.py::password_problem`).

## Session expiry & inactivity

- **Absolute expiry:** `SESSION_TTL_HOURS` (default 72). Enforced in the auth
  query and swept by the background cleanup.
- **Inactivity timeout:** `INACTIVITY_TIMEOUT_MINUTES` (default 60). Each
  authenticated request refreshes `last_seen` (throttled to ≤ once/minute); a
  session idle longer than the timeout is rejected on the next request and
  removed by the background sweep. Sessions from before this feature
  (`last_seen = 0`) are grandfathered — treated as active and stamped on next
  use, so the change does not force a mass logout.
- The frontend already routes a 401 to the sign-in screen, so an
  inactivity logout appears as "please sign in again".

## MFA — decision (recorded)

**Decision: not implemented for the pilot.** For 3–4 named internal users on
an internal tool with identical permissions, MFA is disproportionate to the
threat, and adds enrolment/recovery burden and (for TOTP) either a dependency
or an email/SMS channel we deliberately avoid. The existing controls — strong
password policy, per-account/per-IP lockout, CSRF, HttpOnly+Secure+SameSite
cookies, short inactivity timeout, no self-registration — are the proportionate
posture.

**Revisit MFA if:** the user base grows beyond a handful, any external/partner
access is added, or the client's own policy requires it. TOTP (authenticator
app) would be the first choice — no SMS, minimal infra — layered onto the
existing login without changing the session model.

## Supabase Auth (Next.js frontend, `web/`)

The Next.js app signs users in with **Supabase Auth** (email + password) and
calls this API with `Authorization: Bearer <access token>`; the classic SPA
keeps using the cookie session above. Both credentials are accepted by
`require_user` (`app/core/auth.py`):

- A Bearer header is **authoritative** — it is verified and there is no
  fall-back to the cookie, so a forged header can never ride on a cookie
  session. The CSRF middleware skips bearer requests for the same reason
  (a cross-site page cannot attach `Authorization` without a CORS preflight,
  which this API does not grant).
- Verification is local (`app/core/supabase_auth.py`, PyJWT): HS256 with
  `SUPABASE_JWT_SECRET`, or ES256/RS256 against the project JWKS at
  `SUPABASE_URL/auth/v1/.well-known/jwks.json` (cached). Required: `exp`,
  `sub`, `email`, `role == authenticated`, `aud == authenticated`, and the
  issuer `SUPABASE_URL/auth/v1`. Both settings empty = bearer auth disabled.
- Audit entries record the Supabase email as the actor.

**No self-registration.** The app has no sign-up, reset or magic-link path.
Accounts are managed by an administrator with the service-role key
(`cd web && npm run users -- create|reset|disable|enable|list`), which prints
a temporary password once. Also switch **off** "Allow new users to sign up"
in the Supabase dashboard (Authentication → Sign In / Providers → Email) so
the public anon key cannot be used to register from outside the app.

**Sessions.** Supabase issues a short-lived access token (default 1 h) plus a
rotating refresh token, stored in cookies by `@supabase/ssr`. The Next.js
proxy refreshes them on every page request and verifies the token signature;
the browser client refreshes in the background. Sign-out revokes all of the
user's sessions; `users reset`/`disable` also sign the user out everywhere.
Inactivity timeout and lockout are Supabase-side settings (Auth → Rate
Limits / Sessions) rather than the backend values above.

Covered by `backend/tests/test_supabase_auth.py`.

## Verify

- 5 wrong logins → the next is 429 with `Retry-After`; `manage unlock` clears
  it; the cooldown also clears it automatically.
- A session idle past `INACTIVITY_TIMEOUT_MINUTES` → next request is a 401.
- `manage reset-password` prints a temp password, invalidates old sessions,
  and the temp password satisfies the policy.
- Covered by `backend/tests/test_auth_hardening.py`.
