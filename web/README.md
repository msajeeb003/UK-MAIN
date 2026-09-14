# Quote Comparison Tool — web (Next.js)

The Next.js frontend for the Insurance Quote Comparison Tool. It talks to the
FastAPI backend in `../backend` through a same-origin `/api` proxy, so the
backend's cookie session + CSRF model works unchanged.

## Stack

| Concern      | Choice                                                   |
| ------------ | -------------------------------------------------------- |
| Framework    | Next.js 16 (App Router, Turbopack, TypeScript strict)    |
| Styling      | Tailwind CSS v4, theme tokens copied from the wireframe  |
| Components   | shadcn/ui (`src/components/ui`, Base UI primitives)      |
| Icons        | lucide-react                                             |
| Toasts       | sonner                                                   |
| Fonts        | Plus Jakarta Sans + IBM Plex Mono via `next/font`        |

## Run it

```bash
cd web
npm install
cp .env.example .env.local      # optional; defaults proxy to http://127.0.0.1:8000
npm run dev                     # http://localhost:3000
```

Start the backend separately from the repo root:

```bash
uvicorn app.main:app --app-dir backend --port 8000
```

Checks:

```bash
npm run lint        # eslint
npm run typecheck   # next typegen + tsc --noEmit
npm run build       # production build
```

### Dev server shows 404 for a route that exists

On a slow or external drive (Next prints "Slow filesystem detected"), Turbopack's
first scan can miss the nested `projects/[projectId]/*` routes, so the first
visit returns the 404 page. Re-save (touch) any file under that folder, or
restart `npm run dev`; the route is picked up immediately. Production builds
are unaffected. Keeping the checkout on a local drive avoids it entirely.

## Layout

```
src/
├── app/
│   ├── layout.tsx              Root: fonts, metadata, providers, toaster
│   ├── page.tsx                → /projects
│   ├── (auth)/                 Login frame (hero + form), no sidebar
│   │   └── login/
│   ├── (app)/                  Signed-in shell: sidebar + topbar
│   │   ├── layout.tsx
│   │   ├── projects/           Project list
│   │   └── projects/[projectId]/
│   │       ├── layout.tsx      Project stepper
│   │       └── setup|upload|review|limits|recommend|export/
│   ├── error.tsx · not-found.tsx
│   └── globals.css             Theme tokens (light + dark) mapped onto shadcn vars
├── proxy.ts                    Edge guard: no session cookie → /login
├── components/
│   ├── ui/                     shadcn/ui primitives (generated; safe to re-add)
│   ├── layout/                 AppShell, AppSidebar, Topbar, Breadcrumbs, UserMenu,
│   │                           ProjectStepper, PageHeader, Logo
│   ├── providers/              AppProviders, SessionProvider, AuthGate
│   ├── auth/                   LoginForm
│   ├── upload/                 UploadScreen, UploadDropzone, FileList (S4)
│   ├── review/                 ReviewScreen, ComparisonGrid, GridCell, ConfirmBar, SourceViewer (split panel + modal) (S5)
│   ├── limits/                 LimitsScreen, LimitsGrid, LimitCell (S6)
│   ├── recommend/              RecommendScreen, MiniGrid (S7)
│   ├── projects/               ProjectsList
│   └── shared/                 StepPlaceholder (scaffold body for each step)
├── hooks/                      useSession, useProject, useInsurers, useUploadQueue, useReviewDraft, useIsMobile
└── lib/
    ├── api/
    │   ├── client.ts           fetch wrapper: base URL, JSON, CSRF header, ApiError,
    │   │                       timeouts, 401 → session-expired hook
    │   ├── endpoints.ts        authApi · insurersApi · projectsApi · documentsApi ·
    │   │                       extractionApi · presentationApi · systemApi
    │   └── types.ts            Wire types mirroring backend/app/models
    ├── navigation.ts           Route table + the 6 project steps
    ├── projects.ts · project-schema.ts   S2 status rules · S3 form schema (zod)
    ├── fields.ts · uploads.ts  BRD 16-row field list · S4 upload rules + applyExtraction
    ├── review.ts               S5 cell provenance, blank-vs-zero, edits, tick-order columns + declined, review gate
    ├── limits.ts               S6 buyer rows, £ normalisation, totals, add/remove row & column
    ├── recommend.ts            S7 recommended insurer, fixed-wording merge, reasons points
    ├── env.ts                  NEXT_PUBLIC_* config
    └── download.ts             saveBlob() for exports
```

## How auth works (S1 — Supabase Auth)

Sign-in is email + password against **Supabase Auth**; there is no sign-up,
password-reset or magic-link route on purpose (BRD 2.10: accounts are created
by an administrator).

1. `proxy.ts` runs on every page request: it refreshes the Supabase session
   cookies if the access token expired, verifies the token signature
   (`getClaims()`), sends signed-out users to `/login?next=…` and signed-in
   users away from `/login`. Without Supabase env vars, `/login` shows a
   configuration notice and everything else redirects there.
2. `LoginForm` calls `supabase.auth.signInWithPassword`. Errors are mapped
   to safe messages in `lib/auth/errors.ts` (wrong credentials, disabled or
   unactivated account, rate limit, service unreachable) and never reveal
   whether an email exists.
3. `SessionProvider` keeps the user in sync via `onAuthStateChange` (token
   refresh, sign-out in another tab) and hands the API client a token
   provider. The client sends `Authorization: Bearer <access token>` on
   every backend call; FastAPI verifies it locally (see `docs/AUTH.md`).
4. A 401/403 from the backend signs the user out locally and returns them to
   `/login` with a toast.

### Accounts (admin only)

```bash
cd web
npm run users -- create broker@ukcib.co.uk "Sam Broker"   # prints a temp password once
npm run users -- reset  broker@ukcib.co.uk                 # new temp password, signs out everywhere
npm run users -- disable broker@ukcib.co.uk                # or enable
npm run users -- list
```

Needs `SUPABASE_SERVICE_ROLE_KEY` (operator machine only) in `web/.env.local`.
In the Supabase dashboard also turn **off** "Allow new users to sign up"
(Authentication → Sign In / Providers → Email) so the public anon key cannot
be used to self-register from outside this app. Optional: set the Auth
session inactivity timeout and rate limits there to match `docs/AUTH.md`.

Backend side: set `SUPABASE_URL` and (for HS256 projects) `SUPABASE_JWT_SECRET`
in the repo-root `.env` so FastAPI accepts the tokens.

## Adding a screen

- Route: add `page.tsx` under `src/app/(app)/...`; it renders inside the shell.
- Backend call: add a typed function to `src/lib/api/endpoints.ts` (and the
  response type to `types.ts`). Components import from `@/lib/api`.
- UI primitive: `npx shadcn@latest add <name>`; the theme applies automatically.
- Theme colours beyond shadcn's set are available as Tailwind classes:
  `ok`, `ok-soft`, `warn`, `warn-soft`, `set`, `set-soft`, `rec`, `ink`,
  `ink-2`, `ink-3`, `line`, `line-2`, `panel`; shadows `shadow-card`,
  `shadow-float`, `shadow-modal`; the `label-mono` utility for mono caps labels.
