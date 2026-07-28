import { type FastifyInstance } from 'fastify';

const logsHtml = String.raw`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="dark" />
  <title>Eter Router · Request Logs</title>
  <style>
    :root {
      --bg: #0a0b12;
      --panel: rgba(21, 24, 38, .92);
      --line: rgba(255,255,255,.10);
      --text: #f7f7fb;
      --muted: #9da4ba;
      --soft: #cbd1e2;
      --accent: #a78bfa;
      --accent-2: #7c3aed;
      --teal: #4adeb5;
      --amber: #fbbf69;
      --danger: #fb7185;
      --shadow: 0 24px 80px rgba(0,0,0,.35);
    }
    * { box-sizing: border-box; }
    body { margin: 0; min-width: 320px; color: var(--text); background: radial-gradient(circle at 14% 0%, rgba(124,58,237,.20), transparent 34rem), radial-gradient(circle at 100% 20%, rgba(45,212,191,.10), transparent 28rem), var(--bg); font: 14px/1.5 Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    button, select, input { font: inherit; }
    button { cursor: pointer; }
    a { color: inherit; text-decoration: none; }
    .shell { width: min(1400px, calc(100% - 40px)); margin: 0 auto; padding: 34px 0 56px; }
    .topbar { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; margin-bottom: 28px; }
    .eyebrow { color: var(--accent); letter-spacing: .18em; text-transform: uppercase; font-size: 11px; font-weight: 700; }
    h1 { margin: 7px 0 6px; font-size: clamp(28px, 4vw, 48px); line-height: 1.04; letter-spacing: -.045em; }
    .lede { color: var(--muted); margin: 0; max-width: 700px; font-size: 15px; }
    .brand-mark { width: 46px; height: 46px; border: 1px solid rgba(167,139,250,.4); border-radius: 15px; display: grid; place-items: center; color: var(--accent); background: rgba(167,139,250,.12); font-weight: 800; letter-spacing: -.08em; box-shadow: 0 0 30px rgba(124,58,237,.2); flex: 0 0 auto; }
    .topbar-right { display: flex; flex-direction: column; align-items: flex-end; gap: 14px; }
    .nav { display: flex; gap: 6px; padding: 4px; border: 1px solid var(--line); border-radius: 12px; background: rgba(255,255,255,.04); }
    .nav-link { padding: 7px 11px; border-radius: 8px; color: var(--muted); font-size: 12px; font-weight: 750; }
    .nav-link:hover, .nav-link.active { color: var(--text); background: rgba(167,139,250,.16); }
    .panel { border: 1px solid var(--line); background: linear-gradient(145deg, rgba(27,31,50,.94), rgba(13,15,25,.94)); border-radius: 22px; box-shadow: var(--shadow); }
    .panel-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; padding: 22px 22px 0; }
    .panel-head h2 { margin: 0; font-size: 17px; letter-spacing: -.02em; }
    .panel-head p { margin: 6px 0 0; color: var(--muted); font-size: 13px; }
    .toolbar { display: flex; align-items: end; gap: 12px; flex-wrap: wrap; padding: 22px; }
    .field { min-width: 210px; flex: 1; }
    label { display: block; margin-bottom: 7px; color: var(--soft); font-size: 12px; font-weight: 700; }
    select { width: 100%; color: var(--text); background: rgba(7,9,16,.68); border: 1px solid rgba(255,255,255,.13); border-radius: 11px; padding: 11px 12px; outline: none; }
    select:focus { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(167,139,250,.13); }
    .btn { border: 1px solid transparent; border-radius: 11px; padding: 10px 14px; color: var(--text); font-weight: 750; }
    .btn-primary { background: linear-gradient(135deg, var(--accent-2), #5b21b6); box-shadow: 0 9px 25px rgba(91,33,182,.24); }
    .btn-subtle { background: rgba(255,255,255,.05); border-color: var(--line); color: var(--soft); }
    .status { min-height: 20px; color: var(--muted); font-size: 12px; }
    .status.error { color: var(--danger); }
    .status.ok { color: var(--teal); }
    .auth-panel { display: none; margin-bottom: 20px; padding: 15px 17px; border: 1px solid rgba(251,191,105,.24); border-radius: 16px; background: rgba(245,158,11,.07); }
    .auth-panel.visible { display: flex; align-items: center; gap: 12px; }
    .auth-copy { flex: 1; color: #fde68a; font-size: 12px; }
    .auth-panel input { max-width: 370px; color: var(--text); background: rgba(7,9,16,.68); border: 1px solid rgba(255,255,255,.13); border-radius: 11px; padding: 11px 12px; }
    .table-wrap { overflow: auto; border-top: 1px solid var(--line); }
    table { width: 100%; min-width: 930px; border-collapse: collapse; }
    th, td { padding: 13px 15px; text-align: left; border-bottom: 1px solid rgba(255,255,255,.07); vertical-align: top; }
    th { color: var(--muted); font-size: 11px; font-weight: 750; letter-spacing: .04em; text-transform: uppercase; background: rgba(255,255,255,.025); }
    td { color: var(--soft); font-size: 12px; }
    .mono { color: #ddd6fe; font: 11px ui-monospace, SFMono-Regular, Consolas, monospace; }
    .muted { color: var(--muted); }
    .badge { display: inline-flex; padding: 4px 8px; border-radius: 999px; font-size: 11px; font-weight: 750; text-transform: capitalize; }
    .badge.success { color: #a7f3d0; background: rgba(20,184,166,.15); }
    .badge.error, .badge.timeout { color: #fecdd3; background: rgba(244,63,94,.13); }
    .badge.failover { color: #fde68a; background: rgba(245,158,11,.13); }
    .error-message { max-width: 330px; color: #fda4af; word-break: break-word; }
    .empty { padding: 46px 20px; text-align: center; color: var(--muted); }
    .empty strong { display: block; margin-bottom: 5px; color: var(--soft); }
    @media (max-width: 820px) {
      .shell { width: min(100% - 28px, 700px); padding-top: 24px; }
      .topbar { margin-bottom: 22px; }
      .topbar-right { align-items: flex-start; }
      .toolbar { align-items: stretch; flex-direction: column; }
      .field { min-width: 0; }
      .auth-panel.visible { align-items: stretch; flex-direction: column; }
      .auth-panel input { max-width: none; width: 100%; }
    }
  </style>
</head>
<body>
  <main class="shell">
    <header class="topbar">
      <div>
        <div class="eyebrow">Eter Router · Observability</div>
        <h1>Request logs by API key.</h1>
        <p class="lede">Inspect routing outcomes, providers, models, latency, and failures for each client key. Prompts and responses are never stored by this log.</p>
      </div>
      <div class="topbar-right">
        <nav class="nav" aria-label="Control plane">
          <a class="nav-link" href="/">Providers</a>
          <a class="nav-link" href="/keys">API keys</a>
          <a class="nav-link active" href="/logs">Logs</a>
        </nav>
        <div class="brand-mark" aria-label="Eter Router">ER</div>
      </div>
    </header>

    <section id="auth-panel" class="auth-panel" aria-live="polite">
      <div class="auth-copy"><strong>Admin authentication required.</strong><br />Enter the ADMIN_API_KEY configured for this service.</div>
      <input id="admin-key" type="password" autocomplete="off" placeholder="Paste admin API key" aria-label="Admin API key" />
      <button id="connect-btn" class="btn btn-primary" type="button">Connect</button>
    </section>

    <section class="panel">
      <div class="panel-head">
        <div>
          <h2>Filter request history</h2>
          <p id="caption">Loading logs…</p>
        </div>
        <button id="refresh-btn" class="btn btn-subtle" type="button">Refresh</button>
      </div>
      <div class="toolbar">
        <div class="field">
          <label for="key-filter">API key</label>
          <select id="key-filter"><option value="">All keys</option></select>
        </div>
        <div class="field">
          <label for="status-filter">Status</label>
          <select id="status-filter">
            <option value="">All statuses</option>
            <option value="success">Success</option>
            <option value="error">Error</option>
            <option value="timeout">Timeout</option>
            <option value="failover">Failover</option>
          </select>
        </div>
        <div id="status" class="status"></div>
      </div>
      <div id="logs-area" class="table-wrap">
        <div class="empty"><strong>Loading request logs</strong>Fetching per-key activity…</div>
      </div>
    </section>
  </main>

  <script>
    (() => {
      const state = {
        adminKey: '',
        keys: [],
        logs: [],
        selectedKey: new URLSearchParams(window.location.search).get('api_key_id') || ''
      };

      function el(id) { return document.getElementById(id); }
      function escapeHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
      }
      function showAuth(required) {
        el('auth-panel').classList.toggle('visible', required);
      }
      async function api(path, options = {}) {
        const headers = { ...(options.headers || {}) };
        if (state.adminKey) headers.Authorization = 'Bearer ' + state.adminKey;
        const response = await fetch(path, { ...options, headers });
        const text = await response.text();
        let body = {};
        try { body = text ? JSON.parse(text) : {}; } catch { body = { error: text }; }
        if (!response.ok) {
          const error = new Error(body.error || 'Request failed');
          error.status = response.status;
          throw error;
        }
        return body;
      }
      function renderKeyOptions() {
        const select = el('key-filter');
        const options = ['<option value="">All keys</option>'].concat(state.keys.map(key => '<option value="' + escapeHtml(key.id) + '">' + escapeHtml(key.name) + ' · ' + escapeHtml(key.key_prefix) + '</option>'));
        select.innerHTML = options.join('');
        select.value = state.keys.some(key => key.id === state.selectedKey) ? state.selectedKey : '';
      }
      function formatTime(value) {
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
      }
      function renderLogs() {
        const area = el('logs-area');
        el('caption').textContent = state.logs.length ? state.logs.length + ' request(s) shown · newest first' : 'No requests match these filters.';
        if (!state.logs.length) {
          area.innerHTML = '<div class="empty"><strong>No request logs yet</strong>Send a request through the router to create the first entry.</div>';
          return;
        }
        const rows = state.logs.map(log => {
          const status = String(log.status || 'error').toLowerCase();
          const error = log.error_message ? '<div class="error-message">' + escapeHtml(log.error_message) + '</div>' : '<span class="muted">—</span>';
          const usage = log.total_tokens == null
            ? '<span class="muted">—</span>'
            : escapeHtml(String(log.prompt_tokens ?? 0) + ' in · ' + String(log.completion_tokens ?? 0) + ' out · ' + String(log.total_tokens ?? 0) + ' total');
          const cost = log.cost_usd == null ? '<span class="muted">—</span>' : '$' + escapeHtml(Number(log.cost_usd).toFixed(6));
          return '<tr>' +
            '<td>' + escapeHtml(formatTime(log.created_at)) + '</td>' +
            '<td><span class="mono">' + escapeHtml(log.api_key_prefix) + '</span></td>' +
            '<td><span class="mono">' + escapeHtml(log.model) + '</span></td>' +
            '<td>' + escapeHtml(log.provider_name || 'router') + '</td>' +
            '<td><span class="badge ' + escapeHtml(status) + '">' + escapeHtml(status) + '</span></td>' +
            '<td>' + usage + '</td>' +
            '<td>' + cost + '</td>' +
            '<td>' + escapeHtml(String(log.latency_ms ?? 0)) + ' ms</td>' +
            '<td>' + error + '</td>' +
          '</tr>';
        }).join('');
        area.innerHTML = '<table><thead><tr><th>Time</th><th>Key</th><th>Model</th><th>Provider</th><th>Status</th><th>Tokens</th><th>Cost</th><th>Latency</th><th>Error</th></tr></thead><tbody>' + rows + '</tbody></table>';
      }
      async function load() {
        try {
          const keys = await api('/api/admin/keys/options');
          state.keys = Array.isArray(keys) ? keys : [];
          renderKeyOptions();
          await loadLogs();
          showAuth(false);
        } catch (error) {
          if (error.status === 401) {
            showAuth(true);
            el('caption').textContent = 'Authenticate to view request logs.';
            el('logs-area').innerHTML = '<div class="empty"><strong>Admin authentication required</strong>Enter your admin key above to load request history.</div>';
          } else {
            el('caption').textContent = error.message;
            el('logs-area').innerHTML = '<div class="empty"><strong>Could not load request logs</strong>' + escapeHtml(error.message) + '</div>';
          }
        }
      }
      async function loadLogs() {
        const params = new URLSearchParams({ limit: '100', offset: '0' });
        if (state.selectedKey) params.set('api_key_id', state.selectedKey);
        const status = el('status-filter').value;
        if (status) params.set('status', status);
        const logs = await api('/api/admin/logs?' + params.toString());
        state.logs = Array.isArray(logs) ? logs : [];
        renderLogs();
      }
      el('key-filter').addEventListener('change', async event => {
        state.selectedKey = event.target.value;
        const url = new URL(window.location.href);
        if (state.selectedKey) url.searchParams.set('api_key_id', state.selectedKey);
        else url.searchParams.delete('api_key_id');
        window.history.replaceState({}, '', url);
        await loadLogs();
      });
      el('status-filter').addEventListener('change', () => void loadLogs());
      el('refresh-btn').addEventListener('click', () => void load());
      el('connect-btn').addEventListener('click', async () => {
        state.adminKey = el('admin-key').value.trim();
        await load();
      });
      void load();
    })();
  </script>
</body>
</html>`;

export async function registerAdminLogsUiRoutes(app: FastifyInstance): Promise<void> {
  app.get('/logs', async (_request, reply) => {
    return reply.type('text/html; charset=utf-8').header('Cache-Control', 'no-store').send(logsHtml);
  });
}
