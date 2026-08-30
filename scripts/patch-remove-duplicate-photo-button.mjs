import fs from 'node:fs';

const path = 'src/main.jsx';
const source = fs.readFileSync(path, 'utf8');
const button = "      <button type=\"button\" className=\"vision-photo-button\" onClick={openPhotoPicker} disabled={busy} aria-label=\"Ask Mike about a photo\">📷 Ask Mike about a photo</button>\n";
const next = source.replace(button, '');
if (next === source) {
  if (!source.includes('vision-photo-button')) process.stdout.write('[build] Duplicate bottom photo button already removed\\n');
  else throw new Error('[homepage] duplicate bottom photo button was not found');
} else {
  fs.writeFileSync(path, next);
  process.stdout.write('[build] Removed duplicate bottom photo button\\n');
}
