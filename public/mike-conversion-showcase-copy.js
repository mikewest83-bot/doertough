(() => {
  const cards = [
    ['💰','Find better deals','Spot resale opportunities and figure out what a deal is really worth.'],
    ['🎙️','Talk it out','Use Mike by voice when typing is the last thing you want to do.'],
    ['📷','Show Mike','Send a photo and let Mike identify, size up, and explain what you’re looking at.']
  ];
  const ready = () => {
    if (document.querySelector('.mike-value-strip') || !document.querySelector('.copy')) return;
    const anchor = document.querySelector('.trust-row') || document.querySelector('.action-starters');
    if (!anchor?.parentNode) return;
    const strip = document.createElement('div');
    strip.className = 'mike-value-strip';
    strip.setAttribute('aria-label','What Mike can do');
    strip.innerHTML = cards.map(([icon,title,desc]) => '<div class="mike-value-card"><div class="mike-value-icon">'+icon+'</div><strong>'+title+'</strong><span>'+desc+'</span></div>').join('');
    anchor.parentNode.insertBefore(strip, anchor);
    const proof = document.createElement('div');
    proof.className = 'mike-proof-line';
    proof.innerHTML = '<span><b>✓</b> 7-day free trial</span><span><b>✓</b> No card to start</span><span><b>✓</b> Voice + text + photo</span>';
    strip.parentNode.insertBefore(proof, strip.nextSibling);
  };
  const observer = new MutationObserver(ready);
  observer.observe(document.body,{childList:true,subtree:true});
  ready(); setTimeout(ready,500); setTimeout(ready,1500);
})();
