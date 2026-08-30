import fs from 'node:fs';

const source = fs.readFileSync('src/main.jsx', 'utf8');
const forbidden = ['starterPrompts', 'className="try-row"'];
const found = forbidden.filter((token) => source.includes(token));
if (found.length) {
  throw new Error(`[homepage] starter UI still present: ${found.join(', ')}`);
}
process.stdout.write('[verify] Homepage starter UI is absent\n');
