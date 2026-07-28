import { type FastifyInstance } from 'fastify';

const costsHtml = String.raw`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Eter Router · Model costs</title>
  <style>
    :root { color-scheme: dark; --bg:#080a12; --panel:#111522; --line:#27304a; --text:#eef2ff; --muted:#9ca7c2; --accent:#7c3aed; --danger:#ef4444; }
    * { box-sizing:border-box; }
    body { margin:0; min-height:100vh; background:radial-gradient(circle at top right,#1f1744,transparent 32%),var(--bg); color:var(--text); font-family:Inter,ui-sans-serif,system-ui,sans-serif; }
    .shell { width:min(1120px,calc(100% - 40px)); margin:0 auto; padding:40px 0 64px; }
    .topbar { display:flex; justify-content:space-between; align-items:flex-start; gap:24px; margin-bottom:28px; }
    .eyebrow { color:#a78bfa; font-weight:800; font-size:12px; letter-spacing:.12em; text-transform:uppercase; }
    h1 { margin:8px 0; font-size:30px; } .lede { margin:0; color:var(--muted); }
    .panel { background:rgba(17,21,34,.92); border:1px solid var(--line); border-radius:20px; padding:24px; }
    .panel-head { display:flex; justify-content:space-between; align-items:center; gap:16px; margin-bottom:20px; }
    h2 { margin:0; font-size:18px; } .hint { color:var(--muted); font-size:13px; margin:5px 0 0; }
    .btn { appearance:none; border:1px solid #37405c; border-radius:10px; background:#1b2132; color:var(--text); padding:11px 15px; font:inherit; font-weight:750; cursor:pointer; }
    .btn-primary { background:var(--accent); border-color:var(--accent); } .btn:disabled { opacity:.55; cursor:wait; }
    .table-wrap { overflow:auto; border:1px solid var(--line); border-radius:14px; }
    table { width:100%; border-collapse:collapse; min-width:720px; } th,td { text-align:left; padding:15px; border-bottom:1px solid var(--line); } tr:last-child td { border-bottom:0; } th { color:var(--muted); font-size:12px; text-transform:uppercase; letter-spacing:.08em; background:#0e1220; } .mono { font-family:ui-monospace,SFMono-Regular,Consolas,monospace; }
    input { width:100%; min-width:150px; padding:11px 12px; border:1px solid #37405c; border-radius:9px; background:#090c15; color:var(--text); font:inherit; }
    .footer { display:flex; justify-content:space-between; align-items:center; gap:16px; margin-top:20px; } .status { color:var(--muted); min-height:1.3em; } .status.error { color:#fca5a5; } .status.ok { color:#86efac; }
    .empty { padding:30px; text-align:center; color:var(--muted); }
    @media (max-width:640px) { .shell { width:min(100% - 24px,1120px); padding-top:24px; } .topbar,.footer { align-items:stretch; flex-direction:column; } }
  </style>
</head>
<body>
  <main class="shell">
    <header class="topbar">
      <div><div class="eyebrow">Eter Router · Provider pricing</div><h1 id="title">Model costs</h1><p id="subtitle" class="lede">Loading provider models…</p></div>
      <button class="btn" id="back" type="button">← Providers</button>
    </header>
    <section class="panel">
      <div class="panel-head"><div><h2>Set cost per model</h2><p class="hint">Rates are USD per 1 million tokens. Each request log uses the routed model’s rates.</p></div></div>
      <div id="content" class="table-wrap"><div class="empty">Loading available models…</div></div>
      <div class="footer"><div id="status" class="status" role="status"></div><button id="save" class="btn btn-primary" type="button">Save model costs</button></div>
    </section>
  </main>
  <script>
    (() => {
      const providerId = __PROVIDER_ID__;
      const state = { models: [] };
      const el = id => document.getElementById(id);
      const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;' }[char]));
      const setStatus = (message, kind = '') => { const node = el('status'); node.textContent = message; node.className = 'status ' + kind; };
      async function api(path, options = {}) {
        const response = await fetch(path, { ...options, headers: { 'Content-Type':'application/json', ...(options.headers || {}) } });
        const text = await response.text();
        let payload = {}; try { payload = text ? JSON.parse(text) : {}; } catch { payload = { error:text }; }
        if (!response.ok) { const error = new Error(payload.error || 'Request failed'); error.status = response.status; throw error; }
        return payload;
      }
      function render() {
        const content = el('content');
        if (!state.models.length) { content.innerHTML = '<div class="empty">This provider has no configured models. Add or detect models first.</div>'; el('save').disabled = true; return; }
        content.innerHTML = '<table><thead><tr><th>Model</th><th>Input cost (USD / 1M)</th><th>Output cost (USD / 1M)</th></tr></thead><tbody>' + state.models.map(item => '<tr data-model="' + escapeHtml(item.model) + '"><td class="mono">' + escapeHtml(item.model) + '</td><td><input class="input-cost" type="number" min="0" step="0.000001" value="' + escapeHtml(item.input_cost_per_1m_tokens) + '" /></td><td><input class="output-cost" type="number" min="0" step="0.000001" value="' + escapeHtml(item.output_cost_per_1m_tokens) + '" /></td></tr>').join('') + '</tbody></table>';
      }
      async function load() {
        try {
          const data = await api('/api/admin/providers/' + encodeURIComponent(providerId) + '/model-costs');
          el('title').textContent = data.name + ' · model costs';
          el('subtitle').textContent = 'Set separate rates for each model routed through this provider.';
          state.models = (Array.isArray(data.models) ? data.models : []).map(model => ({ model, input_cost_per_1m_tokens: Number(data.model_costs?.[model]?.input_cost_per_1m_tokens ?? 0), output_cost_per_1m_tokens: Number(data.model_costs?.[model]?.output_cost_per_1m_tokens ?? 0) }));
          render();
        } catch (error) {
          if (error.status === 401) { window.location.href = '/login?next=' + encodeURIComponent(window.location.pathname); return; }
          el('content').innerHTML = '<div class="empty">' + escapeHtml(error.message) + '</div>'; setStatus(error.message, 'error');
        }
      }
      async function save() {
        const rows = Array.from(document.querySelectorAll('tr[data-model]'));
        const model_costs = rows.map(row => ({ model: row.dataset.model, input_cost_per_1m_tokens: Number(row.querySelector('.input-cost').value || 0), output_cost_per_1m_tokens: Number(row.querySelector('.output-cost').value || 0) }));
        if (model_costs.some(row => !Number.isFinite(row.input_cost_per_1m_tokens) || row.input_cost_per_1m_tokens < 0 || !Number.isFinite(row.output_cost_per_1m_tokens) || row.output_cost_per_1m_tokens < 0)) { setStatus('Costs must be non-negative numbers.', 'error'); return; }
        const button = el('save'); button.disabled = true; setStatus('Saving model costs…');
        try { await api('/api/admin/providers/' + encodeURIComponent(providerId) + '/model-costs', { method:'PUT', body:JSON.stringify({ model_costs }) }); setStatus('Model costs saved.', 'ok'); }
        catch (error) { setStatus(error.message, 'error'); }
        finally { button.disabled = false; }
      }
      el('back').addEventListener('click', () => { window.location.href = '/'; });
      el('save').addEventListener('click', save);
      void load();
    })();
  </script>
</body>
</html>`;

export async function registerProviderModelCostsUiRoutes(app: FastifyInstance): Promise<void> {
  app.get('/providers/:id/costs', async (request, reply) => {
    const { id } = request.params as { id: string };
    return reply.type('text/html; charset=utf-8').header('Cache-Control', 'no-store').send(
      costsHtml.replace('__PROVIDER_ID__', JSON.stringify(id)),
    );
  });
}
