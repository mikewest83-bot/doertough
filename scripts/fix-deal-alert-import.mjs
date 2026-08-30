import fs from 'node:fs';

const target = 'server/index.mjs';
let source = fs.readFileSync(target, 'utf8');

const imports = [...source.matchAll(/^import\s*\{([^}]*)\}\s*from ['"]\.\/deal-alerts\.mjs['"];?$/gm)];
if (imports.length <= 1) {
  console.log('[deal-alert-import] import registry clean');
  process.exit(0);
}

const names = new Set();
for (const match of imports) {
  for (const name of match[1].split(',').map((value) => value.trim()).filter(Boolean)) {
    names.add(name);
  }
}

const canonical = `import { ${[...names].join(', ')} } from './deal-alerts.mjs';`;
source = source.replace(/^import\s*\{[^}]*\}\s*from ['"]\.\/deal-alerts\.mjs['"];?$/gm, '');
source = source.replace(/^\s*\n/, '');
const firstImportEnd = source.indexOf('\n', source.indexOf('import '));
source = source.slice(0, firstImportEnd + 1) + canonical + '\n' + source.slice(firstImportEnd + 1);
fs.writeFileSync(target, source);
console.log(`[deal-alert-import] normalized ${imports.length} deal-alert imports into one`);
