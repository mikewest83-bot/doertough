// Adds the trust strip (what Mike runs on, the carbon commitment, the privacy
// and payment posture) and a real site footer with the legal/support links.
// Before this, the app simply stopped after the disclaimer line — no footer,
// no way to reach support.html/privacy.html/terms.html/refunds.html from the
// product itself, and nothing on the page said what Mike is built on.
import fs from 'node:fs';

const path = 'src/main.jsx';
let source = fs.readFileSync(path, 'utf8');

const anchor = '      <p className="fine">Mike is a Doer Tough AI assistant. Current facts and changing information should be verified before important decisions.</p>';

const block = `
      <section className="trust-strip" aria-label="What Mike AI runs on">
        <div className="trust-item">
          <strong>Powered by OpenAI + Anthropic</strong>
          <span>Mike runs on frontier models from both. The right one is picked for each question, so a quick answer stays quick and a hard one gets the deep thinker.</span>
        </div>
        <div className="trust-item">
          <strong>1% funds carbon removal</strong>
          <span>1% of every Mike AI subscription goes to permanent carbon removal through Stripe Climate. It comes out of our side, not yours.</span>
        </div>
        <div className="trust-item">
          <strong>Private to your account</strong>
          <span>Your conversations stay yours. Billing runs on Stripe, so your card details never touch our servers.</span>
        </div>
      </section>
      <footer className="site-footer">
        <div className="footer-top">
          <div className="footer-brand"><b className="brand-dt"><span>D</span><em>T</em></b><div><strong>MIKE AI</strong><small>DOER TOUGH</small></div></div>
          <nav className="footer-links" aria-label="Support and legal">
            <a href="/support.html">Support</a>
            <a href="/privacy.html">Privacy</a>
            <a href="/terms.html">Terms</a>
            <a href="/refunds.html">Refunds</a>
          </nav>
        </div>
        <p className="footer-fine">&copy; {new Date().getFullYear()} Doer Tough &middot; <a href="mailto:support@doertoughmikeai.com">support@doertoughmikeai.com</a></p>
      </footer>`;

if (!source.includes('className="site-footer"')) {
  if (!source.includes(anchor)) throw new Error('[patch-trust-footer] disclaimer anchor not found');
  source = source.replace(anchor, anchor + block);
}

const style = '\n<style>{\`' + [
  '.trust-strip{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:14px;width:100%;max-width:960px;margin:34px auto 0;padding:0 4px;box-sizing:border-box}',
  '.trust-item{padding:18px 18px 20px;border:1px solid rgba(255,255,255,.1);border-radius:16px;background:rgba(255,255,255,.025)}',
  '.trust-item strong{display:block;font-size:13.5px;font-weight:800;letter-spacing:.01em;color:#fff;margin-bottom:7px}',
  '.trust-item span{display:block;font-size:13px;line-height:1.6;color:#9b9b9b}',
  '.site-footer{width:100%;max-width:960px;margin:36px auto 0;padding:24px 4px 40px;box-sizing:border-box;border-top:1px solid rgba(255,255,255,.08)}',
  '.footer-top{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:18px}',
  '.footer-brand{display:flex;align-items:center;gap:11px}',
  '.footer-brand strong{display:block;font-size:13px;font-weight:800;letter-spacing:.14em;color:#fff;line-height:1.2}',
  '.footer-brand small{display:block;font-size:10px;letter-spacing:.18em;color:#7c7c7c}',
  '.footer-links{display:flex;flex-wrap:wrap;gap:20px}',
  '.footer-links a{font-size:13px;font-weight:600;color:#a5a5a5;text-decoration:none}',
  '.footer-links a:hover{color:#fff}',
  '.footer-fine{margin:18px 0 0;font-size:12px;color:#6f6f6f}',
  '.footer-fine a{color:#6f6f6f;text-decoration:none}',
  '.footer-fine a:hover{color:#a5a5a5}',
  '@media (max-width:560px){.footer-top{flex-direction:column;align-items:flex-start;gap:14px}}',
].join('') + '\`}</style>\n';

if (!source.includes('.trust-strip{')) {
  const styleAnchor = '  return (\n    <main>';
  if (!source.includes(styleAnchor)) throw new Error('[patch-trust-footer] App render anchor not found');
  source = source.replace(styleAnchor, '  return (\n    <main>' + style);
}

fs.writeFileSync(path, source);
console.log('[patch-trust-footer] trust strip + site footer wired');
