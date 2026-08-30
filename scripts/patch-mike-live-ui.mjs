import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.join(root, 'src', 'main.jsx');
let source = fs.readFileSync(target, 'utf8');

const importLine = "import MikeLiveGameView from './MikeLiveGameView.jsx';";
if (!source.includes(importLine)) {
  const anchor = "import './style.css';";
  if (!source.includes(anchor)) throw new Error('Mike Live import anchor not found');
  source = source.replace(anchor, `${anchor}\n${importLine}`);
}

if (!source.includes('<MikeLiveGameView />')) {
  const label = '{voiceControlLabel}';
  const labelIndex = source.indexOf(label);
  if (labelIndex < 0) throw new Error('Mike Live voice control anchor not found');
  const buttonEnd = source.indexOf('</button>', labelIndex);
  if (buttonEnd < 0) throw new Error('Mike Live voice button end not found');
  const insertAt = buttonEnd + '</button>'.length;
  source = source.slice(0, insertAt) + '\n      <MikeLiveGameView />' + source.slice(insertAt);
}

fs.writeFileSync(target, source);
console.log('[build] Mike Live mounted directly below the conversation control');
