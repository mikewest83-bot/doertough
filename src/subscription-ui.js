const STRIPE_CHECKOUT_URL = 'https://buy.stripe.com/3cI6oH8USaMXd6weqg5J600';

const STYLE_ID = 'mike-subscription-ui-style';
const BUTTON_ID = 'mike-subscribe-button';

function installStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    #${BUTTON_ID} {
      appearance: none;
      border: 1px solid rgba(255, 117, 34, .75);
      border-radius: 999px;
      background: linear-gradient(135deg, #ff7a2b, #e95b0c);
      color: #fff;
      font: 800 11px/1 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      letter-spacing: .06em;
      text-transform: uppercase;
      padding: 10px 14px;
      cursor: pointer;
      box-shadow: 0 5px 20px rgba(245, 101, 20, .18);
      white-space: nowrap;
      transition: transform .15s ease, filter .15s ease, box-shadow .15s ease;
    }
    #${BUTTON_ID}:hover { filter: brightness(1.08); transform: translateY(-1px); box-shadow: 0 7px 24px rgba(245, 101, 20, .28); }
    #${BUTTON_ID}:active { transform: translateY(0); }
    #${BUTTON_ID} .sub-small { display:block; font-size:8px; letter-spacing:.12em; opacity:.82; margin-top:3px; }
    @media (max-width: 640px) {
      #${BUTTON_ID} { padding: 8px 10px; font-size: 9px; }
      #${BUTTON_ID} .sub-small { display:none; }
    }
  `;
  document.head.appendChild(style);
}

function addSubscriptionButton() {
  const headerRight = document.querySelector('.header-right');
  if (!headerRight || document.getElementById(BUTTON_ID)) return;

  installStyles();

  const button = document.createElement('button');
  button.id = BUTTON_ID;
  button.type = 'button';
  button.setAttribute('aria-label', 'Start Mike AI Pro free trial');
  button.innerHTML = 'START FREE TRIAL<span class="sub-small">MIKE AI PRO</span>';
  button.addEventListener('click', () => {
    window.location.assign(STRIPE_CHECKOUT_URL);
  });

  const authButton = headerRight.querySelector('.auth-btn');
  if (authButton) headerRight.insertBefore(button, authButton);
  else headerRight.appendChild(button);
}

addSubscriptionButton();

const observer = new MutationObserver(addSubscriptionButton);
observer.observe(document.body, { childList: true, subtree: true });
