// Mike AI pricing/campaign override.
// Keeps the existing checkout wiring intact while updating the offer language.
// Stripe's actual recurring price must be changed in Stripe before launch.
(() => {
  const PRICE = '$24.99';
  const patch = () => {
    const button = document.getElementById('mike-subscribe-button');
    if (button) button.innerHTML = 'MIKE AI PRO<span class="sub-small">3 DAYS FREE</span>';

    const modal = document.getElementById('mike-pro-modal');
    if (!modal) return;

    const price = modal.querySelector('.pro-price');
    if (price) price.innerHTML = `${PRICE} <small>/ month</small>`;

    const features = modal.querySelector('.features');
    if (features) {
      const items = features.querySelectorAll('.feature');
      if (items[2]) items[2].innerHTML = '<span class="check">✓</span><span><strong>Unlimited Mike.</strong> Talk as much as you want — no minute counter and no surprise overage charges.</span>';
      if (items[3]) items[3].innerHTML = '<span class="check">✓</span><span><strong>Can you break Mike?</strong> If your monthly usage crosses the Mike Challenge threshold, we give you the next month free.</span>';
    }

    const note = modal.querySelector('.pro-note');
    if (note && !note.dataset.pricingPatched) {
      note.innerHTML = `Secure checkout powered by Stripe. You won't be charged during the 3-day trial. After the trial, your subscription renews at ${PRICE}/month unless canceled.<br><a href="/terms.html">Terms</a> · <a href="/privacy.html">Privacy</a> · <a href="/refunds.html">Refunds</a>`;
      note.dataset.pricingPatched = '1';
    }
  };

  const observer = new MutationObserver(patch);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  patch();
})();
