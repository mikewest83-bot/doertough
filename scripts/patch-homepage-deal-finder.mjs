import fs from 'node:fs';

const path = 'src/main.jsx';
let source = fs.readFileSync(path, 'utf8');

const marker = '      <section className="chat" aria-live="polite">';
if (source.includes('homepage-deal-finder')) {
  process.stdout.write('[build] Homepage Deal Finder already installed\n');
} else if (!source.includes(marker)) {
  throw new Error('[homepage-deal-finder] chat section anchor not found');
} else {
  const card = `      <section className="homepage-deal-finder" data-feature="homepage-deal-finder" aria-label="Mike Deal Finder">\n        <div className="homepage-deal-finder-copy">\n          <span className="homepage-deal-finder-kicker">MIKE DEAL FINDER</span>\n          <h2>Looking for a deal?</h2>\n          <p>Tell Mike what you want, where you want it, and what you want to spend. He'll hunt for the best buys and can keep watching for you.</p>\n          <div className="homepage-deal-finder-actions">\n            <button type="button" onClick={() => ask('Find me a good buy near me.')} disabled={busy || conversationMode}>Find me a deal</button>\n            <button type="button" className="secondary" onClick={() => ask('Set up a deal alert for something I am looking for.')} disabled={busy || conversationMode}>Set an alert</button>\n          </div>\n        </div>\n      </section>\n`;
  source = source.replace(marker, card + marker);
  fs.writeFileSync(path, source);
  process.stdout.write('[build] Added Mike Deal Finder to homepage\n');
}
