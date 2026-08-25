// Mike Context Bridge
// Frontend control surface for persistent memory + Mike's Personal Operating System.
// The conversational path remains server-authoritative: /api/ask retrieves the same
// account-scoped context. This module gives the signed-in frontend a live management UI.

const TOKEN_KEY = 'mike_token';
const token = () => { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; } };
const headers = () => {
  const t = token();
  return t ? { Authorization: `Bearer ${t}` } : {};
};

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { ...headers(), ...(options.headers || {}) },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `request_failed_${response.status}`);
  return data;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c]));
}

function mount() {
  if (document.getElementById('mike-context-button')) return;
  const header = document.querySelector('.header-right');
  if (!header) return;

  const button = document.createElement('button');
  button.id = 'mike-context-button';
  button.type = 'button';
  button.textContent = 'Memory';
  button.style.cssText = 'border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.04);color:#fff;border-radius:999px;padding:7px 11px;font:600 12px/1 system-ui,sans-serif;cursor:pointer;';
  header.prepend(button);

  const panel = document.createElement('section');
  panel.id = 'mike-context-panel';
  panel.hidden = true;
  panel.innerHTML = `
    <div class="mcp-head"><div><strong>Mike Context</strong><small>Private to your account</small></div><button type="button" data-close>×</button></div>
    <div class="mcp-tabs"><button class="active" data-tab="memory">Memory</button><button data-tab="os">Operating System</button></div>
    <div class="mcp-body">
      <div data-view="memory">
        <p class="mcp-note">Tell Mike what to remember. He also learns when you explicitly say “remember…” in a conversation.</p>
        <form data-memory-form class="mcp-form"><input name="memory" placeholder="e.g. Remember that I prefer short answers" maxlength="1000"/><button>Save</button></form>
        <div data-memory-list class="mcp-list"><div class="mcp-muted">Loading…</div></div>
      </div>
      <div data-view="os" hidden>
        <p class="mcp-note">This is Mike's working plan: focus, next actions, decisions, and learned patterns.</p>
        <div class="mcp-os-grid">
          <form data-os-form="focus"><b>Current focus</b><input name="title" placeholder="What matters most right now" required/><input name="description" placeholder="Optional details"/><select name="priority"><option>high</option><option>critical</option><option>medium</option><option>low</option></select><button>Set focus</button></form>
          <form data-os-form="action"><b>Next action</b><input name="title" placeholder="Next concrete step" required/><select name="priority"><option>high</option><option>critical</option><option>medium</option><option>low</option></select><button>Add action</button></form>
          <form data-os-form="decision"><b>Decision</b><input name="decision" placeholder="What did we decide?" required/><input name="reasoning" placeholder="Why?"/><button>Record decision</button></form>
          <form data-os-form="pattern"><b>Learned pattern</b><input name="pattern" placeholder="What keeps proving true?" required/><select name="confidence"><option>3</option><option>4</option><option>5</option><option>2</option><option>1</option></select><button>Save pattern</button></form>
        </div>
        <div data-os-list class="mcp-list"><div class="mcp-muted">Loading…</div></div>
      </div>
    </div>`;

  const style = document.createElement('style');
  style.textContent = `
    #mike-context-panel{position:fixed;z-index:9999;top:64px;right:18px;width:min(430px,calc(100vw - 36px));max-height:calc(100vh - 84px);overflow:auto;background:#101014;color:#fff;border:1px solid rgba(255,255,255,.13);border-radius:18px;box-shadow:0 24px 70px rgba(0,0,0,.55);font:14px/1.4 system-ui,sans-serif}
    #mike-context-panel[hidden]{display:none}.mcp-head{display:flex;justify-content:space-between;align-items:center;padding:16px 18px;border-bottom:1px solid rgba(255,255,255,.09)}.mcp-head strong{display:block;font-size:16px}.mcp-head small{display:block;color:#999;margin-top:2px}.mcp-head button{background:none;border:0;color:#aaa;font-size:25px;cursor:pointer}.mcp-tabs{display:flex;padding:8px;border-bottom:1px solid rgba(255,255,255,.09);gap:6px}.mcp-tabs button{flex:1;background:transparent;border:0;color:#aaa;padding:9px;border-radius:10px;cursor:pointer}.mcp-tabs button.active{background:rgba(255,255,255,.08);color:#fff}.mcp-body{padding:14px 16px 18px}.mcp-note{color:#999;font-size:12px;margin:0 0 12px}.mcp-form{display:flex;gap:7px;margin-bottom:14px}.mcp-form input,.mcp-os-grid input,.mcp-os-grid select{width:100%;box-sizing:border-box;background:#18181d;border:1px solid rgba(255,255,255,.12);color:#fff;border-radius:9px;padding:9px 10px;outline:none}.mcp-form button,.mcp-os-grid button{border:0;border-radius:9px;padding:9px 11px;background:#fff;color:#111;font-weight:700;cursor:pointer;white-space:nowrap}.mcp-list{display:flex;flex-direction:column;gap:8px}.mcp-item{background:rgba(255,255,255,.045);border:1px solid rgba(255,255,255,.08);border-radius:11px;padding:10px 11px}.mcp-item-top{display:flex;gap:8px;justify-content:space-between}.mcp-item small{color:#888}.mcp-delete{background:none;border:0;color:#777;cursor:pointer}.mcp-muted{color:#777;padding:12px 2px}.mcp-os-grid{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-bottom:14px}.mcp-os-grid form{display:flex;flex-direction:column;gap:7px;padding:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.025)}.mcp-os-grid b{font-size:12px}.mcp-os-grid button{margin-top:2px}.mcp-chip{font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:#aaa}.mcp-error{color:#ff8b8b;font-size:12px;padding:8px 0}@media(max-width:600px){#mike-context-panel{top:58px;right:10px;width:calc(100vw - 20px)}.mcp-os-grid{grid-template-columns:1fr}}
  `;
  document.head.appendChild(style);
  document.body.appendChild(panel);

  const memoryList = panel.querySelector('[data-memory-list]');
  const osList = panel.querySelector('[data-os-list]');

  const renderMemory = (items) => {
    memoryList.innerHTML = items.length ? items.map((item) => `<div class="mcp-item"><div class="mcp-item-top"><div><span class="mcp-chip">${escapeHtml(item.category)}</span><div>${escapeHtml(item.memory)}</div></div><button class="mcp-delete" data-delete-memory="${escapeHtml(item.id)}">Delete</button></div></div>`).join('') : '<div class="mcp-muted">No saved memories yet.</div>';
  };

  const renderOs = (items) => {
    osList.innerHTML = items.length ? items.map((item) => `<div class="mcp-item"><div class="mcp-item-top"><div><span class="mcp-chip">${escapeHtml(item.category)}</span><div>${escapeHtml(item.memory)}</div></div><button class="mcp-delete" data-delete-memory="${escapeHtml(item.id)}">Clear</button></div></div>`).join('') : '<div class="mcp-muted">Your operating system is empty. Add a focus or next action above.</div>';
  };

  async function refresh() {
    if (!token()) {
      memoryList.innerHTML = '<div class="mcp-muted">Sign in to use persistent memory.</div>';
      osList.innerHTML = '<div class="mcp-muted">Sign in to use Mike’s operating system.</div>';
      return;
    }
    try {
      const [mem, os] = await Promise.all([
        api('/api/memory?category=context'),
        api('/api/memory?category=operating_system'),
      ]);
      renderMemory(mem.memories || []);
      renderOs(os.memories || []);
      window.dispatchEvent(new CustomEvent('mike-context-ready', { detail: { memories: mem.memories || [], operatingSystem: os.memories || [] } }));
    } catch (err) {
      memoryList.innerHTML = `<div class="mcp-error">${escapeHtml(err.message || 'Context unavailable')}</div>`;
      osList.innerHTML = `<div class="mcp-error">${escapeHtml(err.message || 'Context unavailable')}</div>`;
    }
  }

  button.addEventListener('click', async () => { panel.hidden = !panel.hidden; if (!panel.hidden) await refresh(); });
  panel.querySelector('[data-close]').addEventListener('click', () => { panel.hidden = true; });

  panel.querySelectorAll('[data-tab]').forEach((tab) => tab.addEventListener('click', () => {
    panel.querySelectorAll('[data-tab]').forEach((x) => x.classList.toggle('active', x === tab));
    panel.querySelectorAll('[data-view]').forEach((x) => { x.hidden = x.dataset.view !== tab.dataset.tab; });
  }));

  panel.querySelector('[data-memory-form]').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const memory = new FormData(form).get('memory');
    if (!String(memory || '').trim()) return;
    try {
      await api('/api/memory', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ category: 'context', memory: String(memory).trim(), importance: 5, source: 'frontend' }) });
      form.reset();
      await refresh();
    } catch (err) { memoryList.innerHTML = `<div class="mcp-error">${escapeHtml(err.message)}</div>`; }
  });

  panel.querySelectorAll('[data-os-form]').forEach((form) => form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const type = form.dataset.osForm;
    const values = Object.fromEntries(new FormData(form).entries());
    const payload = { type, action: 'create', ...values };
    if (type === 'focus') payload.priority = values.priority || 'high';
    if (type === 'action') payload.priority = values.priority || 'high';
    if (type === 'pattern') payload.confidence = Number(values.confidence || 3);
    try {
      await api('/api/memory', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ category: 'operating_system', memory: JSON.stringify(payload), source: 'frontend' }) });
      form.reset();
      await refresh();
    } catch (err) { osList.innerHTML = `<div class="mcp-error">${escapeHtml(err.message)}</div>`; }
  }));

  panel.addEventListener('click', async (e) => {
    const target = e.target.closest('[data-delete-memory]');
    if (!target) return;
    try { await api(`/api/memory/${encodeURIComponent(target.dataset.deleteMemory)}`, { method: 'DELETE' }); await refresh(); }
    catch (err) { window.alert(err.message || 'Could not clear context.'); }
  });

  // The auth modal in main.jsx writes the token without emitting an event.
  // Polling is intentionally light and only mounts the management data when
  // the user opens it, so it does not add work to the normal conversation path.
  window.mikeContext = { refresh, getToken: token };
}

const waitForMount = () => { if (document.querySelector('.header-right')) mount(); else setTimeout(waitForMount, 250); };
waitForMount();
