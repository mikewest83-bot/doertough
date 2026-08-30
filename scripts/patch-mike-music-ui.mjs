import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.join(root, 'src', 'main.jsx');
let source = fs.readFileSync(target, 'utf8');

if (!source.includes("import MikeMusic from './MikeMusic.jsx';")) {
  const importAnchor = "import './style.css';";
  if (!source.includes(importAnchor)) throw new Error('Mike Music import anchor not found');
  source = source.replace(importAnchor, `${importAnchor}\nimport MikeMusic from './MikeMusic.jsx';\nimport './mike-music.css';`);
}

if (!source.includes('<MikeMusic />')) {
  const formAnchor = '      <form onSubmit={(e) => { e.preventDefault(); ask(input); }}>';
  if (!source.includes(formAnchor)) throw new Error('Mike Music UI mount anchor not found');
  source = source.replace(formAnchor, `      <MikeMusic />\n${formAnchor}`);
}

fs.writeFileSync(target, source);
console.log('[build] Mounted isolated Mike Music UI without modifying Realtime voice code');
