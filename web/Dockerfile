# Next.js frontend image (standalone output). Talks to the backend
# server-side through BACKEND_URL (the /api rewrite), so only this
# container needs to be public.
#
#   docker build -t quote-tool-web \
#     --build-arg NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co \
#     --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key> web
#
# NEXT_PUBLIC_* values and BACKEND_URL are all baked in at build time. The
# NEXT_PUBLIC_* ones are public by design; BACKEND_URL is a private address
# on the container network rather than a secret.

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_API_BASE_URL=/api
# next.config.ts reads BACKEND_URL when the config is evaluated, and with
# output: "standalone" that happens at BUILD time: the /api rewrite
# destination is baked into required-server-files.json. Supplying it only
# at runtime is too late, so it has to be a build argument as well.
ARG BACKEND_URL=http://backend:8000
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY \
    NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL \
    BACKEND_URL=$BACKEND_URL \
    NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-alpine AS run
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
RUN addgroup --system app && adduser --system --ingroup app app
COPY --from=build --chown=app:app /app/.next/standalone ./
COPY --from=build --chown=app:app /app/.next/static ./.next/static
COPY --from=build --chown=app:app /app/public ./public
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/login >/dev/null 2>&1 || exit 1
CMD ["node", "server.js"]
