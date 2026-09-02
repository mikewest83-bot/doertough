(() => {
  const TOKEN_KEY = 'mike_token';
  const REF_KEY = 'mike_referral_code';
  const readToken = () => { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; } };
  const saveRef = (code) => { try { if (code) localStorage.setItem(REF_KEY, code); } catch {} };
  const readRef = () => { try { return localStorage.getItem(REF_KEY) || ''; } catch { return ''; } };
  const clearReferral = () => { try { localStorage.removeItem(REF_KEY); } catch {} };

  const url = new URL(window.location.href);
  const incomingRef = String(url.searchParams.get('ref') || '').trim().toUpperCase();
  if (incomingRef) saveRef(incomingRef);

  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    try {
      const requestUrl = typeof input === 'string' ? input : input?.url || '';
      if (requestUrl.includes('/api/auth/register') && init?.body) {
        const body = JSON.parse(init.body);
        const code = readRef();
        if (code && !body.referralCode) {
          init = { ...init, body: JSON.stringify({ ...body, referralCode: code }) };
        }
        const response = await nativeFetch(input, init);
        if (response.ok && code) clearReferral();
        return response;
      }
    } catch {}
    return nativeFetch(input, init);
  };

  const styles = `
    #mike-months-card{position:fixed;right:18px;bottom:18px;z-index:9998;width:min(360px,calc(100vw - 36px));display:none;padding:18px;border:1px solid rgba(255,255,255,.14);border-radius:18px;background:rgba(15,18,24,.96);box-shadow:0 16px 48px rgba(0,0,0,.35);backdrop-filter:blur(14px);color:#fff;font-family:inherit}
    #mike-months-card .mm-title{font-size:18px;font-weight:800;margin:0 0 5px}
    #mike-months-card .mm-copy{font-size:14px;line-height:1.45;opacity:.82;margin:0 0 13px}
    #mike-months-card .mm-count{font-size:28px;font-weight:900;margin:2px 0 12px}
    #mike-months-card .mm-actions{display:flex;gap:8px;align-items:center}
    #mike-months-card button{border:0;border-radius:10px;padding:10px 13px;font-weight:800;cursor:pointer}
    #mike-months-card .mm-share{background:#fff;color:#111}
    #mike-months-card .mm-close{background:transparent;color:#fff;opacity:.65;padding:8px}
    #mike-months-card .mm-link{font-size:11px;opacity:.55;word-break:break-all;margin-top:10px}
  `;
  const style = document.createElement('style');
  style.textContent = styles;
  document.head.appendChild(style);

  let card;
  let summary;

  const ensureCard = () => {
    if (card) return card;
    card = document.createElement('aside');
    card.id = 'mike-months-card';
    card.innerHTML = `
      <div class="mm-title">🎁 MIKE MONTHS</div>
      <p class="mm-copy">Give a friend Mike. Get a month free.</p>
      <div class="mm-count">0 free months earned</div>
      <div class="mm-actions">
        <button class="mm-share" type="button">INVITE A FRIEND</button>
        <button class="mm-close" type="button" aria-label="Close">×</button>
      </div>
      <div class="mm-link"></div>`;
    document.body.appendChild(card);
    card.querySelector('.mm-close').onclick = () => { card.style.display = 'none'; };
    card.querySelector('.mm-share').onclick = async () => {
      if (!summary?.link) return;
      const shareData = { title: 'Mike AI', text: 'Give a friend Mike. Get a month free.', url: summary.link };
      try {
        if (navigator.share) await navigator.share(shareData);
        else {
          await navigator.clipboard.writeText(summary.link);
          card.querySelector('.mm-share').textContent = 'LINK COPIED';
          setTimeout(() => { if (card) card.querySelector('.mm-share').textContent = 'INVITE A FRIEND'; }, 1800);
        }
      } catch {}
    };
    return card;
  };

  const hideCard = () => {
    if (card) card.style.display = 'none';
    summary = null;
  };

  const refresh = async () => {
    const token = readToken();
    if (!token) { hideCard(); return; }
    try {
      const res = await nativeFetch('/api/mike-months', { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) { hideCard(); return; }
      summary = await res.json();
      const el = ensureCard();
      el.style.display = 'block';
      const months = Number(summary.earnedMonths || 0);
      el.querySelector('.mm-count').textContent = `${months} free month${months === 1 ? '' : 's'} earned`;
      el.querySelector('.mm-link').textContent = summary.link || '';
    } catch { hideCard(); }
  };

  refresh();
  let lastToken = readToken();
  setInterval(() => {
    const token = readToken();
    if (!token) {
      if (lastToken) { lastToken = ''; hideCard(); }
      return;
    }
    if (token !== lastToken) { lastToken = token; refresh(); }
  }, 1500);
})();
