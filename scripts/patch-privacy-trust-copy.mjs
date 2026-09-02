import fs from 'node:fs';

const path = 'src/main.jsx';
let source = fs.readFileSync(path, 'utf8');

const badge = '<span className="privacy-badge">Private to your account</span>';
const oldTrust = '<li>Cancel anytime</li>';
const newTrust = `<li>Cancel anytime ${badge}</li>`;

if (!source.includes(badge)) {
  if (!source.includes(oldTrust)) throw new Error('[patch-privacy-trust-copy] trust-row anchor not found');
  source = source.replace(oldTrust, newTrust);
}

const privacyLine = '<li>Your conversations are private to your account.</li>';
const pricingAnchor = '<li>Cancel anytime — and nothing to cancel during the trial</li>';
if (!source.includes(privacyLine)) {
  if (!source.includes(pricingAnchor)) throw new Error('[patch-privacy-trust-copy] pricing-list anchor not found');
  source = source.replace(pricingAnchor, `${pricingAnchor}${privacyLine}`);
}

const style = `\n<style>{`.concat('`','.privacy-badge{display:inline-flex;align-items:center;margin-left:8px;padding:3px 8px;border:1px solid rgba(74,222,128,.45);border-radius:999px;font-size:10px;font-weight:800;letter-spacing:.03em;line-height:1.2;white-space:nowrap;color:#4ade80;background:rgba(74,222,128,.08)}').concat('`}</style>\n');

if (!source.includes('.privacy-badge{')) {
  const styleAnchor = "  return (\n";
  if (!source.includes(styleAnchor)) throw new Error('[patch-privacy-trust-copy] App render anchor not found');
  source = source.replace(styleAnchor, `${styleAnchor}${style}`);
}

fs.writeFileSync(path, source);
console.log('[patch-privacy-trust-copy] privacy trust copy wired');
