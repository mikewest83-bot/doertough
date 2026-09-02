import fs from 'node:fs';

const mainPath = 'src/main.jsx';
let main = fs.readFileSync(mainPath, 'utf8');

const oldStarter = "  const starterPrompts = ['What would you do?', 'Help me figure this out.', 'I need a second opinion.', '📷 Ask Mike about a photo'];\n";
const newStarter = "  const starterPrompts = ['Find me a deal', 'Save me money', 'Help me decide'];\n";
if (main.includes(oldStarter)) main = main.replace(oldStarter, newStarter);
else if (!main.includes("const starterPrompts = ['Find me a deal', 'Save me money', 'Help me decide'];")) {
  const anchor = "  const visibleMessages = showTranscript ? messages : messages.filter((m) => !m.voice);\n";
  if (!main.includes(anchor)) throw new Error('[patch-homepage-action-first] starter anchor not found');
  main = main.replace(anchor, anchor + newStarter);
}

const oldHeading = '<h1>Talk to Mike.<br /><span>Get a straight answer.</span></h1>';
const newHeading = '<h1>What do you need<br /><span>done?</span></h1>';
if (main.includes(oldHeading)) main = main.replace(oldHeading, newHeading);

const heroStart = '<section className="voice-hero">';
const heroEnd = '</section>\n      {hasVoiceMessages';
const hs = main.indexOf(heroStart);
const he = main.indexOf(heroEnd, hs);
if (hs < 0 || he < 0) throw new Error('[patch-homepage-action-first] hero boundaries not found');
let hero = main.slice(hs, he);
hero = hero.replace(/<p>[^]*?<\/p>/, '<p>Deals. Money. Decisions. Everyday stuff. Tell Mike what is going on and he will help you figure out the next move.</p>');
main = main.slice(0, hs) + hero + main.slice(he);

const chatAnchor = '      <section className="chat" aria-live="polite">';
if (!main.includes('className="action-starters"')) {
  const starterBlock = `      <section className="action-starters" aria-label="Start with Mike">\n        <div className="action-starters-heading"><strong>Start with Mike</strong><span>Pick a job and jump in.</span></div>\n        <div className="action-starters-grid">{starterPrompts.map((prompt) => (<button key={prompt} type="button" className="action-starter" onClick={() => ask(prompt)} disabled={busy || conversationModeRef.current || !!conversationRef.current}><span>{prompt}</span><ArrowRight size={17} /></button>))}</div>\n      </section>\n`;
  if (!main.includes(chatAnchor)) throw new Error('[patch-homepage-action-first] chat anchor not found');
  main = main.replace(chatAnchor, starterBlock + chatAnchor);
}

fs.writeFileSync(mainPath, main);

const cssPath = 'src/style.css';
let css = fs.readFileSync(cssPath, 'utf8');
if (!css.includes('/* Mike action-first homepage */')) {
  css += `\n/* Mike action-first homepage */\n.action-starters{margin:24px 0 18px;padding:20px;border:1px solid #24282c;border-radius:18px;background:linear-gradient(145deg,#0d1115,#090b0e);box-shadow:0 16px 40px #0005}.action-starters-heading{display:flex;align-items:baseline;justify-content:space-between;gap:14px;margin-bottom:14px}.action-starters-heading strong{font-size:15px;letter-spacing:.08em;text-transform:uppercase}.action-starters-heading span{font-size:12px;color:#777f87}.action-starters-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.action-starter{min-height:58px;display:flex;align-items:center;justify-content:space-between;gap:10px;padding:14px 15px;border:1px solid #2b3035;border-radius:13px;background:#11161b;color:#f5f7f9;text-align:left;font-weight:750;transition:transform .15s,border-color .15s,background .15s}.action-starter:hover{transform:translateY(-1px);border-color:#f26b2188;background:#161c21}.action-starter svg{color:#27a9ff;flex:0 0 auto}.copy h1{max-width:850px}.copy h1 span{color:#f26b21}.copy p{max-width:680px}.voice-hero .copy{padding-bottom:4px}\n@media(max-width:760px){.action-starters{margin:18px 0 14px;padding:15px}.action-starters-heading{display:block}.action-starters-heading span{display:block;margin-top:4px}.action-starters-grid{grid-template-columns:1fr}.action-starter{min-height:52px}.copy h1{font-size:54px}}\n`;
  fs.writeFileSync(cssPath, css);
}

console.log('[patch-homepage-action-first] action-first homepage wired');
