(() => {
  let deferredPrompt = null;
  const DISMISS_KEY = 'mike_install_dismissed';

  const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  const isIOS = /iphone|ipad|ipod/i.test(window.navigator.userAgent);

  const createPrompt = () => {
    if (document.getElementById('mike-install-prompt') || isStandalone()) return;
    const wrap = document.createElement('div');
    wrap.id = 'mike-install-prompt';
    wrap.setAttribute('role', 'dialog');
    wrap.innerHTML = `
      <div style="position:fixed;left:16px;right:16px;bottom:16px;z-index:99999;background:#111;border:1px solid #2f8cff;border-radius:16px;padding:16px;box-shadow:0 12px 40px rgba(0,0,0,.55);font-family:system-ui,-apple-system,sans-serif;color:#fff">
        <button id="mike-install-close" aria-label="Close" style="position:absolute;right:10px;top:8px;background:none;border:0;color:#aaa;font-size:22px;cursor:pointer">×</button>
        <div style="font-size:18px;font-weight:800;margin-bottom:5px">📱 Add Mike to your home screen</div>
        <div id="mike-install-copy" style="font-size:14px;line-height:1.4;color:#ddd;margin-right:18px">Keep Mike one tap away, like an app.</div>
        <button id="mike-install-action" style="margin-top:12px;background:#1683ff;color:#fff;border:0;border-radius:10px;padding:11px 16px;font-weight:800;font-size:14px;cursor:pointer">ADD MIKE</button>
      </div>`;
    document.body.appendChild(wrap);

    const close = () => { localStorage.setItem(DISMISS_KEY, '1'); wrap.remove(); };
    document.getElementById('mike-install-close').onclick = close;
    const action = document.getElementById('mike-install-action');

    if (isIOS) {
      document.getElementById('mike-install-copy').textContent = 'On iPhone: tap Share, then “Add to Home Screen.”';
      action.textContent = 'GOT IT';
      action.onclick = close;
    } else {
      action.onclick = async () => {
        if (!deferredPrompt) { close(); return; }
        deferredPrompt.prompt();
        try { await deferredPrompt.userChoice; } catch {}
        deferredPrompt = null;
        close();
      };
    }
  };

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event;
    if (!localStorage.getItem(DISMISS_KEY)) setTimeout(createPrompt, 1200);
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    document.getElementById('mike-install-prompt')?.remove();
  });

  document.addEventListener('DOMContentLoaded', () => {
    if (isStandalone() || localStorage.getItem(DISMISS_KEY)) return;
    if (isIOS) setTimeout(createPrompt, 1800);
  });

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
  }
})();
