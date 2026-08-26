// Mike AI pricing consistency guard.
// Customer-facing Pro pricing lives in the main subscription UI and billing system.
// This file only normalizes legacy DOM copy; it must never introduce a conflicting offer.
(() => {
  const PRICE = '$24.99';
  let observer = null;
  let patching = false;

  const setHTML = (el, html) => {
    if (!el || el.innerHTML === html) return;
    el.innerHTML = html;
  };

  const applyCopy = () => {
    setHTML(document.getElementById('mike-subscribe-button'), 'MIKE AI PRO<span class="sub-small">3 DAYS FREE</span>');
    const modal = document.getElementById('mike-pro-modal');
    if (!modal) return;
    setHTML(modal.querySelector('.pro-price'), PRICE + ' <small>/ month</small>');
    const features = modal.querySelector('.features');
    if (features) {
      const items = features.querySelectorAll('.feature');
      setHTML(items[2], '<span class="check">✓</span><span><strong>No customer-facing minute counter.</strong> Talk with Mike without surprise overage charges.</span>');
      setHTML(items[3], '<span class="check">✓</span><span><strong>1% of every Pro subscription</strong> supports permanent carbon removal through Stripe Climate.</span>');
    }
    const note = modal.querySelector('.pro-note');
    if (note && !note.dataset.pricingPatched) {
      note.innerHTML = "Secure checkout powered by Stripe. You won't be charged during the 3-day trial. After the trial, your subscription renews at " + PRICE + "/month unless canceled." + '<br><a href="/terms.html">Terms</a> · <a href="/privacy.html">Privacy</a> · <a href="/refunds.html">Refunds</a>';
      note.dataset.pricingPatched = '1';
    }
  };

  const patch = () => {
    if (patching) return;
    patching = true;
    if (observer) observer.disconnect();
    try { applyCopy(); }
    catch (err) { console.error('[pricing-ui] patch failed:', err); }
    finally {
      if (observer) observer.observe(document.body, { childList: true, subtree: true });
      patching = false;
    }
  };

  const start = () => {
    observer = new MutationObserver(patch);
    observer.observe(document.body, { childList: true, subtree: true });
    patch();
  };

  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start, { once: true });
})();
