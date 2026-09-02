import fs from 'node:fs';

const file = 'index.html';
const marker = '<!-- mike-conversion-showcase-copy -->';
if (!fs.existsSync(file)) throw new Error(`Missing ${file}`);
let html = fs.readFileSync(file, 'utf8');
if (html.includes(marker)) process.exit(0);

const block = `\n${marker}\n<script>\n(() => {\n  const cards = [\n    ['💰','Find better deals','Spot resale opportunities and figure out what a deal is really worth.'],\n    ['🎙️','Talk it out','Use Mike by voice when typing is the last thing you want to do.'],\n    ['📷','Show Mike','Send a photo and let Mike identify, size up, and explain what you’re looking at.']\n  ];\n  const ready = () => {\n    if (document.querySelector('.mike-value-strip') || !document.querySelector('.copy')) return;\n    const anchor = document.querySelector('.trust-row') || document.querySelector('.action-starters');\n    if (!anchor || !anchor.parentNode) return;\n    const strip = document.createElement('div');\n    strip.className = 'mike-value-strip';\n    strip.setAttribute('aria-label','What Mike can do');\n    strip.innerHTML = cards.map(([icon,title,desc]) => \\\`<div class="mike-value-card"><div class="mike-value-icon">\\\${icon}</div><strong>\\\${title}</strong><span>\\\${desc}</span></div>\\\`).join('');\n    anchor.parentNode.insertBefore(strip, anchor);\n    const proof = document.createElement('div');\n    proof.className = 'mike-proof-line';\n    proof.innerHTML = '<span><b>✓</b> 7-day free trial</span><span><b>✓</b> No card to start</span><span><b>✓</b> Voice + text + photo</span>';\n    strip.parentNode.insertBefore(proof, strip.nextSibling);\n  };\n  const observer = new MutationObserver(ready);\n  observer.observe(document.body,{childList:true,subtree:true});\n  ready();\n  setTimeout(ready,500);\n  setTimeout(ready,1500);\n})();\n</script>\n`;

if (!html.includes('</head>')) throw new Error('Missing </head>');
html = html.replace('</head>', `${block}</head>`);
fs.writeFileSync(file, html);
