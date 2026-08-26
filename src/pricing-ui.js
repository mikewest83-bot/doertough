// Mike AI pricing/campaign override.
// Keeps the existing checkout wiring intact while updating the offer language.
// Stripe's actual recurring price must be changed in Stripe before launch.
//
// FREEZE FIX: this file previously ran `new MutationObserver(patch)` against
// the whole document while `patch()` itself wrote to the DOM. Assigning
// innerHTML replaces child nodes even when the markup is byte-identical, so
// every patch fired a fresh mutation, which called patch again - an infinite
// loop that pinned the main thread and froze the entire page on load. Every
// button on the site looked dead because nothing else could run.
//
// Three independent guards now, any one of which alone would break the loop:
//   1. writes are idempotent - nothing is assigned unless it actually differs
//   2. the observer is disconnected while patching and reconnected after
//   3. a re-entry flag stops patch() running inside itself
(() => {
  const PRICE = '$24.99';
  let observer = null;
  let patching = false;

  // Only write when the value genuinely changes. This alone stops the loop.
  const setHTML = (el, html) => {
    if (!el || el.innerHTML === html) return;
    el.innerHTML = html;
  };

  const applyCopy = () => {
    setHTML(
      document.getElementById('mike-subscribe-button'),
      'MIKE AI PRO<span class="sub-small">3 DAYS FREE</span>'
    );

    const modal = document.getElementById('mike-pro-modal');
    if (!modal) return;

    setHTML(modal.querySelector('.pro-price'), PRICE + ' <small>/ month</small>');

    const features = modal.querySelector('.features');
    if (features) {
      const items = features.querySelectorAll('.feature');
      setHTML(
        items[2],
        '<span class="check">\u2713</span><span><strong>Unlimited Mike.</strong> Talk as much as you want \u2014 no minute counter and no surprise overage charges.</span>'
      );
      setHTML(
        items[3],
        '<span class="check">\u2713</span><span><strong>Can you break Mike?</strong> If your monthly usage crosses the Mike Challenge threshold, we give you the next month free.</span>'
      );
    }

    const note = modal.querySelector('.pro-note');
    if (note && !note.dataset.pricingPatched) {
      note.innerHTML =
        "Secure checkout powered by Stripe. You won't be charged during the 3-day trial. " +
        'After the trial, your subscription renews at ' + PRICE + '/month unless canceled.' +
        '<br><a href="/terms.html">Terms</a> \u00b7 <a href="/privacy.html">Privacy</a> \u00b7 <a href="/refunds.html">Refunds</a>';
      note.dataset.pricingPatched = '1';
    }
  };

  const patch = () => {
    if (patching) return;
    patching = true;
    if (observer) observer.disconnect();
    try {
      applyCopy();
    } catch (err) {
      // Never let a copy tweak take the page down with it.
      console.error('[pricing-ui] patch failed:', err);
    } finally {
      if (observer) observer.observe(document.body, { childList: true, subtree: true });
      patching = false;
    }
  };

  const start = () => {
    // document.body, not documentElement: the subscribe button and the modal
    // both live in the body, and watching the whole document also picked up
    // Vite's stylesheet injection into <head> for no benefit.
    observer = new MutationObserver(patch);
    observer.observe(document.body, { childList: true, subtree: true });
    patch();
  };

  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start, { once: true });
})();
