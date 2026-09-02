(() => {
  const TOKEN_KEY = 'mike_token';
  const BUTTON_ID = 'mike-sms-alerts';
  const PANEL_ID = `${BUTTON_ID}-panel`;

  const token = () => { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; } };
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));

  // Resale deal watches (and their alerts) are owner-only. Keep the opt-in
  // button hidden from everyone else so testers don't chase a flow that
  // will never have anything to notify them about.
  async function isOwner() {
    try {
      const auth = token();
      if (!auth) return false;
      const res = await fetch('/api/auth/me', { headers: { Authorization: `Bearer ${auth}` } });
      if (!res.ok) return false;
      const data = await res.json().catch(() => ({}));
      return !!data?.user?.isOwner;
    } catch { return false; }
  }

  async function authedFetch(url, options = {}) {
    const auth = token();
    if (!auth) throw new Error('sign_in_required');
    const res = await fetch(url, {
      ...options,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth}`, ...(options.headers || {}) },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `request_failed_${res.status}`);
    return data;
  }

  const getStatus = () => authedFetch('/api/sms/status');
  const subscribe = (phone) => authedFetch('/api/sms/subscribe', { method: 'POST', body: JSON.stringify({ phone }) });
  const verify = (code) => authedFetch('/api/sms/verify', { method: 'POST', body: JSON.stringify({ code }) });
  const unsubscribe = () => authedFetch('/api/sms/unsubscribe', { method: 'POST' });

  const errorMessage = (code) => ({
    sign_in_required: 'Sign in to Mike first, then turn on text alerts.',
    sms_not_configured: 'Text alerts are being finished on the server. Try again shortly.',
    sms_phone_invalid: 'Enter a valid US phone number, like (555) 123-4567.',
    sms_send_failed: 'Mike could not text that number. Double check it and try again.',
    sms_code_required: 'Enter the 6-digit code Mike texted you.',
    sms_code_mismatch: 'That code does not match. Check your texts and try again.',
    sms_code_expired: 'That code expired. Request a new one.',
    sms_no_pending_code: 'Start over - request a new code first.',
  }[code] || 'Mike could not complete that. Try again in a moment.');

  const ensurePanel = () => {
    let panel = document.getElementById(PANEL_ID);
    if (!panel) {
      panel = document.createElement('div');
      panel.id = PANEL_ID;
      document.body.appendChild(panel);
    }
    panel.style.cssText = 'position:fixed;left:14px;right:14px;bottom:78px;width:auto;max-width:360px;max-height:min(68vh,560px);overflow:auto;padding:20px;border:1px solid rgba(255,255,255,.16);border-radius:20px;background:rgba(17,17,17,.98);color:#fff;box-shadow:0 18px 50px rgba(0,0,0,.5);z-index:10003;font:15px/1.5 system-ui,sans-serif;white-space:normal;opacity:0;transform:translateY(14px);transition:opacity .22s ease,transform .22s ease;';
    return panel;
  };

  const openPanel = (panel) => requestAnimationFrame(() => { panel.style.opacity = '1'; panel.style.transform = 'translateY(0)'; });
  const closePanel = () => new Promise((resolve) => {
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return resolve();
    panel.style.opacity = '0';
    panel.style.transform = 'translateY(14px)';
    window.setTimeout(() => { panel.remove(); resolve(); }, 230);
  });

  const header = (title) => `<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px"><div style="font-size:18px;font-weight:800">${escapeHtml(title)}</div><button type="button" data-close style="flex:0 0 auto;border:0;background:transparent;color:#aaa;font-size:24px;line-height:1;padding:0;cursor:pointer" aria-label="Close">×</button></div>`;
  const wireClose = (panel) => panel.querySelector('[data-close]').addEventListener('click', closePanel, { once: true });

  const showMessage = (title, text) => {
    const panel = ensurePanel();
    panel.innerHTML = `${header(title)}<div style="margin-top:18px;white-space:pre-wrap">${escapeHtml(text)}</div>`;
    wireClose(panel);
    openPanel(panel);
  };

  const showManage = (status) => {
    const panel = ensurePanel();
    panel.innerHTML = `${header('Text Alerts')}<div style="margin-top:14px;color:#ddd">Deal alerts are texting <strong>${escapeHtml(status.phoneMasked || 'your phone')}</strong>.</div><button type="button" data-turnoff style="margin-top:18px;width:100%;padding:13px;border-radius:12px;border:1px solid #444;background:#222;color:#ff9d6c;font:600 15px system-ui,sans-serif;cursor:pointer">Turn off text alerts</button>`;
    wireClose(panel);
    openPanel(panel);
    panel.querySelector('[data-turnoff]').addEventListener('click', async (event) => {
      const btn = event.currentTarget;
      btn.disabled = true;
      btn.textContent = 'Turning off…';
      try {
        await unsubscribe();
        await closePanel();
        setButtonState('off');
      } catch {
        btn.disabled = false;
        btn.textContent = 'Turn off text alerts';
      }
    });
  };

  const showCodeEntry = (phone) => {
    const panel = ensurePanel();
    panel.innerHTML = `${header('Enter your code')}<div style="margin-top:5px;color:#aaa">Mike texted a 6-digit code to ${escapeHtml(phone || 'your phone')}.</div><div style="margin-top:18px"><input id="mike-sms-code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="123456" style="box-sizing:border-box;width:100%;padding:12px 13px;border-radius:12px;border:1px solid #444;background:#222;color:#fff;font:600 20px system-ui,sans-serif;letter-spacing:4px;text-align:center;outline:none"/></div><button type="button" data-verify style="margin-top:14px;width:100%;padding:13px;border-radius:12px;border:1px solid #f26b21;background:#f26b21;color:#111;font:700 15px system-ui,sans-serif;cursor:pointer">Confirm</button>`;
    wireClose(panel);
    openPanel(panel);
    const input = panel.querySelector('#mike-sms-code');
    input.addEventListener('input', (event) => { event.target.value = event.target.value.replace(/\D/g, '').slice(0, 6); });
    input.focus();
    panel.querySelector('[data-verify]').addEventListener('click', async (event) => {
      const btn = event.currentTarget;
      const code = input.value.trim();
      if (code.length !== 6) { showFieldError(panel, 'Enter the 6-digit code.'); return; }
      btn.disabled = true;
      btn.textContent = 'Confirming…';
      try {
        await verify(code);
        await closePanel();
        setButtonState('on');
        showMessage('Text alerts are on', "Mike will text you when a resale watch finds a qualifying deal.");
      } catch (error) {
        btn.disabled = false;
        btn.textContent = 'Confirm';
        showFieldError(panel, errorMessage(String(error?.message || error)));
      }
    });
  };

  const showFieldError = (panel, text) => {
    panel.querySelector('[data-field-error]')?.remove();
    const el = document.createElement('div');
    el.dataset.fieldError = '1';
    el.style.cssText = 'margin-top:10px;color:#ff9d6c;font-size:13px';
    el.textContent = text;
    panel.querySelector('[data-verify], [data-subscribe]')?.after(el);
  };

  const showPhoneEntry = () => {
    const panel = ensurePanel();
    panel.innerHTML = `${header('Turn on Text Alerts')}<div style="margin-top:5px;color:#aaa">Mike will text you when a resale watch finds a deal.</div><div style="margin-top:18px"><label for="mike-sms-phone" style="display:block;font-weight:700;margin-bottom:7px">Your phone number</label><input id="mike-sms-phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="(555) 123-4567" style="box-sizing:border-box;width:100%;padding:12px 13px;border-radius:12px;border:1px solid #444;background:#222;color:#fff;font:inherit;outline:none"/></div><button type="button" data-subscribe style="margin-top:14px;width:100%;padding:13px;border-radius:12px;border:1px solid #f26b21;background:#f26b21;color:#111;font:700 15px system-ui,sans-serif;cursor:pointer">Text me a code</button><div style="margin-top:12px;color:#777;font-size:12px">Standard message rates may apply. You can turn this off anytime.</div>`;
    wireClose(panel);
    openPanel(panel);
    const input = panel.querySelector('#mike-sms-phone');
    input.focus();
    panel.querySelector('[data-subscribe]').addEventListener('click', async (event) => {
      const btn = event.currentTarget;
      const phone = input.value.trim();
      if (!phone) { showFieldError(panel, 'Enter your phone number.'); return; }
      btn.disabled = true;
      btn.textContent = 'Sending code…';
      try {
        const result = await subscribe(phone);
        showCodeEntry(result.phone || phone);
      } catch (error) {
        btn.disabled = false;
        btn.textContent = 'Text me a code';
        showFieldError(panel, errorMessage(String(error?.message || error)));
      }
    });
  };

  function setButtonState(state) {
    const button = document.getElementById(BUTTON_ID);
    if (!button) return;
    if (state === 'on') {
      button.textContent = '📱 Text Alerts On';
      button.style.borderColor = '#f26b21';
      button.style.background = '#161c21';
    } else {
      button.textContent = '📱 Text Alerts';
      button.style.borderColor = 'rgba(255,255,255,.18)';
      button.style.background = '#11161b';
    }
  }

  async function openFlow() {
    const button = document.getElementById(BUTTON_ID);
    const old = button.textContent;
    button.disabled = true;
    button.textContent = 'Checking…';
    try {
      const status = await getStatus();
      button.textContent = old;
      button.disabled = false;
      if (!status.configured) { showMessage('Text alerts unavailable', errorMessage('sms_not_configured')); return; }
      if (status.subscribed && status.verified) { showManage(status); return; }
      if (status.subscribed && !status.verified) { showCodeEntry(); return; }
      showPhoneEntry();
    } catch (error) {
      button.textContent = old;
      button.disabled = false;
      const code = String(error?.message || error);
      showMessage('Text alerts', errorMessage(code));
    }
  }

  function installButton() {
    if (document.getElementById(BUTTON_ID)) return;
    const button = document.createElement('button');
    button.id = BUTTON_ID;
    button.type = 'button';
    button.textContent = '📱 Text Alerts';
    button.title = 'Get a text when a qualifying deal is found';
    button.setAttribute('aria-label', 'Turn on Mike text alerts');
    button.style.cssText = 'position:fixed;left:14px;bottom:64px;margin:0;padding:10px 14px;border:1px solid rgba(255,255,255,.18);border-radius:999px;background:#11161b;color:#fff;font:700 13px system-ui,sans-serif;cursor:pointer;z-index:10000;box-shadow:0 8px 24px rgba(0,0,0,.3);';
    button.addEventListener('click', openFlow);
    document.body.appendChild(button);
  }

  async function boot() {
    try {
      if (!(await isOwner())) return;
      installButton();
    }
    catch (error) { console.warn('[sms] unavailable:', error?.message || error); }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
