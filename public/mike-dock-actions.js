// Docks the floating action chips into one row under the composer.
//
// Text Alerts, Deal Alerts and Resale Deals each pinned themselves to a corner
// of the viewport with position:fixed, so on every screen they sat on top of
// whatever was underneath - the orb on phones, the games heading on desktop -
// and three unrelated dark pills floating over the page is the main thing that
// made a finished product look unfinished. None of them owns a persistent
// state that needs to follow the scroll; they are entry points, so they belong
// with the other entry points.
//
// Each button is moved, not recreated: the click handlers those scripts
// attached come along with the node. Their panels are separately position:fixed
// and are not touched. Safe to run before the buttons exist - the observer
// picks up whichever arrive late.
(function () {
  const ROW_ID = 'mike-quick-actions';
  const BUTTON_IDS = ['mike-use-my-location', 'mike-sms-alerts', 'mike-push-alerts', 'mike-resale-deals'];
  const ANCHORS = ['#mike-vision-wrap', 'main form', '.vision-tab-row'];

  const getRow = () => {
    const existing = document.getElementById(ROW_ID);
    if (existing) return existing;
    const anchor = ANCHORS.reduce((found, sel) => found || document.querySelector(sel), null);
    if (!anchor?.parentElement) return null;
    const row = document.createElement('div');
    row.id = ROW_ID;
    row.style.cssText = 'display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:8px;width:min(560px,88%);margin:12px auto 2px;box-sizing:border-box';
    anchor.parentElement.insertBefore(row, anchor.nextSibling);
    return row;
  };

  const dock = () => {
    const row = getRow();
    if (!row) return false;
    let docked = 0;
    for (const id of BUTTON_IDS) {
      const button = document.getElementById(id);
      if (!button) continue;
      docked += 1;
      if (button.parentElement === row) continue;
      // Clear the corner pinning before the move, or the button keeps floating
      // in its new parent.
      button.style.position = 'static';
      button.style.top = '';
      button.style.right = '';
      button.style.bottom = '';
      button.style.left = '';
      button.style.zIndex = '';
      button.style.margin = '0';
      button.style.width = 'auto';
      button.style.display = 'inline-flex';
      button.style.alignSelf = 'center';
      row.appendChild(button);
    }
    return docked === BUTTON_IDS.length;
  };

  const boot = () => {
    if (dock()) return;
    const observer = new MutationObserver(() => { if (dock()) observer.disconnect(); });
    observer.observe(document.body, { childList: true, subtree: true });
    // The scripts that create these buttons boot on DOMContentLoaded like this
    // one, and a button appended inside the same tick can land before the
    // observer is wired, so stop watching on a timer rather than never.
    setTimeout(() => observer.disconnect(), 20000);
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
