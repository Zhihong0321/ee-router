import { type FastifyInstance } from 'fastify';

const adminHtml = String.raw`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="dark" />
  <title>Eter Router · Provider Console</title>
  <style>
    :root {
      --bg: #0a0b12;
      --panel: rgba(21, 24, 38, .88);
      --panel-strong: #171a29;
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
    body {
      margin: 0;
      min-width: 320px;
      color: var(--text);
      background:
        radial-gradient(circle at 14% 0%, rgba(124,58,237,.20), transparent 34rem),
        radial-gradient(circle at 100% 20%, rgba(45,212,191,.10), transparent 28rem),
        var(--bg);
      font: 14px/1.5 Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    button, input, select, textarea { font: inherit; }
    button { cursor: pointer; }
    .shell { width: min(1240px, calc(100% - 40px)); margin: 0 auto; padding: 34px 0 56px; }
    .topbar { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; margin-bottom: 28px; }
    .eyebrow { color: var(--accent); letter-spacing: .18em; text-transform: uppercase; font-size: 11px; font-weight: 700; }
    h1 { margin: 7px 0 6px; font-size: clamp(28px, 4vw, 48px); line-height: 1.04; letter-spacing: -.045em; }
    .lede { color: var(--muted); margin: 0; max-width: 620px; font-size: 15px; }
    .brand-mark { width: 46px; height: 46px; border: 1px solid rgba(167,139,250,.4); border-radius: 15px; display: grid; place-items: center; color: var(--accent); background: rgba(167,139,250,.12); font-weight: 800; letter-spacing: -.08em; box-shadow: 0 0 30px rgba(124,58,237,.2); flex: 0 0 auto; }
    .topbar-right { display: flex; flex-direction: column; align-items: flex-end; gap: 14px; }
    .nav { display: flex; gap: 6px; padding: 4px; border: 1px solid var(--line); border-radius: 12px; background: rgba(255,255,255,.04); }
    .nav-link { padding: 7px 11px; border-radius: 8px; color: var(--muted); font-size: 12px; font-weight: 750; text-decoration: none; }
    .nav-link:hover, .nav-link.active { color: var(--text); background: rgba(167,139,250,.16); }
    .grid { display: grid; grid-template-columns: minmax(320px, 390px) minmax(0, 1fr); gap: 22px; align-items: start; }
    .panel { border: 1px solid var(--line); background: linear-gradient(145deg, rgba(27,31,50,.94), rgba(13,15,25,.94)); border-radius: 22px; box-shadow: var(--shadow); }
    .panel-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; padding: 22px 22px 0; }
    .panel-head h2 { margin: 0; font-size: 17px; letter-spacing: -.02em; }
    .panel-head p { margin: 6px 0 0; color: var(--muted); font-size: 13px; }
    .form { padding: 22px; }
    .field { margin-bottom: 16px; }
    label { display: block; margin-bottom: 7px; color: var(--soft); font-size: 12px; font-weight: 700; }
    .hint { color: var(--muted); font-size: 11px; margin: 6px 0 0; }
    input, select, textarea {
      width: 100%; color: var(--text); background: rgba(7,9,16,.68); border: 1px solid rgba(255,255,255,.13); border-radius: 11px; padding: 11px 12px; outline: none; transition: border-color .2s, box-shadow .2s;
    }
    textarea { min-height: 88px; resize: vertical; }
    input::placeholder, textarea::placeholder { color: #667089; }
    input:focus, select:focus, textarea:focus { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(167,139,250,.13); }
    .row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .url-row { display: grid; grid-template-columns: 1fr auto; gap: 8px; align-items: end; }
    .button-row { display: flex; align-items: center; gap: 9px; margin-top: 22px; }
    .btn { border: 1px solid transparent; border-radius: 11px; padding: 10px 14px; color: var(--text); font-weight: 750; transition: transform .15s, background .15s, border-color .15s; }
    .btn:hover { transform: translateY(-1px); }
    .btn:disabled { opacity: .55; cursor: wait; transform: none; }
    .btn-primary { background: linear-gradient(135deg, var(--accent-2), #5b21b6); box-shadow: 0 9px 25px rgba(91,33,182,.24); }
    .btn-subtle { background: rgba(255,255,255,.05); border-color: var(--line); color: var(--soft); }
    .btn-danger { background: rgba(251,113,133,.08); border-color: rgba(251,113,133,.22); color: #fda4af; }
    .status { min-height: 20px; color: var(--muted); font-size: 12px; }
    .status.error { color: var(--danger); }
    .status.ok { color: var(--teal); }
    .summary { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 14px; }
    .metric { padding: 14px 15px; border: 1px solid var(--line); border-radius: 15px; background: rgba(255,255,255,.035); }
    .metric-value { font-size: 24px; font-weight: 800; letter-spacing: -.04em; }
    .metric-label { color: var(--muted); font-size: 11px; margin-top: 2px; }
    .provider-list { display: grid; gap: 12px; }
    .provider-card { padding: 18px; border: 1px solid var(--line); border-radius: 18px; background: rgba(16,18,30,.78); }
    .provider-card-top { display: flex; justify-content: space-between; gap: 15px; align-items: flex-start; }
    .card-actions { display: flex; gap: 7px; align-items: center; }
    .provider-name { font-weight: 800; font-size: 16px; }
    .provider-meta { display: flex; flex-wrap: wrap; gap: 7px; margin-top: 8px; }
    .badge { display: inline-flex; align-items: center; gap: 5px; padding: 4px 8px; border-radius: 999px; color: var(--soft); background: rgba(255,255,255,.07); font-size: 11px; }
    .badge.accent { color: #ddd6fe; background: rgba(124,58,237,.21); }
    .badge.good { color: #a7f3d0; background: rgba(20,184,166,.15); }
    .badge.warn { color: #fde68a; background: rgba(245,158,11,.13); }
    .badge.bad { color: #fecdd3; background: rgba(244,63,94,.13); }
    .provider-url { margin: 14px 0 12px; color: var(--muted); word-break: break-all; font: 12px/1.45 ui-monospace, SFMono-Regular, Consolas, monospace; }
    .model-list { display: flex; flex-wrap: wrap; gap: 6px; }
    .model-chip { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 5px 8px; border: 1px solid rgba(167,139,250,.20); border-radius: 8px; color: #ddd6fe; background: rgba(167,139,250,.08); font: 11px ui-monospace, SFMono-Regular, Consolas, monospace; }
    .card-footer { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-top: 15px; padding-top: 13px; border-top: 1px solid var(--line); }
    .key-mask { color: #7f8aa4; font: 11px ui-monospace, SFMono-Regular, Consolas, monospace; }
    .empty { padding: 46px 20px; border: 1px dashed rgba(255,255,255,.17); border-radius: 18px; text-align: center; color: var(--muted); }
    .empty strong { display: block; margin-bottom: 5px; color: var(--soft); }
    .auth-panel { display: none; margin-bottom: 20px; padding: 15px 17px; border: 1px solid rgba(251,191,105,.24); border-radius: 16px; background: rgba(245,158,11,.07); }
    .auth-panel.visible { display: flex; align-items: center; gap: 12px; }
    .auth-panel input { max-width: 370px; }
    .auth-copy { flex: 1; color: #fde68a; font-size: 12px; }
    .toast { position: fixed; right: 22px; bottom: 22px; z-index: 5; max-width: min(390px, calc(100% - 44px)); transform: translateY(18px); opacity: 0; pointer-events: none; padding: 12px 15px; border: 1px solid var(--line); border-radius: 12px; background: #1b1f31; color: var(--soft); box-shadow: var(--shadow); transition: .2s; }
    .toast.visible { transform: translateY(0); opacity: 1; }
    .toast.error { color: #fecdd3; border-color: rgba(251,113,133,.3); }
    @media (max-width: 820px) {
      .shell { width: min(100% - 28px, 620px); padding-top: 24px; }
      .topbar { margin-bottom: 22px; }
      .grid { grid-template-columns: 1fr; }
      .panel:first-child { order: 0; }
      .summary { grid-template-columns: repeat(3, 1fr); }
    }
    @media (max-width: 500px) {
      .row, .url-row { grid-template-columns: 1fr; }
      .summary { gap: 7px; }
      .metric { padding: 12px 10px; }
      .metric-value { font-size: 20px; }
      .auth-panel.visible { align-items: stretch; flex-direction: column; }
      .auth-panel input { max-width: none; }
      .button-row { flex-wrap: wrap; }
    }
  </style>
</head>
<body>
  <main class="shell">
    <header class="topbar">
      <div>
        <div class="eyebrow">Eter Router · Control plane</div>
        <h1>Provider keys, in one calm place.</h1>
        <p class="lede">Connect OpenAI-compatible, Anthropic, Gemini, Antigravity CLI, or custom endpoints. Discover their models before you route traffic.</p>
      </div>
      <div class="topbar-right"><nav class="nav" aria-label="Control plane"><a class="nav-link active" href="/">Providers</a><a class="nav-link" href="/keys">API keys</a></nav><div class="brand-mark" aria-label="Eter Router">ER</div></div>
    </header>

    <section id="auth-panel" class="auth-panel" aria-live="polite">
      <div class="auth-copy"><strong>Admin authentication required.</strong><br />Enter the ADMIN_API_KEY configured for this service.</div>
      <input id="admin-key" type="password" autocomplete="off" placeholder="Paste admin API key" aria-label="Admin API key" />
      <button id="connect-btn" class="btn btn-primary" type="button">Connect</button>
    </section>

    <section class="grid">
      <div class="panel">
        <div class="panel-head">
          <div>
            <h2 id="form-title">Add provider key</h2>
            <p id="form-description">Keys are encrypted at rest when PROVIDER_ENCRYPTION_KEY is configured.</p>
          </div>
        </div>
        <form id="provider-form" class="form">
          <div class="field">
            <label for="provider-name">Display name</label>
            <input id="provider-name" name="name" required placeholder="e.g. OpenAI production" />
          </div>
          <div class="field">
            <label for="provider-type">Provider</label>
            <select id="provider-type" name="provider_type">
              <option value="openai-compatible">OpenAI standard / compatible</option>
              <option value="anthropic">Anthropic</option>
              <option value="gemini">Google Gemini</option>
              <option value="agy-cli">Antigravity CLI (agy)</option>
              <option value="custom">Custom OpenAI-compatible</option>
            </select>
          </div>
          <div class="field">
            <label for="base-url">Base URL</label>
            <div class="url-row">
              <input id="base-url" name="base_url" type="url" required placeholder="https://api.openai.com/v1" />
              <button id="detect-btn" class="btn btn-subtle" type="button">Detect models</button>
            </div>
            <p class="hint">Use the API root, not the final /models or /chat/completions path.</p>
          </div>
          <div class="field">
            <label for="api-key">Provider API key</label>
            <input id="api-key" name="api_key" type="password" autocomplete="new-password" placeholder="sk-… / Anthropic / Gemini / agy bridge key" />
          </div>
          <div class="field">
            <label for="models">Available models</label>
            <textarea id="models" name="models" placeholder="Click Detect models, or enter one model ID per line"></textarea>
            <p class="hint">A model list is required for routing. You can also use * for a catch-all compatible endpoint.</p>
          </div>
          <div class="field">
            <label for="expires">API key deadline <span style="color:var(--muted);font-weight:500">(optional)</span></label>
            <input id="expires" name="api_key_expires_at" type="datetime-local" />
            <p class="hint">Expired provider keys are kept for audit but skipped by the router.</p>
          </div>
          <div class="button-row">
            <button id="submit-btn" class="btn btn-primary" type="submit">Add provider</button>
            <button id="clear-btn" class="btn btn-subtle" type="button">Clear</button>
            <span id="form-status" class="status" role="status"></span>
          </div>
        </form>
      </div>

      <div>
        <div class="summary">
          <div class="metric"><div id="provider-count" class="metric-value">—</div><div class="metric-label">Provider keys</div></div>
          <div class="metric"><div id="model-count" class="metric-value">—</div><div class="metric-label">Detected models</div></div>
          <div class="metric"><div id="active-count" class="metric-value">—</div><div class="metric-label">Active routes</div></div>
        </div>
        <div class="panel">
          <div class="panel-head">
            <div>
              <h2>Connected providers</h2>
              <p id="list-caption">Loading your provider inventory…</p>
            </div>
            <button id="refresh-btn" class="btn btn-subtle" type="button">Refresh</button>
          </div>
          <div id="provider-list" class="form">
            <div class="empty"><strong>Loading providers</strong>Connecting to the control plane…</div>
          </div>
        </div>
      </div>
    </section>
  </main>
  <div id="toast" class="toast" role="status"></div>

  <script>
    (() => {
      const state = { providers: [], adminKey: '', toastTimer: null, editingId: null };
      const defaults = {
        'openai-compatible': 'https://api.openai.com/v1',
        anthropic: 'https://api.anthropic.com/v1',
        gemini: 'https://generativelanguage.googleapis.com/v1beta',
        'agy-cli': '',
        custom: ''
      };
      const labels = {
        'openai-compatible': 'OpenAI compatible',
        anthropic: 'Anthropic',
        gemini: 'Google Gemini',
        'agy-cli': 'Antigravity CLI (agy)',
        custom: 'Custom endpoint'
      };
      const el = id => document.getElementById(id);
      const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
      const apiError = payload => payload && payload.error ? (typeof payload.error === 'string' ? payload.error : payload.error.message || JSON.stringify(payload.error)) : 'Request failed';

      function toast(message, isError) {
        const node = el('toast');
        node.textContent = message;
        node.className = 'toast visible' + (isError ? ' error' : '');
        clearTimeout(state.toastTimer);
        state.toastTimer = setTimeout(() => { node.className = 'toast'; }, 4200);
      }

      async function api(path, options) {
        const config = options || {};
        const headers = Object.assign({ 'Content-Type': 'application/json' }, config.headers || {});
        if (state.adminKey) headers.Authorization = 'Bearer ' + state.adminKey;
        const response = await fetch(path, Object.assign({}, config, { headers }));
        const text = await response.text();
        const contentType = response.headers.get('content-type') || '';
        let payload = {};
        try {
          payload = text && contentType.includes('json') ? JSON.parse(text) : { error: text };
        } catch {
          payload = { error: text };
        }
        if (!response.ok) {
          const message = text && !contentType.includes('json')
            ? 'Server returned HTTP ' + response.status + ' instead of JSON: ' + text.slice(0, 180)
            : apiError(payload);
          const error = new Error(message);
          error.status = response.status;
          throw error;
        }
        return payload;
      }

      function showAuth(show) {
        el('auth-panel').classList.toggle('visible', show);
      }

      function expiryBadge(value) {
        if (!value) return '<span class="badge good">No deadline</span>';
        const time = new Date(value).getTime();
        if (Number.isNaN(time)) return '<span class="badge warn">Deadline invalid</span>';
        if (time <= Date.now()) return '<span class="badge bad">Expired</span>';
        return '<span class="badge warn">Expires ' + escapeHtml(new Date(value).toLocaleString()) + '</span>';
      }

      function render() {
        const providers = state.providers;
        const modelCount = new Set(providers.flatMap(provider => Array.isArray(provider.models) ? provider.models : [])).size;
        el('provider-count').textContent = providers.length;
        el('model-count').textContent = modelCount;
        el('active-count').textContent = providers.filter(provider => provider.is_active !== false && (!provider.api_key_expires_at || new Date(provider.api_key_expires_at).getTime() > Date.now())).length;
        el('list-caption').textContent = providers.length ? 'Keys are masked after they are saved.' : 'No provider keys yet. Add your first route on the left.';
        const list = el('provider-list');
        if (!providers.length) {
          list.innerHTML = '<div class="empty"><strong>Your provider inventory is empty</strong>Add a key to start detecting models and routing traffic.</div>';
          return;
        }
        list.innerHTML = '<div class="provider-list">' + providers.map(provider => {
          const models = Array.isArray(provider.models) ? provider.models : [];
          const modelHtml = models.length
            ? models.map(model => '<span class="model-chip" title="' + escapeHtml(model) + '">' + escapeHtml(model) + '</span>').join('')
            : '<span class="hint">No models detected yet</span>';
          return '<article class="provider-card">' +
            '<div class="provider-card-top"><div><div class="provider-name">' + escapeHtml(provider.name) + '</div>' +
            '<div class="provider-meta"><span class="badge accent">' + escapeHtml(labels[provider.provider_type] || provider.provider_type) + '</span>' + expiryBadge(provider.api_key_expires_at) + '</div></div>' +
            '<div class="card-actions"><button class="btn btn-subtle edit-btn" data-id="' + escapeHtml(provider.id) + '" type="button">Edit</button><button class="btn btn-danger delete-btn" data-id="' + escapeHtml(provider.id) + '" type="button">Delete</button></div></div>' +
            '<div class="provider-url">' + escapeHtml(provider.base_url) + '</div>' +
            '<div class="model-list">' + modelHtml + '</div>' +
            '<div class="card-footer"><span class="key-mask">' + escapeHtml(provider.key_prefix || '••••••••') + '</span><span class="hint">Added ' + escapeHtml(new Date(provider.created_at).toLocaleDateString()) + '</span></div>' +
            '</article>';
        }).join('') + '</div>';
        list.querySelectorAll('.edit-btn').forEach(button => button.addEventListener('click', () => editProvider(button.dataset.id)));
        list.querySelectorAll('.delete-btn').forEach(button => button.addEventListener('click', () => deleteProvider(button.dataset.id)));
      }

      async function loadProviders() {
        try {
          state.providers = await api('/api/admin/providers');
          showAuth(false);
          render();
        } catch (error) {
          if (error.status === 401) {
            showAuth(true);
            el('list-caption').textContent = 'Authenticate to view provider keys.';
            el('provider-list').innerHTML = '<div class="empty"><strong>Admin authentication required</strong>Enter your admin key above to load the provider inventory.</div>';
          } else {
            el('list-caption').textContent = error.message;
            el('provider-list').innerHTML = '<div class="empty"><strong>Could not load providers</strong>' + escapeHtml(error.message) + '</div>';
            toast(error.message, true);
          }
        }
      }

      function resetForm() {
        state.editingId = null;
        el('provider-form').reset();
        el('form-title').textContent = 'Add provider key';
        el('form-description').textContent = 'Keys are encrypted at rest when PROVIDER_ENCRYPTION_KEY is configured.';
        el('submit-btn').textContent = 'Add provider';
        el('clear-btn').textContent = 'Clear';
        el('api-key').required = true;
        el('api-key').placeholder = 'sk-… / Anthropic / Gemini / agy bridge key';
        el('form-status').textContent = '';
        setDefaults();
      }

      function editProvider(id) {
        const provider = state.providers.find(item => item.id === id);
        if (!provider) return;
        state.editingId = id;
        el('provider-name').value = provider.name || '';
        el('provider-type').value = provider.provider_type || 'openai-compatible';
        el('base-url').value = provider.base_url || '';
        el('api-key').value = '';
        el('api-key').required = false;
        el('api-key').placeholder = 'Leave blank to keep the saved key';
        el('models').value = Array.isArray(provider.models) ? provider.models.join('\n') : '';
        if (provider.api_key_expires_at) {
          const date = new Date(provider.api_key_expires_at);
          const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
          el('expires').value = local.toISOString().slice(0, 16);
        } else {
          el('expires').value = '';
        }
        el('form-title').textContent = 'Edit provider';
        el('form-description').textContent = 'Update settings without revealing the saved provider key.';
        el('submit-btn').textContent = 'Save changes';
        el('clear-btn').textContent = 'Cancel edit';
        el('form-status').textContent = 'Editing ' + provider.name;
        el('form-status').className = 'status';
        el('provider-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
      }

      function setDefaults() {
        const type = el('provider-type').value;
        const input = el('base-url');
        if (!input.value || Object.values(defaults).includes(input.value)) input.value = defaults[type] || '';
      }

      async function detectModels() {
        const button = el('detect-btn');
        const baseUrl = el('base-url').value.trim();
        const apiKey = el('api-key').value.trim();
        if (!baseUrl || (!apiKey && !state.editingId)) {
          el('form-status').textContent = state.editingId ? 'Enter a base URL, or provide a replacement API key.' : 'Enter a base URL and API key first.';
          el('form-status').className = 'status error';
          return;
        }
        button.disabled = true;
        button.textContent = 'Detecting…';
        el('form-status').textContent = 'Asking the provider for its model catalog…';
        el('form-status').className = 'status';
        try {
          const useSavedKey = Boolean(state.editingId && !apiKey);
          const path = useSavedKey
            ? '/api/admin/providers/' + encodeURIComponent(state.editingId) + '/discover'
            : '/api/admin/providers/discover';
          const result = await api(path, {
            method: 'POST',
            body: JSON.stringify({
              provider_type: el('provider-type').value,
              base_url: baseUrl,
              ...(apiKey ? { api_key: apiKey } : {})
            })
          });
          el('models').value = (result.models || []).join('\n');
          el('form-status').textContent = result.models && result.models.length ? result.models.length + ' model(s) detected.' : 'No models returned; enter model IDs manually.';
          el('form-status').className = result.models && result.models.length ? 'status ok' : 'status';
        } catch (error) {
          el('form-status').textContent = error.message;
          el('form-status').className = 'status error';
        } finally {
          button.disabled = false;
          button.textContent = 'Detect models';
        }
      }

      async function saveProvider(event) {
        event.preventDefault();
        const button = el('submit-btn');
        const isEditing = Boolean(state.editingId);
        const apiKey = el('api-key').value.trim();
        if (!isEditing && !apiKey) {
          el('form-status').textContent = 'Enter a provider API key first.';
          el('form-status').className = 'status error';
          return;
        }
        const models = el('models').value.split(/[\n,]/).map(value => value.trim()).filter(Boolean);
        const expiry = el('expires').value;
        const payload = {
          name: el('provider-name').value.trim(),
          provider_type: el('provider-type').value,
          base_url: el('base-url').value.trim(),
          models,
          api_key_expires_at: expiry ? new Date(expiry).toISOString() : null
        };
        if (apiKey) payload.api_key = apiKey;
        button.disabled = true;
        el('form-status').textContent = isEditing ? 'Saving changes…' : 'Saving provider…';
        el('form-status').className = 'status';
        try {
          const path = isEditing ? '/api/admin/providers/' + encodeURIComponent(state.editingId) : '/api/admin/providers';
          await api(path, {
            method: isEditing ? 'PATCH' : 'POST',
            body: JSON.stringify(payload)
          });
          resetForm();
          el('form-status').textContent = isEditing ? 'Provider updated.' : 'Provider added.';
          el('form-status').className = 'status ok';
          toast(isEditing ? 'Provider updated.' : 'Provider key added securely.');
          await loadProviders();
        } catch (error) {
          el('form-status').textContent = error.message;
          el('form-status').className = 'status error';
        } finally {
          button.disabled = false;
        }
      }

      async function deleteProvider(id) {
        if (!window.confirm('Delete this provider key? Existing routes using it will stop immediately.')) return;
        try {
          await api('/api/admin/providers/' + encodeURIComponent(id), { method: 'DELETE' });
          toast('Provider removed.');
          await loadProviders();
        } catch (error) {
          toast(error.message, true);
        }
      }

      el('provider-type').addEventListener('change', setDefaults);
      el('detect-btn').addEventListener('click', detectModels);
      el('provider-form').addEventListener('submit', saveProvider);
      el('clear-btn').addEventListener('click', resetForm);
      el('refresh-btn').addEventListener('click', loadProviders);
      el('connect-btn').addEventListener('click', async () => {
        state.adminKey = el('admin-key').value.trim();
        await loadProviders();
      });
      resetForm();
      loadProviders();
    })();
  </script>
</body>
</html>`;

export async function registerAdminUiRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', async (_request, reply) => {
    return reply.type('text/html; charset=utf-8').header('Cache-Control', 'no-store').send(adminHtml);
  });

  app.get('/admin', async (_request, reply) => {
    return reply.redirect('/');
  });
}
