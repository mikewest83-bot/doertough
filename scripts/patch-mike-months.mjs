import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const indexPath = path.join(root, 'index.html');
let html = fs.readFileSync(indexPath, 'utf8');

const marker = '<!-- mike-months -->';
if (!html.includes(marker)) {
  html = html.replace(
    '</head>',
    `  ${marker}\n  <link rel="stylesheet" href="/mike-months.css?v=20260902-1">\n  <script defer src="/mike-months.js?v=20260902-1"></script>\n</head>`
  );
  fs.writeFileSync(indexPath, html);
  console.log('[patch-mike-months] installed frontend hooks');
} else {
  console.log('[patch-mike-months] already installed');
}
