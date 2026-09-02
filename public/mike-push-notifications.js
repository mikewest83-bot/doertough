(() => {
  const TOKEN_KEY = 'mike_token';
  const BUTTON_ID = 'mike-push-alerts';
  const VAPID_URL = '/api/push/public-key';
  const SW_URL = '/mike-push-sw.js';

  const token = () => { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; } };
  const base64ToUint8 = (value) => {
    const padding = '='.repeat((4 - value.length % 4) % 4);
    const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(base64);
    return Uint8Array.from(raw, (char) => char.charCodeAt(0));
  };

  async function subscribe() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
      throw new Error('push_not_supported');
    }
    const auth = token();
    if (!auth) throw new Error('sign_in_required');
    const keyResponse = await fetch(VAPID_URL, { headers: { Accept: 'application/json' } });
    const keyData = await keyResponse.json().catch(() => ({}));
    if (!keyResponse.ok || !keyData.publicKey) throw new Error(keyData.error || 'push_not_configured');

    const permission = Notification.permission === 'granted'
      ? 'granted'
      : await Notification.requestPermission();
    if (permission !== 'granted') throw new Error('push_permission_denied');

    const registration = await navigator.serviceWorker.register(SW_URL, { scope: '/' });
    await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64ToUint8(keyData.publicKey),
      });
    }
    const response = await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth}` },
      body: JSON.stringify({ subscription: subscription.toJSON() }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `push_subscribe_failed_${response.status}`);
    return subscription;
  }

  function installButton() {
    if (document.getElementById(BUTTON_ID)) return;
    const button = document.createElement('button');
    button.id = BUTTON_ID;
    button.type = 'button';
    button.textContent = '🔔 Deal Alerts';
    button.title = 'Get a Mike notification when a qualifying deal is found';
    button.setAttribute('aria-label', 'Turn on Mike deal alerts');
    button.style.cssText = 'position:fixed;left:14px;bottom:14px;margin:0;padding:10px 14px;border:1px solid rgba(255,255,255,.18);border-radius:999px;background:#11161b;color:#fff;font:700 13px system-ui,sans-serif;cursor:pointer;z-index:10000;box-shadow:0 8px 24px rgba(0,0,0,.3);';
    button.addEventListener('click', async () => {
      button.disabled = true;
      const old = button.textContent;
      button.textContent = '🔔 Turning alerts on…';
      try {
        await subscribe();
        button.textContent = '🔔 Deal Alerts On';
        button.style.borderColor = '#f26b21';
        button.style.background = '#161c21';
      } catch (error) {
        const code = String(error?.message || error);
        if (code === 'sign_in_required') alert('Sign in to Mike first, then turn on Deal Alerts.');
        else if (code === 'push_permission_denied') alert('Deal alerts are off. Allow notifications for Mike in your browser settings when you are ready.');
        else if (code === 'push_not_supported') alert('This browser does not support Mike push alerts.');
        else if (code === 'push_not_configured') alert('Mike deal alerts are being finished on the server. Try again shortly.');
        else alert('Mike could not turn on deal alerts. Try again in a moment.');
        button.textContent = old;
      } finally { button.disabled = false; }
    });
    document.body.appendChild(button);
  }

  async function boot() {
    try {
      if (!('serviceWorker' in navigator)) return;
      await navigator.serviceWorker.register(SW_URL, { scope: '/' });
      const keyResponse = await fetch(VAPID_URL, { headers: { Accept: 'application/json' } });
      if (!keyResponse.ok) return;
      const keyData = await keyResponse.json().catch(() => ({}));
      if (keyData.publicKey) installButton();
    } catch (error) { console.warn('[push] unavailable:', error?.message || error); }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
