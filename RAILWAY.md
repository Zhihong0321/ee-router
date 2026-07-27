# Railway deployment

## Deploy

Connect this GitHub repository to Railway. The included `Dockerfile` builds TypeScript, runs as the unprivileged `node` user, uses Railway's injected `PORT`, and binds to `0.0.0.0`.

No application variable is required for the process to start. `NODE_ENV=production` is already set by the Docker image.

## Variables you control

- `DATABASE_URL`: optional. Add Railway Postgres and reference `${{Postgres.DATABASE_URL}}` when you want persistence and functional API/admin data routes. Without it, the server starts and `/health` reports `database: not_configured`.
- `ADMIN_API_KEY`: optional. When absent or blank, admin routes are open. When set, `/api/admin/*` requires `Authorization: Bearer <your value>`. There is no minimum length rule.
- `PROVIDER_ENCRYPTION_KEY`: optional. Exactly 64 hexadecimal characters enables AES-256-GCM provider-key encryption. Blank or any other value uses plaintext provider-key storage and does not block startup.
- `CORS_ORIGIN`: optional. Defaults to `*`; alternatively use a comma-separated list of browser origins.
- `RATE_LIMIT_MAX`: optional. Defaults to 100 requests per IP per minute.
- `LOG_LEVEL`: optional. Defaults to `info`.

The placeholders in `.env.example` are documentation, not values to paste into Railway. Blank optional variables can be omitted entirely.

## Provider console

Open the deployed service URL at `/` to use the provider console. It supports OpenAI-compatible, Anthropic, Gemini, and custom endpoints, model discovery, and optional provider-key expiry deadlines. If `ADMIN_API_KEY` is configured, enter it in the console before managing providers.

## Typical database setup

1. Add a PostgreSQL service to the Railway project.
2. On the app service, add a reference variable from that service's `DATABASE_URL`.
3. Redeploy and check `GET /health`; it should report `database: connected`.
4. Create providers, client API keys, and groups through `/api/admin/*`.
5. Test `/v1/models` and `/v1/chat/completions` with the generated client key.

## GitHub hygiene

Do not commit actual environment values, provider credentials, generated `dist`, dependencies, or logs. These are excluded by `.gitignore` and `.dockerignore`.
