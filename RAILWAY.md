# Railway deployment

## Deploy

Connect this GitHub repository to Railway. The included `Dockerfile` builds TypeScript, runs as the unprivileged `node` user, uses Railway's injected `PORT`, and binds to `0.0.0.0`.

`ADMIN_PASSWORD` is required for the process to start. `NODE_ENV=production` is already set by the Docker image.

## Variables you control

- `ADMIN_PASSWORD`: **required**, minimum 8 characters. The site password. The server refuses to start without it. Every route except `/health`, `/login`, and `/logout` requires either a password session or machine credentials.
- `SESSION_TTL_HOURS`: optional. Defaults to `720` (30 days) — how long one sign-in keeps the browser unlocked.
- `DATABASE_URL`: optional. Add Railway Postgres and reference `${{Postgres.DATABASE_URL}}` when you want persistence and functional API/admin data routes. Without it, the server starts and `/health` reports `database: not_configured`.
- `ADMIN_API_KEY`: optional. Machine access to `/api/admin/*` via `Authorization: Bearer <your value>`, for scripts that cannot hold a session cookie. Not needed when signing in through the browser.
- `PROVIDER_ENCRYPTION_KEY`: optional. Exactly 64 hexadecimal characters enables AES-256-GCM provider-key encryption. Blank or any other value uses plaintext provider-key storage and does not block startup.
- `CORS_ORIGIN`: optional. Defaults to `*`; alternatively use a comma-separated list of browser origins.
- `RATE_LIMIT_MAX`: optional. Defaults to 100 requests per IP per minute.
- `LOG_LEVEL`: optional. Defaults to `info`.
- `AGY_BIN`: optional. Defaults to `/usr/local/bin/agy` in the production image.
- `AGY_SCRATCH_ROOT`: optional. Defaults to `/tmp/agyproxy`; request scratch data is deleted after each process exits.
- `AGY_DIAGNOSTICS_ROOT`: optional. Defaults to `/storage/agy-diagnostics`; stores up to 500 sanitized process traces with prompt hashes, command metadata, timings, exit state, and redacted output previews.
- `AGY_PROFILE_IMPORT_KEY`: required only for first-login profile import. Use a random value of at least 32 characters. OAuth import requires this key in `X-AGY-Import-Key` in addition to the admin bearer token.
- `AGY_TIMEOUT_MS`: optional image default for operational documentation; each provider's `timeout_ms` controls request execution.

The placeholders in `.env.example` are documentation, not values to paste into Railway. Blank optional variables can be omitted entirely.

## Provider console

Open the deployed service URL. Any page redirects to `/login` until you enter `ADMIN_PASSWORD`; the session cookie is `HttpOnly`, `SameSite=Lax`, `Secure` in production, and lasts `SESSION_TTL_HOURS` (30 days by default), so you sign in once per browser rather than per page. `POST /logout` clears it, and changing `ADMIN_PASSWORD` invalidates every existing session. Failed logins are throttled to 8 per IP per 15 minutes.

Once signed in, `/` is the provider console. It supports OpenAI-compatible, Anthropic, Gemini, a local Antigravity CLI (`agy`) runtime, and custom endpoints, model discovery, and optional provider-key expiry deadlines. If `ADMIN_API_KEY` is configured, enter it in the console before managing providers.

Antigravity runs inside the same EE Router container. Its provider location is `local://agy`; it does not use a Base URL or provider API key. The image installs `/usr/local/bin/agy`, runs it as the unprivileged `node` user, keeps the native OAuth profile under the `/storage` persistent volume, and creates per-request scratch directories under `/tmp/agyproxy`.

The one working native AGY profile must be authenticated directly in this service or transferred into `/storage/.gemini` with explicit credential-migration approval. Do not copy, print, or inspect OAuth token contents.

## AGY operations API

Every operations route is under `/api/admin/agy/*` and requires the configured `ADMIN_API_KEY`. The API intentionally has no arbitrary command or shell endpoint.

- `GET /api/admin/agy`: machine-readable capability and endpoint inventory.
- `GET /api/admin/agy/status`: provider boundary, runtime user/home, profile-file metadata, and latest sanitized trace.
- `GET /api/admin/agy/version`: execute `agy --version` locally.
- `POST /api/admin/agy/models`: execute `agy models` locally.
- `POST /api/admin/agy/run`: execute a bounded `{ "model": "...", "prompt": "..." }` diagnostic request.
- `GET /api/admin/agy/logs` and `GET /api/admin/agy/logs/:traceId`: retrieve persistent sanitized process traces.
- `GET|POST /api/admin/agy/oauth/import`: preflight or atomically import the first native profile. POST also requires `X-AGY-Import-Key` and refuses to overwrite an existing profile.
- `GET /api/admin/agy/oauth/status`: inspect profile presence, permissions, ownership, size, and modification time without reading token contents.
- `POST /api/admin/agy/oauth/verify`: run `agy models` and a marker prompt after import.

## Typical database setup

1. Add a PostgreSQL service to the Railway project.
2. On the app service, add a reference variable from that service's `DATABASE_URL`.
3. Redeploy and check `GET /health`; it should report `database: connected`.
4. Create providers, client API keys, and groups through `/api/admin/*`.
5. Test `/v1/models` and `/v1/chat/completions` with the generated client key.

## GitHub hygiene

Do not commit actual environment values, provider credentials, generated `dist`, dependencies, or logs. These are excluded by `.gitignore` and `.dockerignore`.
