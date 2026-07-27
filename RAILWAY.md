# Railway deployment

## Services

Create a Railway service from this repository and add a PostgreSQL service to the same project. Railway will provide `DATABASE_URL` to the application when the Postgres reference variable is connected.

The repository uses the `Dockerfile` builder. The image compiles TypeScript, runs as the unprivileged `node` user, and starts with `node dist/index.js`. Railway's injected `PORT` is used automatically and the server binds to `0.0.0.0`.

## Required variables

Set these on the application service. Do not commit their values:

- `NODE_ENV=production`
- `DATABASE_URL=${{Postgres.DATABASE_URL}}` (use Railway's actual Postgres service name if different)
- `ADMIN_API_KEY`: at least 32 random characters; this protects every `/api/admin/*` endpoint
- `PROVIDER_ENCRYPTION_KEY`: 32 random bytes encoded as 64 hex characters, for example `openssl rand -hex 32`
- `CORS_ORIGIN`: `*` for non-browser API clients, or a comma-separated list of exact frontend origins

Optional variables are documented in `.env.example`: `LOG_LEVEL`, `RATE_LIMIT_MAX`, `REQUEST_LOG_RETENTION_DAYS`, and `HEALTH_CHECK_INTERVAL_MS`.

## First deploy

1. Deploy the app and Postgres services in the same Railway project.
2. Confirm the app deployment has the required variables above.
3. Open `GET /health`. It must return HTTP 200 and `database: connected`; a database failure returns HTTP 503 so Railway can replace the unhealthy instance.
4. Use the admin bearer key to create a provider and a client API key:

   `Authorization: Bearer $ADMIN_API_KEY`

5. Attach the provider to a provider group, then attach the group to the client API key.
6. Test `GET /v1/models` and a small `POST /v1/chat/completions` request with the generated client key.

## Existing database warning

Provider credentials created before encryption support may have `api_key_iv=0`. They are intentionally rejected when `NODE_ENV=production`. Recreate those providers through the admin API after setting `PROVIDER_ENCRYPTION_KEY`, or re-encrypt them with a controlled migration before deploying.

## GitHub hygiene

Commit source, `package-lock.json`, `Dockerfile`, `railway.json`, `.dockerignore`, `.env.example`, and this runbook. Never commit `.env`, provider credentials, generated `dist`, logs, or the local Legion/build logs ignored by `.gitignore`.
