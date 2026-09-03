// Shows a real answer from Mike directly under the hero.
// Before this the page was all affordances - an orb, starter cards, a composer,
// photo buttons - and a first-time visitor could reach the $24.99 price without
// ever seeing Mike answer anything. This is one genuine exchange, captured from
// production on 2026-09-03 (the DealTough valuation path, verbatim apart from
// trimming), so the proof on the page is the product's own output.
import fs from 'node:fs';

const path = 'src/main.jsx';
let source = fs.readFileSync(path, 'utf8');

const anchor = '      {hasVoiceMessages && (<button type="button" className="transcript-toggle"';

const block = `      <section className="sample-exchange" aria-label="An example answer from Mike">
        <span className="sample-kicker">What it actually sounds like</span>
        <div className="sample-thread">
          <p className="sample-ask">Guy wants $18,000 for a 2015 F-150 XLT, 140,000 miles, one owner. Is that a good deal?</p>
          <div className="sample-answer">
            <p><strong>At eighteen grand, I&rsquo;d call it high</strong> &mdash; not a good deal based on what we know.</p>
            <p>Fair market value comes back around <strong>$12,100</strong>, but confidence is only <strong>37%</strong>: we don&rsquo;t know the cab, the engine, whether it&rsquo;s four-wheel drive, the maintenance, or the rust. Those comps were asking prices, not completed sales.</p>
            <ul className="sample-ladder">
              <li><span>Open at</span><strong>$12,000</strong></li>
              <li><span>Target</span><strong>$13,000&ndash;$14,000</strong></li>
              <li><span>Walk away</span><strong>$15,000</strong></li>
            </ul>
            <p>One owner is a plus, but it doesn&rsquo;t magically erase 140,000 miles. Find out the cab, the drivetrain and the engine before you talk numbers.</p>
          </div>
        </div>
        <p className="sample-note">A real answer from Mike, trimmed for length. Ask him something of your own above.</p>
      </section>
`;

if (!source.includes('className="sample-exchange"')) {
  if (!source.includes(anchor)) throw new Error('[patch-sample-exchange] hero anchor not found');
  source = source.replace(anchor, block + anchor);
}

const css = [
  '.sample-exchange{width:100%;max-width:680px;margin:26px auto 0;padding:0 4px;box-sizing:border-box}',
  '.sample-kicker{display:block;text-align:center;font-size:11px;font-weight:800;letter-spacing:.18em;text-transform:uppercase;color:#27a9ff;margin-bottom:12px}',
  '.sample-thread{border:1px solid rgba(255,255,255,.1);border-radius:20px;background:rgba(255,255,255,.025);padding:18px}',
  '.sample-ask{margin:0 0 14px;padding:12px 15px;border-radius:16px 16px 5px 16px;background:rgba(242,107,33,.13);border:1px solid rgba(242,107,33,.32);color:#f3ece7;font-size:14.5px;line-height:1.5;margin-left:auto;max-width:88%;width:fit-content}',
  '.sample-answer{padding:14px 16px;border-radius:16px 16px 16px 5px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.09);max-width:94%}',
  '.sample-answer p{margin:0 0 10px;font-size:14.5px;line-height:1.62;color:#c8c8cd}',
  '.sample-answer p:last-child{margin-bottom:0}',
  '.sample-answer strong{color:#fff;font-weight:750}',
  '.sample-ladder{list-style:none;display:flex;flex-wrap:wrap;gap:8px;margin:0 0 12px;padding:0}',
  '.sample-ladder li{flex:1 1 120px;display:flex;flex-direction:column;gap:3px;padding:9px 12px;border-radius:12px;background:rgba(39,169,255,.07);border:1px solid rgba(39,169,255,.22)}',
  '.sample-ladder span{font-size:10.5px;font-weight:800;letter-spacing:.13em;text-transform:uppercase;color:#7fbfe8}',
  '.sample-ladder strong{font-size:16px;font-weight:800;color:#fff}',
  '.sample-note{margin:11px 0 0;text-align:center;font-size:12px;color:#7a7a80}',
  '@media(max-width:560px){.sample-exchange{margin-top:20px}.sample-thread{padding:14px;border-radius:18px}.sample-answer p,.sample-ask{font-size:14px}.sample-answer{max-width:100%;padding:13px 13px}.sample-ladder{gap:6px}.sample-ladder li{flex:1 1 0;min-width:0;padding:8px 9px}.sample-ladder span{font-size:9.5px;letter-spacing:.08em}.sample-ladder strong{font-size:12.5px}}',
].join('');

const style = '\n<style>{`' + css + '`}</style>\n';

if (!source.includes('.sample-exchange{')) {
  const styleAnchor = '  return (\n    <main>';
  if (!source.includes(styleAnchor)) throw new Error('[patch-sample-exchange] App render anchor not found');
  source = source.replace(styleAnchor, '  return (\n    <main>' + style);
}

fs.writeFileSync(path, source);
console.log('[patch-sample-exchange] sample exchange wired');
