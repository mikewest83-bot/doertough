// Idempotently allow Mike AI's own origin to use browser geolocation.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.join(root, 'server', 'guard.mjs');
let text = fs.readFileSync(file, 'utf8');

const blocked = "res.setHeader('Permissions-Policy', 'camera=(), geolocation=(), payment=()');";
const allowed = "res.setHeader('Permissions-Policy', 'camera=(), geolocation=(self), payment=()');";

if (!text.includes(allowed)) {
  if (!text.includes(blocked)) throw new Error('geolocation Permissions-Policy anchor not found');
  text = text.replace(blocked, allowed);
  fs.writeFileSync(file, text);
}

console.log('[patch-geolocation-policy] complete');
