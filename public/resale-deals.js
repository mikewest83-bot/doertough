(() => {
  const BUTTON_ID = 'mike-resale-deals';
  const TOKEN_KEY = 'mike_token';
  const LOCATION_KEY = 'mike_location';
  const ZIP_KEY = 'mike_resale_zip';

  const token = () => { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; } };
  const savedZip = () => { try { return localStorage.getItem(ZIP_KEY) || ''; } catch { return ''; } };
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));

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

  const saveLocation = (value, latitude, longitude, source = 'gps', zip = '') => {
    const location = { value, latitude, longitude, source, zip: zip || '', updatedAt: Date.now() };
    try { localStorage.setItem(LOCATION_KEY, JSON.stringify(location)); } catch {}
    if (zip) { try { localStorage.setItem(ZIP_KEY, zip); } catch {} }
    return location;
  };

  const locateGps = () => new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('location_unavailable'));
    navigator.geolocation.getCurrentPosition(async ({ coords }) => {
      const { latitude, longitude } = coords;
      const value = await reverseGeocode(latitude, longitude) || `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
      resolve(saveLocation(value, latitude, longitude, 'gps'));
    }, reject, { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 });
  });

  const locateByIp = async () => {
    const res = await fetch('https://ipapi.co/json/', { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error('ip_location_failed');
    const data = await res.json();
    const latitude = Number(data.latitude);
    const longitude = Number(data.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) throw new Error('ip_location_failed');
    const zip = String(data.postal || '').trim();
    const value = [data.city, data.region, zip].filter(Boolean).join(', ') || `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
    return saveLocation(value, latitude, longitude, 'ip', zip);
  };

  const locateByZip = async (zip) => {
    const cleanZip = String(zip || '').replace(/\D/g, '').slice(0, 5);
    if (!/^\d{5}$/.test(cleanZip)) throw new Error('invalid_zip');
    const res = await fetch(`https://api.zippopotam.us/us/${cleanZip}`, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error('zip_not_found');
    const data = await res.json();
    const place = data.places?.[0];
    const latitude = Number(place?.latitude);
    const longitude = Number(place?.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) throw new Error('zip_not_found');
    const city = place['place name'] || '';
    const state = place['state abbreviation'] || place.state || '';
    return saveLocation(`${city}, ${state}, ${cleanZip}`, latitude, longitude, 'zip', cleanZip);
  };

  const getCurrentLocation = async () => {
    try { return await locateGps(); }
    catch (gpsError) {
      try { return await locateByIp(); }
      catch { throw gpsError; }
    }
  };

  const askMike = async (location, frequencyMinutes) => {
    const auth = token();
    if (!auth) throw new Error('sign_in_required');
    const cadence = Number(frequencyMinutes) === 60 ? 'every hour' : `every ${frequencyMinutes} minutes`;
    const precision = location.source === 'gps' ? 'device GPS' : location.source === 'zip' ? 'ZIP-code center' : 'coarse IP-based location';
    const message = `Create my local resale deal watch using my current location from ${precision}: ${location.value} (latitude ${location.latitude}, longitude ${location.longitude}). Search current public listings within 25 miles of those coordinates. I want items I can buy and resell for profit. Create a persistent resale watch that scans ${cadence}, uses a minimum estimated net profit of $300 and minimum ROI of 30%, prioritizes risk-adjusted profit, and only alerts me to new credible opportunities. Do not invent listings, prices, resale values, or profit. Do not automate access to marketplaces that prohibit automated collection or require login.`;
    const res = await fetch('/api/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth}` },
      body: JSON.stringify({ message, history: [] }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `request_failed_${res.status}`);
    return String(data.text || 'Mike did not return a result.');
  };

  const ensurePanel = () => {
    let panel = document.getElementById(`${BUTTON_ID}-panel`);
    if (!panel) {
      panel = document.createElement('div');
      panel.id = `${BUTTON_ID}-panel`;
      document.body.appendChild(panel);
    }
    panel.style.cssText = 'position:fixed;left:14px;right:14px;bottom:78px;width:auto;max-height:min(68vh,620px);overflow:auto;padding:20px;border:1px solid rgba(255,255,255,.16);border-radius:20px;background:rgba(17,17,17,.98);color:#fff;box-shadow:0 18px 50px rgba(0,0,0,.5);z-index:10002;font:15px/1.5 system-ui,sans-serif;white-space:normal;opacity:0;transform:translateY(14px);transition:opacity .22s ease,transform .22s ease;';
    return panel;
  };

  const openPanel = (panel) => requestAnimationFrame(() => { panel.style.opacity = '1'; panel.style.transform = 'translateY(0)'; });

  const closePanel = () => new Promise((resolve) => {
    const panel = document.getElementById(`${BUTTON_ID}-panel`);
    if (!panel) return resolve();
    panel.style.opacity = '0';
    panel.style.transform = 'translateY(14px)';
    window.setTimeout(() => { panel.remove(); resolve(); }, 230);
  });

  const show = (title, text, location = null) => {
    const panel = ensurePanel();
    const locationLine = location ? `<div style="margin-top:10px;color:#aaa;font-size:13px">Scanning <strong style="color:#ddd">${escapeHtml(location.value)}</strong> · 25-mile radius</div>` : '';
    panel.innerHTML = `<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px"><div><div style="font-size:18px;font-weight:800">${escapeHtml(title)}</div>${locationLine}</div><button type="button" data-close style="flex:0 0 auto;border:0;background:transparent;color:#aaa;font-size:24px;line-height:1;padding:0;cursor:pointer" aria-label="Close">×</button></div><div style="margin-top:18px;white-space:pre-wrap">${escapeHtml(text)}</div>`;
    panel.querySelector('[data-close]').addEventListener('click', closePanel, { once: true });
    openPanel(panel);
  };

  const chooseFrequency = (location) => {
    const panel = ensurePanel();
    const currentZip = location.zip || savedZip() || '';
    panel.innerHTML = `<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px"><div><div style="font-size:18px;font-weight:800">Set up Resale Deals</div><div style="margin-top:5px;color:#aaa">Mike will scan for credible opportunities within 25 miles.</div></div><button type="button" data-close style="flex:0 0 auto;border:0;background:transparent;color:#aaa;font-size:24px;line-height:1;padding:0;cursor:pointer" aria-label="Close">×</button></div><div style="margin-top:18px"><label for="mike-resale-zip" style="display:block;font-weight:700;margin-bottom:7px">Search ZIP code</label><input id="mike-resale-zip" inputmode="numeric" autocomplete="postal-code" maxlength="5" placeholder="Use current location" value="${escapeHtml(currentZip)}" style="box-sizing:border-box;width:100%;padding:12px 13px;border-radius:12px;border:1px solid #444;background:#222;color:#fff;font:inherit;outline:none"/><div style="margin-top:7px;color:#888;font-size:12px">GPS found: ${escapeHtml(location.value)}</div></div><div style="margin-top:18px;font-weight:700">How often should Mike alert you?</div><div style="display:grid;gap:9px;margin-top:10px"><button data-freq="15" style="padding:13px;border-radius:12px;border:1px solid #444;background:#222;color:#fff;font:600 15px system-ui,sans-serif">Every 15 minutes</button><button data-freq="30" style="padding:13px;border-radius:12px;border:1px solid #444;background:#222;color:#fff;font:600 15px system-ui,sans-serif">Every 30 minutes</button><button data-freq="60" style="padding:13px;border-radius:12px;border:1px solid #444;background:#222;color:#fff;font:600 15px system-ui,sans-serif">Hourly</button></div>`;
    panel.querySelector('[data-close]').addEventListener('click', closePanel, { once: true });
    openPanel(panel);
    return new Promise((resolve) => {
      let settled = false;
      const finish = (value) => { if (settled) return; settled = true; resolve(value); };
      panel.querySelectorAll('[data-freq]').forEach((choice) => choice.addEventListener('click', async () => {
        const zipInput = panel.querySelector('#mike-resale-zip');
        const zip = String(zipInput?.value || '').replace(/\D/g, '').slice(0, 5);
        try {
          let selectedLocation = location;
          if (zip) {
            if (!/^\d{5}$/.test(zip)) throw new Error('invalid_zip');
            choice.disabled = true;
            choice.textContent = '📍 Using ZIP…';
            selectedLocation = await locateByZip(zip);
          }
          finish({ frequency: Number(choice.dataset.freq), location: selectedLocation });
        } catch (error) {
          choice.disabled = false;
          choice.textContent = Number(choice.dataset.freq) === 60 ? 'Hourly' : `Every ${choice.dataset.freq} minutes`;
          const code = String(error?.message || error);
          const errorEl = document.createElement('div');
          errorEl.style.cssText = 'margin-top:10px;color:#ff9d6c;font-size:13px';
          errorEl.textContent = code === 'invalid_zip' ? 'Enter a valid 5-digit ZIP code.' : 'That ZIP code could not be located. Try again or leave it blank to use GPS.';
          panel.querySelector('[data-error]')?.remove();
          errorEl.dataset.error = '1';
          panel.querySelector('#mike-resale-zip').after(errorEl);
        }
      }));
      panel.querySelector('#mike-resale-zip')?.addEventListener('input', (event) => { event.target.value = event.target.value.replace(/\D/g, '').slice(0, 5); });
    });
  };

  const run = async (button) => {
    button.disabled = true;
    const old = button.textContent;
    button.textContent = '📍 Finding your location…';
    try {
      const gpsLocation = await getCurrentLocation();
      const selection = await chooseFrequency(gpsLocation);
      await closePanel();
      button.textContent = selection.frequency === 60 ? '⏰ Setting hourly watch…' : `⏰ Setting ${selection.frequency}-minute watch…`;
      const result = await askMike(selection.location, selection.frequency);
      show('Resale watch is active', result, selection.location);
      button.textContent = '💰 Resale Deals';
    } catch (error) {
      const code = String(error?.message || error);
      if (code === 'sign_in_required') show('Sign in required', 'Sign in to Mike first so the scan can be saved to your account.');
      else if (code.includes('denied') || code.includes('location')) show('Location unavailable', 'Mike could not get a device GPS location. Check Chrome/Safari location permission for doertoughmikeai.com and try again.');
      else show('Resale watch failed', code);
      button.textContent = old;
    } finally { button.disabled = false; }
  };

  const warmCurrentLocation = async () => {
    try {
      if (!navigator.permissions?.query) return;
      const permission = await navigator.permissions.query({ name: 'geolocation' });
      if (permission.state === 'granted') await locateGps();
      permission.onchange = async () => { if (permission.state === 'granted') { try { await locateGps(); } catch {} } };
    } catch {}
  };

  const boot = () => {
    if (document.getElementById(BUTTON_ID)) return;
    const button = document.createElement('button');
    button.id = BUTTON_ID;
    button.type = 'button';
    button.textContent = '💰 Resale Deals';
    button.title = 'Find local deals you can buy and resell for profit';
    button.setAttribute('aria-label', 'Find local resale deals');
    button.style.cssText = 'position:fixed;right:14px;bottom:14px;margin:0;padding:10px 14px;border:1px solid rgba(255,255,255,.18);border-radius:999px;background:#1677ff;color:#fff;font:700 13px system-ui,sans-serif;cursor:pointer;z-index:10001;box-shadow:0 8px 24px rgba(0,0,0,.3);transition:transform .18s ease,opacity .18s ease;';
    button.addEventListener('click', () => run(button));
    document.body.appendChild(button);
    warmCurrentLocation();
  };

  const wireFindMeADeal = () => {
    document.addEventListener('click', (event) => {
      const target = event.target?.closest?.('button.action-starter');
      if (!target || target.textContent.trim() !== 'Find me a deal') return;
      const resaleButton = document.getElementById(BUTTON_ID);
      if (!resaleButton || resaleButton.disabled) return;
      event.preventDefault();
      event.stopPropagation();
      run(resaleButton);
    }, true);
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { boot(); wireFindMeADeal(); }, { once: true });
  else { boot(); wireFindMeADeal(); }
})();