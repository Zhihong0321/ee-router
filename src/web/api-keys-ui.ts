import { type FastifyInstance } from 'fastify';

const keysHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="dark" />
  <title>Eter Router · API Keys</title>
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
    button, input, textarea { font: inherit; }
    button { cursor: pointer; }
    a { color: inherit; text-decoration: none; }
    .shell { width: min(1240px, calc(100% - 40px)); margin: 0 auto; padding: 34px 0 56px; }
    .topbar { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; margin-bottom: 28px; }
    .eyebrow { color: var(--accent); letter-spacing: .18em; text-transform: uppercase; font-size: 11px; font-weight: 700; }
    h1 { margin: 7px 0 6px; font-size: clamp(28px, 4vw, 48px); line-height: 1.04; letter-spacing: -.045em; }
    .lede { color: var(--muted); margin: 0; max-width: 650px; font-size: 15px; }
    .brand-mark { width: 46px; height: 46px; border: 1px solid rgba(167,139,250,.4); border-radius: 15px; display: grid; place-items: center; color: var(--accent); background: rgba(167,139,250,.12); font-weight: 800; letter-spacing: -.08em; box-shadow: 0 0 30px rgba(124,58,237,.2); flex: 0 0 auto; }
    .topbar-right { display: flex; flex-direction: column; align-items: flex-end; gap: 14px; }
    .nav { display: flex; gap: 6px; padding: 4px; border: 1px solid var(--line); border-radius: 12px; background: rgba(255,255,255,.04); }
    .nav-link { padding: 7px 11px; border-radius: 8px; color: var(--muted); font-size: 12px; font-weight: 750; }
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
    input, textarea { width: 100%; color: var(--text); background: rgba(7,9,16,.68); border: 1px solid rgba(255,255,255,.13); border-radius: 11px; padding: 11px 12px; outline: none; transition: border-color .2s, box-shadow .2s; }
    textarea { min-height: 72px; resize: vertical; }
    input::placeholder, textarea::placeholder { color: #667089; }
    input:focus, textarea:focus { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(167,139,250,.13); }
    .row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .button-row { display: flex; align-items: center; gap: 9px; margin-top: 22px; flex-wrap: wrap; }
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
    .choice-list { display: grid; gap: 8px; max-height: 190px; overflow: auto; padding: 2px; }
    .choice { display: flex; align-items: center; gap: 9px; padding: 9px 10px; border: 1px solid rgba(255,255,255,.09); border-radius: 10px; background: rgba(255,255,255,.035); cursor: pointer; }
    .choice:hover { border-color: rgba(167,139,250,.45); }
    .choice input { width: auto; accent-color: var(--accent-2); }
    .choice-text { min-width: 0; display: flex; flex-direction: column; }
    .choice-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--soft); font-size: 12px; font-weight: 700; }
    .choice-meta { color: var(--muted); font: 10px ui-monospace, SFMono-Regular, Consolas, monospace; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .key-card { padding: 18px; border: 1px solid var(--line); border-radius: 18px; background: rgba(16,18,30,.78); margin-bottom: 12px; }
    .key-top { display: flex; justify-content: space-between; gap: 15px; align-items: flex-start; }
    .key-name { font-weight: 800; font-size: 16px; }
    .key-description { color: var(--muted); margin-top: 4px; font-size: 12px; }
    .key-meta, .chip-list { display: flex; flex-wrap: wrap; gap: 7px; margin-top: 10px; }
    .badge, .chip { display: inline-flex; align-items: center; gap: 5px; padding: 4px 8px; border-radius: 999px; color: var(--soft); background: rgba(255,255,255,.07); font-size: 11px; }
    .badge.good { color: #a7f3d0; background: rgba(20,184,166,.15); }
    .badge.bad { color: #fecdd3; background: rgba(244,63,94,.13); }
    .badge.accent { color: #ddd6fe; background: rgba(124,58,237,.21); }
    .chip { border-radius: 8px; color: #ddd6fe; background: rgba(167,139,250,.08); font: 11px ui-monospace, SFMono-Regular, Consolas, monospace; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .key-footer { display: flex; align-items: center; justify-content: space-between; gap: 12px; border-top: 1px solid var(--line); margin-top: 14px; padding-top: 13px; }
    .key-prefix { color: #7f8aa4; font: 11px ui-monospace, SFMono-Regular, Consolas, monospace; }
    .persistent-secret { margin-top: 14px; padding: 12px; border: 1px solid rgba(74,222,181,.18); border-radius: 12px; background: rgba(20,184,166,.05); }
    .persistent-secret-label { color: #a7f3d0; font-size: 11px; font-weight: 800; letter-spacing: .02em; margin-bottom: 8px; }
    .persistent-secret-input { min-width: 0; }
    .persistent-secret .secret-value { margin-top: 0; }
    .empty { padding: 46px 20px; border: 1px dashed rgba(255,255,255,.17); border-radius: 18px; text-align: center; color: var(--muted); }
    .empty strong { display: block; margin-bottom: 5px; color: var(--soft); }
    .auth-panel { display: none; margin-bottom: 20px; padding: 15px 17px; border: 1px solid rgba(251,191,105,.24); border-radius: 16px; background: rgba(245,158,11,.07); }
    .auth-panel.visible { display: flex; align-items: center; gap: 12px; }
    .auth-copy { flex: 1; color: #fde68a; font-size: 12px; }
    .auth-panel input { max-width: 370px; }
    .secret-panel { display: none; margin-top: 18px; padding: 15px; border: 1px solid rgba(74,222,181,.30); border-radius: 15px; background: rgba(20,184,166,.08); }
    .secret-panel.visible { display: block; }
    .secret-panel strong { color: #a7f3d0; }
    .secret-value { display: flex; gap: 8px; margin-top: 10px; }
    .secret-value input { font: 12px ui-monospace, SFMono-Regular, Consolas, monospace; }
    .connection-panel { margin-bottom: 20px; }
    .connection-body { padding: 18px 22px 22px; }
    .connection-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
    .endpoint { padding: 13px; border: 1px solid rgba(255,255,255,.10); border-radius: 13px; background: rgba(255,255,255,.035); }
    .endpoint-label { color: var(--soft); font-size: 12px; font-weight: 750; margin-bottom: 8px; }
    .endpoint-value { display: flex; gap: 8px; align-items: center; }
    .endpoint-value input { min-width: 0; padding: 9px 10px; font: 11px ui-monospace, SFMono-Regular, Consolas, monospace; }
    .endpoint-value .btn { flex: 0 0 auto; padding: 9px 11px; }
    .endpoint-meta { color: var(--muted); font-size: 11px; margin-top: 7px; }
    .code-block { margin: 14px 0 0; padding: 13px; overflow: auto; border: 1px solid rgba(255,255,255,.10); border-radius: 13px; background: rgba(7,9,16,.68); color: #d9d2ff; font: 11px/1.55 ui-monospace, SFMono-Regular, Consolas, monospace; white-space: pre-wrap; }
    .connection-note { color: var(--muted); font-size: 12px; margin: 12px 0 0; }
    .toast { position: fixed; right: 22px; bottom: 22px; z-index: 5; max-width: min(420px, calc(100% - 44px)); transform: translateY(18px); opacity: 0; pointer-events: none; padding: 12px 15px; border: 1px solid var(--line); border-radius: 12px; background: #1b1f31; color: var(--soft); box-shadow: var(--shadow); transition: .2s; }
    .toast.visible { transform: translateY(0); opacity: 1; }
    .toast.error { color: #fecdd3; border-color: rgba(251,113,133,.3); }
    @media (max-width: 820px) {
      .shell { width: min(100% - 28px, 620px); padding-top: 24px; }
      .topbar { margin-bottom: 22px; }
      .topbar-right { align-items: flex-start; }
      .grid { grid-template-columns: 1fr; }
      .summary { grid-template-columns: repeat(3, 1fr); }
    }
    @media (max-width: 500px) {
      .row { grid-template-columns: 1fr; }
      .connection-grid { grid-template-columns: 1fr; }
      .summary { gap: 7px; }
      .metric { padding: 12px 10px; }
      .metric-value { font-size: 20px; }
      .auth-panel.visible { align-items: stretch; flex-direction: column; }
      .auth-panel input { max-width: none; }
      .secret-value { flex-direction: column; }
    }
  </style>
</head>
<body>
  <main class="shell">
    <header class="topbar">
      <div>
        <div class="eyebrow">Eter Router · Access control</div>
        <h1>API keys with guardrails.</h1>
        <p class="lede">Create client keys, choose exactly which providers and models they can use, set priority, and switch access off without deleting the key.</p>
      </div>
      <div class="topbar-right">
        <nav class="nav" aria-label="Control plane">
          <a class="nav-link" href="/">Providers</a>
          <a class="nav-link active" href="/keys">API keys</a>
          <a class="nav-link" href="/logs">Logs</a>
        </nav>
        <div class="brand-mark" aria-label="Eter Router">ER</div>
      </div>
    </header>

    <section id="auth-panel" class="auth-panel" aria-live="polite">
      <div class="auth-copy"><strong>Admin authentication required.</strong><br />Enter the ADMIN_API_KEY configured for this service.</div>
      <input id="admin-key" type="password" autocomplete="off" placeholder="Paste admin API key" aria-label="Admin API key" />
      <button id="connect-btn" class="btn btn-primary" type="button">Connect</button>
    </section>

    <section class="panel connection-panel">
      <div class="panel-head">
        <div>
          <h2>Connect your client</h2>
          <p>Use an enabled client key with these router URLs. The client key is not the admin key.</p>
        </div>
      </div>
      <div class="connection-body">
        <div class="connection-grid">
          <div class="endpoint">
            <div class="endpoint-label">OpenAI-compatible base URL</div>
            <div class="endpoint-value">
              <input id="openai-base-url" readonly aria-label="OpenAI-compatible base URL" />
              <button class="btn btn-subtle copy-endpoint" data-copy-target="openai-base-url" type="button">Copy</button>
            </div>
            <div class="endpoint-meta">Chat: <span id="openai-chat-url"></span><br />Models: <span id="openai-models-url"></span></div>
          </div>
          <div class="endpoint">
            <div class="endpoint-label">Anthropic Messages URL</div>
            <div class="endpoint-value">
              <input id="anthropic-messages-url" readonly aria-label="Anthropic Messages URL" />
              <button class="btn btn-subtle copy-endpoint" data-copy-target="anthropic-messages-url" type="button">Copy</button>
            </div>
            <div class="endpoint-meta">Send an Anthropic-compatible POST request to this endpoint.</div>
          </div>
        </div>
        <pre id="curl-example" class="code-block"></pre>
        <p class="connection-note">Use <code>Authorization: Bearer &lt;client-api-key&gt;</code>. API keys are only shown once, immediately after creation.</p>
      </div>
    </section>

    <section class="grid">
      <div class="panel">
        <div class="panel-head">
          <div>
            <h2 id="form-title">Create API key</h2>
            <p id="form-description">The secret is shown once after creation. Store it somewhere safe.</p>
          </div>
        </div>
        <form id="key-form" class="form">
          <div class="field">
            <label for="key-name">Name</label>
            <input id="key-name" required placeholder="e.g. Production app" />
          </div>
          <div class="field">
            <label for="key-description">Description</label>
            <textarea id="key-description" placeholder="Who or what uses this key?"></textarea>
          </div>
          <div class="row">
            <div class="field">
              <label for="key-priority">Priority</label>
              <input id="key-priority" type="number" min="0" step="1" value="0" />
              <p class="hint">Higher values appear first.</p>
            </div>
            <div class="field">
              <label for="key-active">Access</label>
              <label class="choice"><input id="key-active" type="checkbox" checked /><span class="choice-text"><span class="choice-title">Enabled</span><span class="choice-meta">Allow requests now</span></span></label>
            </div>
          </div>
          <div class="field">
            <label>Providers <span class="hint">(optional restriction)</span></label>
            <div id="provider-picker" class="choice-list"><div class="hint">Loading providers…</div></div>
            <p class="hint">No selection means the key uses its legacy group assignment.</p>
          </div>
          <div class="field">
            <label>Available models <span class="hint">(optional restriction)</span></label>
            <div id="model-picker" class="choice-list"><div class="hint">Select providers to see their models.</div></div>
            <p class="hint">No selection means all models from the selected providers are allowed.</p>
          </div>
          <div class="button-row">
            <button id="submit-btn" class="btn btn-primary" type="submit">Create API key</button>
            <button id="clear-btn" class="btn btn-subtle" type="button">Clear</button>
            <span id="form-status" class="status" role="status"></span>
          </div>
          <div id="secret-panel" class="secret-panel">
            <strong id="secret-title">Full client key. It remains visible to authenticated admins.</strong>
            <div class="secret-value"><input id="secret-value" readonly /><button id="copy-btn" class="btn btn-subtle" type="button">Copy</button></div>
          </div>
        </form>
      </div>

      <div>
        <div class="summary">
          <div class="metric"><div id="key-count" class="metric-value">—</div><div class="metric-label">API keys</div></div>
          <div class="metric"><div id="enabled-count" class="metric-value">—</div><div class="metric-label">Enabled</div></div>
          <div class="metric"><div id="provider-count" class="metric-value">—</div><div class="metric-label">Providers</div></div>
        </div>
        <div class="panel">
          <div class="panel-head">
            <div><h2>Client keys</h2><p id="list-caption">Loading API keys…</p></div>
            <button id="refresh-btn" class="btn btn-subtle" type="button">Refresh</button>
          </div>
          <div id="key-list" class="form"><div class="empty"><strong>Loading keys</strong>Connecting to the control plane…</div></div>
        </div>
      </div>
    </section>
  </main>
  <div id="toast" class="toast" role="status"></div>

  <script>
    (() => {
      const state = { keys: [], providers: [], adminKey: '', editingId: null, selectedModels: [], toastTimer: null };
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
        const headers = Object.assign(config.body === undefined ? {} : { 'Content-Type': 'application/json' }, config.headers || {});
        if (state.adminKey) headers.Authorization = 'Bearer ' + state.adminKey;
        const response = await fetch(path, Object.assign({}, config, { headers }));
        const text = await response.text();
        const contentType = response.headers.get('content-type') || '';
        let payload = {};
        try { payload = text && contentType.includes('json') ? JSON.parse(text) : { error: text }; } catch { payload = { error: text }; }
        if (!response.ok) {
          const message = text && !contentType.includes('json') ? 'Server returned HTTP ' + response.status + ' instead of JSON: ' + text.slice(0, 180) : apiError(payload);
          const error = new Error(message);
          error.status = response.status;
          throw error;
        }
        return payload;
      }

      function showAuth(show) { el('auth-panel').classList.toggle('visible', show); }

      function setConnectionDetails() {
        const origin = window.location.origin.endsWith('/') ? window.location.origin.slice(0, -1) : window.location.origin;
        const apiBase = origin + '/v1';
        const chatUrl = apiBase + '/chat/completions';
        const modelsUrl = apiBase + '/models';
        const anthropicUrl = apiBase + '/messages';
        const slash = String.fromCharCode(92);
        el('openai-base-url').value = apiBase;
        el('openai-chat-url').textContent = chatUrl;
        el('openai-models-url').textContent = modelsUrl;
        el('anthropic-messages-url').value = anthropicUrl;
        el('curl-example').textContent = [
          'curl ' + chatUrl + ' ' + slash,
          '  -H "Authorization: Bearer <client-api-key>" ' + slash,
          '  -H "Content-Type: application/json" ' + slash,
          '  -d ' + JSON.stringify({ model: 'your-model-id', messages: [{ role: 'user', content: 'Hello' }] })
        ].join(String.fromCharCode(10));
      }

      function selectedProviderIds() {
        return Array.from(document.querySelectorAll('input[name="provider_id"]:checked')).map(input => input.value);
      }

      function availableModels() {
        const selected = new Set(selectedProviderIds());
        const providers = selected.size ? state.providers.filter(provider => selected.has(provider.id)) : state.providers;
        return [...new Set(providers.flatMap(provider => Array.isArray(provider.models) ? provider.models : []))].sort();
      }

      function captureModels() {
        state.selectedModels = Array.from(document.querySelectorAll('input[name="allowed_model"]:checked')).map(input => input.value);
      }

      function renderModelChoices() {
        const picker = el('model-picker');
        const selected = new Set(state.selectedModels);
        const models = availableModels();
        if (!models.length) {
          picker.innerHTML = '<div class="hint">No models available. Add providers and detect models first.</div>';
          return;
        }
        picker.innerHTML = models.map(model => '<label class="choice"><input type="checkbox" name="allowed_model" value="' + escapeHtml(model) + '"' + (selected.has(model) ? ' checked' : '') + '><span class="choice-text"><span class="choice-title">' + escapeHtml(model) + '</span><span class="choice-meta">Allowed model</span></span></label>').join('');
      }

      function renderProviderChoices() {
        const picker = el('provider-picker');
        if (!state.providers.length) {
          picker.innerHTML = '<div class="hint">No providers found. Add one on the Providers page.</div>';
          renderModelChoices();
          return;
        }
        const selected = new Set(selectedProviderIds());
        picker.innerHTML = state.providers.map(provider => '<label class="choice"><input type="checkbox" name="provider_id" value="' + escapeHtml(provider.id) + '"' + (selected.has(provider.id) ? ' checked' : '') + '><span class="choice-text"><span class="choice-title">' + escapeHtml(provider.name) + '</span><span class="choice-meta">' + escapeHtml(provider.base_url) + '</span></span></label>').join('');
        picker.querySelectorAll('input[name="provider_id"]').forEach(input => input.addEventListener('change', () => { captureModels(); renderModelChoices(); }));
        renderModelChoices();
      }

      function render() {
        el('key-count').textContent = state.keys.length;
        el('enabled-count').textContent = state.keys.filter(key => key.is_active !== false).length;
        el('provider-count').textContent = state.providers.length;
        el('list-caption').textContent = state.keys.length ? 'Full client secrets stay visible here after refresh. Regenerate a legacy key once to save its full secret.' : 'No client keys yet. Create one on the left.';
        const list = el('key-list');
        if (!state.keys.length) {
          list.innerHTML = '<div class="empty"><strong>No client keys yet</strong>Create a key and restrict it to the providers and models it needs.</div>';
          return;
        }
        list.innerHTML = state.keys.map(key => {
          const providers = (key.provider_ids || []).map(id => state.providers.find(provider => provider.id === id)?.name || id);
          const models = key.allowed_models || [];
          const providerHtml = providers.length ? providers.map(item => '<span class="chip">' + escapeHtml(item) + '</span>').join('') : '<span class="hint">Legacy group assignment</span>';
          const modelHtml = models.length ? models.map(item => '<span class="chip">' + escapeHtml(item) + '</span>').join('') : '<span class="hint">All models</span>';
          const secretHtml = key.secret
            ? '<div class="persistent-secret"><div class="persistent-secret-label">Client API key · visible forever</div><div class="secret-value"><input class="persistent-secret-input" readonly value="' + escapeHtml(key.secret) + '"><button class="btn btn-subtle copy-persistent-btn" data-id="' + escapeHtml(key.id) + '" type="button">Copy</button></div></div>'
            : '<div class="persistent-secret"><div class="persistent-secret-label">Client API key</div><div class="hint">No saved full key. Regenerate this key to make it visible here.</div></div>';
          return '<article class="key-card"><div class="key-top"><div><div class="key-name">' + escapeHtml(key.name) + '</div><div class="key-description">' + escapeHtml(key.description || 'No description') + '</div><div class="key-meta"><span class="badge accent">Priority ' + escapeHtml(key.priority ?? 0) + '</span><span class="badge ' + (key.is_active === false ? 'bad' : 'good') + '">' + (key.is_active === false ? 'Disabled' : 'Enabled') + '</span></div></div><div class="button-row"><button class="btn btn-subtle edit-btn" data-id="' + escapeHtml(key.id) + '" type="button">Edit</button><button class="btn btn-subtle regenerate-btn" data-id="' + escapeHtml(key.id) + '" type="button">Regenerate key</button><button class="btn btn-danger delete-btn" data-id="' + escapeHtml(key.id) + '" type="button">Delete</button></div></div><div class="chip-list">' + providerHtml + '</div><div class="chip-list">' + modelHtml + '</div>' + secretHtml + '<div class="key-footer"><span class="key-prefix">' + escapeHtml(key.key_prefix) + '</span><button class="btn btn-subtle toggle-btn" data-id="' + escapeHtml(key.id) + '" data-active="' + (key.is_active !== false) + '" type="button">' + (key.is_active === false ? 'Enable' : 'Disable') + '</button></div></article>';
        }).join('');
        list.querySelectorAll('.edit-btn').forEach(button => button.addEventListener('click', () => editKey(button.dataset.id)));
        list.querySelectorAll('.regenerate-btn').forEach(button => button.addEventListener('click', () => regenerateKey(button.dataset.id)));
        list.querySelectorAll('.copy-persistent-btn').forEach(button => button.addEventListener('click', async () => {
          const key = state.keys.find(item => item.id === button.dataset.id);
          if (key?.secret) {
            await navigator.clipboard.writeText(key.secret);
            toast('API key copied.');
          }
        }));
        list.querySelectorAll('.delete-btn').forEach(button => button.addEventListener('click', () => deleteKey(button.dataset.id)));
        list.querySelectorAll('.toggle-btn').forEach(button => button.addEventListener('click', () => toggleKey(button.dataset.id, button.dataset.active !== 'true')));
      }

      async function load() {
        try {
          const result = await Promise.all([api('/api/admin/keys'), api('/api/admin/providers')]);
          state.keys = result[0];
          state.providers = result[1];
          showAuth(false);
          renderProviderChoices();
          render();
        } catch (error) {
          if (error.status === 401) {
            showAuth(true);
            el('list-caption').textContent = 'Authenticate to view API keys.';
            el('key-list').innerHTML = '<div class="empty"><strong>Admin authentication required</strong>Enter your admin key above to load this page.</div>';
          } else {
            el('list-caption').textContent = error.message;
            el('key-list').innerHTML = '<div class="empty"><strong>Could not load API keys</strong>' + escapeHtml(error.message) + '</div>';
            toast(error.message, true);
          }
        }
      }

      function resetForm() {
        state.editingId = null;
        state.selectedModels = [];
        el('key-form').reset();
        el('key-priority').value = '0';
        el('key-active').checked = true;
        el('form-title').textContent = 'Create API key';
        el('form-description').textContent = 'The full client secret stays visible to authenticated admins and is stored encrypted when configured.';
        el('submit-btn').textContent = 'Create API key';
        el('clear-btn').textContent = 'Clear';
        el('secret-panel').className = 'secret-panel';
        el('secret-title').textContent = 'Full client key. It remains visible to authenticated admins.';
        document.querySelectorAll('input[name="provider_id"]').forEach(input => { input.checked = false; });
        renderProviderChoices();
      }

      function showSecret(secret, title) {
        el('secret-title').textContent = title;
        el('secret-value').value = secret;
        el('secret-panel').className = 'secret-panel visible';
        el('secret-panel').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }

      function editKey(id) {
        const key = state.keys.find(item => item.id === id);
        if (!key) return;
        state.editingId = id;
        state.selectedModels = key.allowed_models || [];
        el('key-name').value = key.name || '';
        el('key-description').value = key.description || '';
        el('key-priority').value = String(key.priority ?? 0);
        el('key-active').checked = key.is_active !== false;
        renderProviderChoices();
        const selected = new Set(key.provider_ids || []);
        document.querySelectorAll('input[name="provider_id"]').forEach(input => { input.checked = selected.has(input.value); });
        renderModelChoices();
        el('form-title').textContent = 'Edit API key';
        el('form-description').textContent = 'Update access controls. The full client secret stays visible in the key list.';
        el('submit-btn').textContent = 'Save changes';
        el('clear-btn').textContent = 'Cancel edit';
        el('key-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
      }

      async function saveKey(event) {
        event.preventDefault();
        const button = el('submit-btn');
        const providerIds = selectedProviderIds();
        captureModels();
        const payload = {
          name: el('key-name').value.trim(),
          description: el('key-description').value.trim(),
          priority: Number(el('key-priority').value || 0),
          is_active: el('key-active').checked,
          provider_ids: providerIds,
          allowed_models: state.selectedModels
        };
        button.disabled = true;
        el('form-status').textContent = state.editingId ? 'Saving changes…' : 'Creating key…';
        el('form-status').className = 'status';
        try {
          const path = state.editingId ? '/api/admin/keys/' + encodeURIComponent(state.editingId) : '/api/admin/keys';
          const result = await api(path, { method: state.editingId ? 'PATCH' : 'POST', body: JSON.stringify(payload) });
          const wasEditing = Boolean(state.editingId);
          resetForm();
          if (!wasEditing && result.key) {
            showSecret(result.key, 'Client key created. The full secret remains visible in its key card.');
          }
          el('form-status').textContent = wasEditing ? 'API key updated.' : 'API key created.';
          el('form-status').className = 'status ok';
          toast(wasEditing ? 'API key updated.' : 'API key created.');
          await load();
        } catch (error) {
          el('form-status').textContent = error.message;
          el('form-status').className = 'status error';
        } finally {
          button.disabled = false;
        }
      }

      async function toggleKey(id, enabled) {
        try {
          await api('/api/admin/keys/' + encodeURIComponent(id), { method: 'PATCH', body: JSON.stringify({ is_active: enabled }) });
          toast(enabled ? 'API key enabled.' : 'API key disabled.');
          await load();
        } catch (error) { toast(error.message, true); }
      }

      async function regenerateKey(id) {
        const key = state.keys.find(item => item.id === id);
        if (!key || !window.confirm('Regenerate this API key? The current key will stop working immediately.')) return;
        try {
          const result = await api('/api/admin/keys/' + encodeURIComponent(id) + '/regenerate', { method: 'POST' });
          await load();
          showSecret(result.key, 'New secret for ' + result.name + '. The full key remains visible in its key card.');
          toast('Old API key revoked and replaced.');
        } catch (error) { toast(error.message, true); }
      }

      async function deleteKey(id) {
        if (!window.confirm('Delete this client API key? Existing clients will stop authenticating immediately.')) return;
        try {
          await api('/api/admin/keys/' + encodeURIComponent(id), { method: 'DELETE' });
          toast('API key deleted.');
          await load();
        } catch (error) { toast(error.message, true); }
      }

      el('key-form').addEventListener('submit', saveKey);
      el('clear-btn').addEventListener('click', resetForm);
      el('refresh-btn').addEventListener('click', load);
      el('connect-btn').addEventListener('click', async () => { state.adminKey = el('admin-key').value.trim(); await load(); });
      el('copy-btn').addEventListener('click', async () => {
        await navigator.clipboard.writeText(el('secret-value').value);
        toast('Secret copied.');
      });
      document.querySelectorAll('.copy-endpoint').forEach(button => button.addEventListener('click', async () => {
        const target = el(button.dataset.copyTarget);
        await navigator.clipboard.writeText(target.value);
        toast('Connection URL copied.');
      }));
      setConnectionDetails();
      resetForm();
      load();
    })();
  </script>
</body>
</html>`;

export async function registerAdminKeyUiRoutes(app: FastifyInstance): Promise<void> {
  app.get('/keys', async (_request, reply) => {
    return reply.type('text/html; charset=utf-8').header('Cache-Control', 'no-store').send(keysHtml);
  });
}
