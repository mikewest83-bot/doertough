(() => {
  const BUTTON_ID = 'mike-use-my-location';
  const STORAGE_KEY = 'mike_location';
  const LOCATION_EVENT = 'mike-location-ready';

  const LOCATE_ICON = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex:0 0 auto"><circle cx="12" cy="12" r="3"></circle><path d="M12 2v3M12 19v3M2 12h3M19 12h3"></path><circle cx="12" cy="12" r="8"></circle></svg>';

  const getLocationInput = () => {
    const fields = [...document.querySelectorAll('input, textarea')];
    return fields.find((el) => {
      const text = `${el.placeholder || ''} ${el.name || ''} ${el.getAttribute('aria-label') || ''}`.toLowerCase();
      return /location|city|zip|postal/.test(text);
    }) || null;
  };

  const setReactValue = (element, value) => {
    const proto = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    setter?.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  };

  const reverseGeocode = async (latitude, longitude) => {
    try {
      const url = `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${encodeURIComponent(latitude)}&longitude=${encodeURIComponent(longitude)}&localityLanguage=en`;
      const response = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error('reverse_geocode_failed');
      const data = await response.json();
      const city = data.city || data.locality || data.principalSubdivision || '';
      const state = data.principalSubdivision || '';
      const postal = data.postcode || '';
      return [city, state, postal].filter((value, index, array) => value && array.indexOf(value) === index).join(', ');
    } catch {
      return '';
    }
  };

  const setLabel = (button, text) => {
    const label = button.querySelector('.mike-loc-label');
    if (label) label.textContent = text;
  };

  const showStatus = (button, message, error = false) => {
    setLabel(button, message);
    button.dataset.error = error ? '1' : '0';
    window.setTimeout(() => {
      if (document.getElementById(BUTTON_ID) === button) setLabel(button, 'Use My Location');
    }, 3500);
  };

  const locate = async (button) => {
    if (!navigator.geolocation) {
      showStatus(button, 'Location unavailable', true);
      return;
    }
    button.disabled = true;
    setLabel(button, 'Finding you…');
    navigator.geolocation.getCurrentPosition(async ({ coords }) => {
      const { latitude, longitude } = coords;
      const place = await reverseGeocode(latitude, longitude);
      const value = place || `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ value, latitude, longitude, updatedAt: Date.now() }));
      const input = getLocationInput();
      if (input) setReactValue(input, value);
      window.dispatchEvent(new CustomEvent(LOCATION_EVENT, { detail: { value, latitude, longitude } }));
      showStatus(button, place || 'Location ready');
      button.disabled = false;
    }, (error) => {
      const message = error.code === 1 ? 'Allow location access' : 'Could not get location';
      showStatus(button, message, true);
      button.disabled = false;
    }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 });
  };

  const addButton = () => {
    if (document.getElementById(BUTTON_ID)) return;
    const input = getLocationInput();
    const button = document.createElement('button');
    button.id = BUTTON_ID;
    button.type = 'button';
    button.innerHTML = `${LOCATE_ICON}<span class="mike-loc-label">Use My Location</span>`;
    button.title = 'Use your device location for nearby searches';
    button.setAttribute('aria-label', 'Use My Location');
    button.style.cssText = 'display:inline-flex;align-items:center;gap:7px;margin:6px 0;padding:10px 14px;border:1px solid rgba(255,255,255,.18);border-radius:999px;background:#11161b;color:#fff;font:700 13px system-ui,sans-serif;cursor:pointer;box-shadow:0 8px 24px rgba(0,0,0,.3);transition:transform .15s ease,border-color .15s ease;';
    button.addEventListener('mouseenter', () => { button.style.borderColor = 'rgba(39,169,255,.6)'; button.style.transform = 'translateY(-1px)'; });
    button.addEventListener('mouseleave', () => { button.style.borderColor = 'rgba(255,255,255,.18)'; button.style.transform = 'none'; });
    button.addEventListener('click', () => locate(button));
    if (input?.parentElement) input.parentElement.insertBefore(button, input);
    else document.body.appendChild(button);
    if (!input?.parentElement) {
      button.style.position = 'fixed';
      button.style.right = '14px';
      // Keep the location control above the fixed Resale Deals CTA instead of overlapping it.
      button.style.bottom = '84px';
      button.style.zIndex = '9998';
    }
  };

  const boot = () => { addButton(); new MutationObserver(addButton).observe(document.body, { childList: true, subtree: true }); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true }); else boot();
})();
