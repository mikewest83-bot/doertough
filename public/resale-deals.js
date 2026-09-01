(() => {
  const BUTTON_ID = 'mike-resale-deals';
  const TOKEN_KEY = 'mike_token';
  const LOCATION_KEY = 'mike_location';

  const token = () => { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; } };
  const savedLocation = () => { try { return JSON.parse(localStorage.getItem(LOCATION_KEY) || 'null'); } catch { return null; } };

  const reverseGeocode = async (latitude, longitude) => {
    try {
      const url = `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${encodeURIComponent(latitude)}&longitude=${encodeURIComponent(longitude)}&localityLanguage=en`;
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error('reverse_geocode_failed');
      const data = await res.json();
      const city = data.city || data.locality || data.principalSubdivision || '';
      const state = data.principalSubdivision || '';
      const postal = data.postcode || '';
      return [city, state, postal].filter((v, i, a) => v && a.indexOf(v) === i).join(', ');
    } catch { return ''; }
  };

  const locate = () => new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('location_unavailable'));
    navigator.geolocation.getCurrentPosition(async ({ coords }) => {
      const { latitude, longitude } = coords;
      const value = await reverseGeocode(latitude, longitude) || `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
      const location = { value, latitude, longitude, updatedAt: Date.now() };
      try { localStorage.setItem(LOCATION_KEY, JSON.stringify(location)); } catch {}
      resolve(location);
    }, reject, { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 });
  });

  const askMike = async (location) => {
    const auth = token();
    if (!auth) throw new Error('sign_in_required');
    const message = `Start my local resale deal scan. Search for current public listings within 25 miles of ${location.value}. I want items I can buy and resell for profit. Use "resale opportunities" as the category, prioritize risk-adjusted profit, and keep checking every 15 minutes. Do not invent listings, prices, resale values, or profit.`;
    const res = await fetch('/api/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth}` },
      body: JSON.stringify({ message, history: [] }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `request_failed_${res.status}`);
    return String(data.text || 'Mike did not return a result.');
  };

  const show = (button, title, text) => {
    let panel = document.getElementById(`${BUTTON_ID}-panel`);
    if (!panel) {
      panel = document.createElement('div');
      panel.id = `${BUTTON_ID}-panel`;
      panel.style.cssText = 'position:fixed;right:14px;bottom:70px;width:min(420px,calc(100vw - 28px));max-height:60vh;overflow:auto;padding:16px;border:1px solid rgba(255,255,255,.16);border-radius:16px;background:#111;color:#fff;box-shadow:0 12px 40px rgba(0,0,0,.45);z-index:10000;font:14px/1.45 system-ui,sans-serif;white-space:pre-wrap;';
      document.body.appendChild(panel);
    }
    panel.innerHTML = `<strong>${title}</strong><br><br>${text.replace(/[&<>]/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;' }[c]))}`;
  };

  const run = async (button) => {
    button.disabled = true;
    const old = button.textContent;
    button.textContent = '🔎 Finding deals…';
    try {
      let location = savedLocation();
      if (!location?.value) location = await locate();
      const result = await askMike(location);
      show(button, `Resale scan — ${location.value}`, result);
      button.textContent = '💰 Resale Deals';
    } catch (error) {
      const code = String(error?.message || error);
      if (code === 'sign_in_required') show(button, 'Sign in required', 'Sign in to Mike first so the scan can be saved to your account.');
      else if (code.includes('denied') || code.includes('location')) show(button, 'Location needed', 'Allow location access so Mike can search the area around you.');
      else show(button, 'Resale scan failed', code);
      button.textContent = old;
    } finally { button.disabled = false; }
  };

  const boot = () => {
    if (document.getElementById(BUTTON_ID)) return;
    const button = document.createElement('button');
    button.id = BUTTON_ID;
    button.type = 'button';
    button.textContent = '💰 Resale Deals';
    button.title = 'Find local deals you can buy and resell for profit';
    button.setAttribute('aria-label', 'Find local resale deals');
    button.style.cssText = 'position:fixed;right:14px;bottom:14px;margin:0;padding:10px 14px;border:1px solid rgba(255,255,255,.18);border-radius:999px;background:#1677ff;color:#fff;font:700 13px system-ui,sans-serif;cursor:pointer;z-index:10001;box-shadow:0 8px 24px rgba(0,0,0,.3);';
    button.addEventListener('click', () => run(button));
    document.body.appendChild(button);
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true }); else boot();
})();
