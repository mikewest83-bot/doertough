import fs from 'node:fs';

const file = 'index.html';
const marker = '<!-- mike-conversion-showcase -->';
const css = '<link rel="stylesheet" href="/mike-conversion-showcase.css?v=20260903-1">';
const js = '<script defer src="/mike-conversion-showcase-copy.js?v=20260903-1"></script>';

if (!fs.existsSync(file)) throw new Error(`Missing ${file}`);
let html = fs.readFileSync(file, 'utf8');
if (html.includes(marker)) process.exit(0);

const injection = `\n${marker}\n${css}\n${js}\n`;
if (!html.includes('</head>')) throw new Error('Missing </head>');
html = html.replace('</head>', `${injection}</head>`);
fs.writeFileSync(file, html);
