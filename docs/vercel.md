# Vercel web deployment

Deploy the repository with the Vercel project root set to `apps/web`.

- Framework: Next.js
- Node: 24.x (matches the workspace engine)
- Install: `pnpm install --frozen-lockfile`
- Build: `pnpm --filter @fsp/contracts build && pnpm --filter @fsp/web build`
- Output: Next.js default

Set `API_INTERNAL_URL` to the HTTPS origin of a running NestJS API before building. The same-origin `/api/v1` proxy keeps browser requests and session cookies on the frontend domain. Changing the URL requires a redeployment because the rewrite is compiled at build time. The backend must allow the frontend origin via `APP_ORIGIN`, use secure cookies in production, and have PostgreSQL, migrations and SMTP configured as described in the root README.

Vercel hosts the Next.js frontend. It does not start the Docker Compose API, PostgreSQL or SMTP services. Without a hosted API, public pages render but registration, login and authenticated workflows cannot work.

## Frontend checks

Run `pnpm --filter @fsp/contracts build`, then the web lint, typecheck and build scripts. Start the web app with `pnpm --filter @fsp/web start`, then run `pnpm --filter @fsp/e2e test:ux` for desktop and 320px phone checks. These smoke tests need no backend. The existing full E2E suite requires the local infrastructure and seeded database.
