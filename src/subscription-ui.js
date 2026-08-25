const STRIPE_CHECKOUT_URL = 'https://buy.stripe.com/3cI6oH8USaMXd6weqg5J600';
const STYLE_ID = 'mike-subscription-ui-style';
const BUTTON_ID = 'mike-subscribe-button';
const MODAL_ID = 'mike-pro-modal';

function installStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    #${BUTTON_ID}{appearance:none;border:1px solid rgba(255,117,34,.75);border-radius:999px;background:linear-gradient(135deg,#ff7a2b,#e95b0c);color:#fff;font:800 11px/1 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;letter-spacing:.06em;text-transform:uppercase;padding:10px 14px;cursor:pointer;box-shadow:0 5px 20px rgba(245,101,20,.18);white-space:nowrap;transition:transform .15s ease,filter .15s ease,box-shadow .15s ease}
    #${BUTTON_ID}:hover{filter:brightness(1.08);transform:translateY(-1px);box-shadow:0 7px 24px rgba(245,101,20,.28)}
    #${BUTTON_ID}:active{transform:translateY(0)}
    #${BUTTON_ID} .sub-small{display:block;font-size:8px;letter-spacing:.12em;opacity:.82;margin-top:3px}
    #${MODAL_ID}{position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(0,0,0,.78);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px)}
    #${MODAL_ID} .pro-card{position:relative;width:min(440px,calc(100vw - 32px));max-height:calc(100vh - 40px);overflow:auto;border:1px solid rgba(255,117,34,.42);border-radius:24px;background:linear-gradient(160deg,#171717,#0c0c0c);box-shadow:0 28px 90px rgba(0,0,0,.65);color:#fff;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    #${MODAL_ID} .pro-close{position:absolute;right:14px;top:14px;width:34px;height:34px;border-radius:50%;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.06);color:#fff;cursor:pointer;font-size:22px;line-height:1}
    #${MODAL_ID} .pro-top{padding:30px 28px 20px;text-align:center}
    #${MODAL_ID} .pro-badge{display:inline-block;border:1px solid rgba(255,117,34,.45);border-radius:999px;padding:6px 11px;color:#ff8a42;font-size:10px;font-weight:900;letter-spacing:.14em;margin-bottom:12px}
    #${MODAL_ID} h2{margin:0;font-size:31px;line-height:1.05;letter-spacing:-.04em}
    #${MODAL_ID} h2 span{color:#ff7622}
    #${MODAL_ID} .pro-lead{margin:10px 0 0;color:#a7a7a7;font-size:14px;line-height:1.5}
    #${MODAL_ID} .pro-price{margin:22px 0 8px;font-size:36px;font-weight:900;letter-spacing:-.04em}
    #${MODAL_ID} .pro-price small{font-size:13px;color:#999;font-weight:600;letter-spacing:0}
    #${MODAL_ID} .trial{margin:0 auto 18px;padding:11px 14px;border-radius:12px;background:rgba(255,117,34,.09);border:1px solid rgba(255,117,34,.2);font-size:13px;color:#eee}
    #${MODAL_ID} .trial strong{color:#ff8a42}
    #${MODAL_ID} .features{display:grid;gap:10px;margin:0 28px 20px}
    #${MODAL_ID} .feature{display:flex;gap:10px;align-items:flex-start;color:#ddd;font-size:13px;line-height:1.4}
    #${MODAL_ID} .check{color:#ff7622;font-weight:900}
    #${MODAL_ID} .carbon{margin:0 28px 20px;padding:14px;border-radius:14px;background:rgba(44,196,90,.08);border:1px solid rgba(44,196,90,.2);display:flex;gap:10px;align-items:flex-start;font-size:12px;line-height:1.45;color:#cfcfcf}
    #${MODAL_ID} .carbon-icon{font-size:18px;line-height:1}
    #${MODAL_ID} .carbon strong{color:#fff}
    #${MODAL_ID} .pro-cta{display:block;width:calc(100% - 56px);margin:0 28px 12px;padding:15px 18px;border:0;border-radius:13px;background:linear-gradient(135deg,#ff7a2b,#e95b0c);color:#fff;cursor:pointer;font-size:14px;font-weight:900;letter-spacing:.03em;box-shadow:0 10px 28px rgba(245,101,20,.2)}
    #${MODAL_ID} .pro-note{text-align:center;color:#777;font-size:10px;padding:0 28px 22px;line-height:1.45}
    @media(max-width:640px){#${BUTTON_ID}{padding:8px 10px;font-size:9px}#${BUTTON_ID} .sub-small{display:none}#${MODAL_ID}{padding:12px}#${MODAL_ID} .pro-card{width:min(440px,calc(100vw - 24px));border-radius:20px}#${MODAL_ID} .pro-top{padding:26px 22px 18px}#${MODAL_ID} h2{font-size:27px}#${MODAL_ID} .features,#${MODAL_ID} .carbon{margin-left:22px;margin-right:22px}#${MODAL_ID} .carbon{padding:12px}#${MODAL_ID} .pro-cta{width:calc(100% - 44px);margin-left:22px;margin-right:22px}}
  `;
  document.head.appendChild(style);
}

function closeModal(){document.getElementById(MODAL_ID)?.remove();document.body.style.overflow='';}

function openModal(){
  if(document.getElementById(MODAL_ID))return;
  installStyles();
  const modal=document.createElement('div');
  modal.id=MODAL_ID;modal.setAttribute('role','dialog');modal.setAttribute('aria-modal','true');
  modal.innerHTML=`<div class="pro-card"><button class="pro-close" type="button" aria-label="Close">×</button><section class="pro-top"><div class="pro-badge">MIKE AI PRO</div><h2>Do the work.<br><span>Get your edge.</span></h2><p class="pro-lead">More Mike. More conversations. More help getting things done.</p><div class="pro-price">$19.99 <small>/ month</small></div><div class="trial"><strong>7 DAYS FREE</strong> — try Mike AI Pro before you're charged.</div></section><div class="features"><div class="feature"><span class="check">✓</span><span>Talk with Mike using natural voice conversations.</span></div><div class="feature"><span class="check">✓</span><span>Get practical, straight-to-the-point help whenever you need it.</span></div><div class="feature"><span class="check">✓</span><span>Built for people who want to stop talking and start doing.</span></div></div><div class="carbon"><span class="carbon-icon">🌎</span><span><strong>Do good while you do the work.</strong><br>Mike AI contributes <strong>1% of every subscription</strong> toward permanent CO₂ removal.</span></div><button class="pro-cta" type="button">START 7-DAY FREE TRIAL →</button><div class="pro-note">Secure checkout powered by Stripe. You won't be charged today. Your subscription renews at $19.99/month after the trial unless canceled.</div></div>`;
  modal.addEventListener('click',e=>{if(e.target===modal)closeModal();});
  modal.querySelector('.pro-close').addEventListener('click',closeModal);
  modal.querySelector('.pro-cta').addEventListener('click',()=>window.location.assign(STRIPE_CHECKOUT_URL));
  document.body.appendChild(modal);document.body.style.overflow='hidden';
}

function addSubscriptionButton(){
  const headerRight=document.querySelector('.header-right');
  if(!headerRight||document.getElementById(BUTTON_ID))return;
  installStyles();
  const button=document.createElement('button');button.id=BUTTON_ID;button.type='button';button.setAttribute('aria-label','View Mike AI Pro');
  button.innerHTML='MIKE AI PRO<span class="sub-small">7 DAYS FREE</span>';button.addEventListener('click',openModal);
  const authButton=headerRight.querySelector('.auth-btn');
  if(authButton)headerRight.insertBefore(button,authButton);else headerRight.appendChild(button);
}

addSubscriptionButton();
new MutationObserver(addSubscriptionButton).observe(document.body,{childList:true,subtree:true});
