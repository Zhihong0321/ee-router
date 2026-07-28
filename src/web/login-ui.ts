import { type FastifyInstance } from 'fastify';
import { loadEnv } from '../config/env.js';
import {
  clearLoginFailures,
  clearSessionCookie,
  equalSecret,
  issueSessionToken,
  loginBlockedFor,
  recordLoginFailure,
  safeRedirectTarget,
  serializeSessionCookie,
} from '../auth/session.js';

const loginHtml = String.raw`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="dark" />
  <title>Eter Router · Sign in</title>
  <style>
    :root {
      --bg: #0a0b12;
      --line: rgba(255,255,255,.10);
      --text: #f7f7fb;
      --muted: #9da4ba;
      --soft: #cbd1e2;
      --accent: #a78bfa;
      --accent-2: #7c3aed;
      --teal: #4adeb5;
      --danger: #fb7185;
      --shadow: 0 24px 80px rgba(0,0,0,.35);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      padding: 24px;
      color: var(--text);
      background:
        radial-gradient(circle at 14% 0%, rgba(124,58,237,.20), transparent 34rem),
        radial-gradient(circle at 100% 20%, rgba(45,212,191,.10), transparent 28rem),
        var(--bg);
      font: 14px/1.5 Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    button, input { font: inherit; }
    button { cursor: pointer; }
    .card { width: min(420px, 100%); padding: 30px; border: 1px solid var(--line); border-radius: 22px; background: linear-gradient(145deg, rgba(27,31,50,.94), rgba(13,15,25,.94)); box-shadow: var(--shadow); }
    .brand { display: flex; align-items: center; gap: 12px; margin-bottom: 22px; }
    .brand-mark { width: 42px; height: 42px; border: 1px solid rgba(167,139,250,.4); border-radius: 14px; display: grid; place-items: center; color: var(--accent); background: rgba(167,139,250,.12); font-weight: 800; letter-spacing: -.08em; }
    .eyebrow { color: var(--accent); letter-spacing: .18em; text-transform: uppercase; font-size: 11px; font-weight: 700; }
    h1 { margin: 2px 0 0; font-size: 20px; letter-spacing: -.03em; }
    .lede { margin: 0 0 22px; color: var(--muted); font-size: 13px; }
    label { display: block; margin-bottom: 7px; color: var(--soft); font-size: 12px; font-weight: 700; }
    input { width: 100%; color: var(--text); background: rgba(7,9,16,.68); border: 1px solid rgba(255,255,255,.13); border-radius: 11px; padding: 11px 12px; outline: none; transition: border-color .2s, box-shadow .2s; }
    input::placeholder { color: #667089; }
    input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(167,139,250,.13); }
    .btn { width: 100%; margin-top: 18px; border: 1px solid transparent; border-radius: 11px; padding: 11px 14px; color: var(--text); font-weight: 750; background: linear-gradient(135deg, var(--accent-2), #5b21b6); box-shadow: 0 9px 25px rgba(91,33,182,.24); transition: transform .15s; }
    .btn:hover { transform: translateY(-1px); }
    .btn:disabled { opacity: .55; cursor: wait; transform: none; }
    .status { min-height: 20px; margin-top: 12px; color: var(--muted); font-size: 12px; }
    .status.error { color: var(--danger); }
    .status.ok { color: var(--teal); }
    .note { margin: 16px 0 0; color: var(--muted); font-size: 11px; }
  </style>
</head>
<body>
  <main class="card">
    <div class="brand">
      <div class="brand-mark" aria-label="Eter Router">ER</div>
      <div>
        <div class="eyebrow">Eter Router</div>
        <h1>Sign in</h1>
      </div>
    </div>
    <p class="lede">This service is private. Enter the access password to continue.</p>
    <form id="login-form" autocomplete="on">
      <label for="password">Password</label>
      <input id="password" name="password" type="password" autocomplete="current-password" required autofocus placeholder="Access password" />
      <button id="submit-btn" class="btn" type="submit">Unlock</button>
      <div id="status" class="status" role="status" aria-live="polite"></div>
    </form>
    <p class="note">Stays signed in on this browser for __TTL_LABEL__.</p>
  </main>

  <script>
    (function () {
      const form = document.getElementById('login-form');
      const input = document.getElementById('password');
      const button = document.getElementById('submit-btn');
      const status = document.getElementById('status');

      function setStatus(message, kind) {
        status.textContent = message;
        status.className = 'status' + (kind ? ' ' + kind : '');
      }

      function nextTarget() {
        const raw = new URLSearchParams(location.search).get('next') || '/';
        return raw.startsWith('/') && !raw.startsWith('//') ? raw : '/';
      }

      form.addEventListener('submit', async function (event) {
        event.preventDefault();
        const password = input.value;
        if (!password) return;

        button.disabled = true;
        setStatus('Checking...');
        try {
          const response = await fetch('/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: password }),
          });
          const payload = await response.json().catch(function () { return {}; });
          if (response.ok) {
            setStatus('Unlocked. Redirecting...', 'ok');
            location.replace(nextTarget());
            return;
          }
          setStatus((payload && payload.error && payload.error.message) || 'Incorrect password.', 'error');
        } catch (error) {
          setStatus('Network error. Try again.', 'error');
        }
        button.disabled = false;
        input.select();
      });
    })();
  </script>
</body>
</html>`;

function ttlLabel(hours: number): string {
  if (hours % 24 === 0) {
    const days = hours / 24;
    if (days % 30 === 0) {
      const months = days / 30;
      return months === 1 ? '1 month' : months + ' months';
    }
    return days === 1 ? '1 day' : days + ' days';
  }
  return hours === 1 ? '1 hour' : hours + ' hours';
}

export async function registerLoginRoutes(app: FastifyInstance): Promise<void> {
  const env = loadEnv();
  const secure = env.NODE_ENV === 'production';
  const ttlSeconds = env.SESSION_TTL_HOURS * 3600;
  const page = loginHtml.replace('__TTL_LABEL__', ttlLabel(env.SESSION_TTL_HOURS));

  app.get('/login', async (_request, reply) => {
    return reply.type('text/html; charset=utf-8').send(page);
  });

  app.post<{ Body: { password?: unknown; next?: unknown } }>('/login', async (request, reply) => {
    const ip = request.ip;
    const blockedFor = loginBlockedFor(ip);
    if (blockedFor > 0) {
      return reply.status(429).send({
        error: {
          type: 'rate_limit_error',
          message: `Too many failed attempts. Try again in ${Math.ceil(blockedFor / 60)} minute(s).`,
        },
      });
    }

    const expected = env.ADMIN_PASSWORD;
    if (!expected) {
      return reply.status(503).send({
        error: { type: 'configuration_error', message: 'ADMIN_PASSWORD is not configured on this service.' },
      });
    }

    const supplied = request.body?.password;
    if (typeof supplied !== 'string' || !supplied || !equalSecret(supplied, expected)) {
      recordLoginFailure(ip);
      return reply.status(401).send({
        error: { type: 'authentication_error', message: 'Incorrect password.' },
      });
    }

    clearLoginFailures(ip);
    const token = issueSessionToken(expected, ttlSeconds * 1000);
    return reply
      .header('set-cookie', serializeSessionCookie(token, ttlSeconds, secure))
      .send({ ok: true, next: safeRedirectTarget(request.body?.next), expires_in: ttlSeconds });
  });

  app.post('/logout', async (_request, reply) => {
    return reply.header('set-cookie', clearSessionCookie(secure)).send({ ok: true });
  });
}
