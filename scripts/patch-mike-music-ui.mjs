import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.join(root, 'src', 'main.jsx');
let source = fs.readFileSync(target, 'utf8');
const before = source;
source = source.replace("import MikeMusic from './MikeMusic.jsx';\n", '').replace("import './mike-music.css';\n", '').replace(/\s*<MikeMusic \/>\n/g, '\n');
fs.writeFileSync(target, source);
console.log(source === before ? '[build] Mike Music already removed' : '[build] Removed Mike Music UI from homepage');
