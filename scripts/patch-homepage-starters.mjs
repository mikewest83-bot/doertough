import fs from 'node:fs';

const path = 'src/main.jsx';
const source = fs.readFileSync(path, 'utf8');
const block = "<div className=\"try-row\"><span className=\"try-label\">Try him right now</span><div className=\"try-chips\">{starterPrompts.map((prompt) => (<button key={prompt} type=\"button\" className=\"try-chip\" onClick={() => prompt.startsWith('📷') ? openPhotoPicker() : ask(prompt)} disabled={busy || (conversationMode && !prompt.startsWith('📷'))}>{prompt}</button>))}</div></div>";
const starterLine = "  const starterPrompts = ['What would you do?', 'Help me figure this out.', 'I need a second opinion.', '📷 Ask Mike about a photo'];\n";

let next = source;
next = next.replace(starterLine, '');
next = next.replace(block, '');

if (next === source) {
  const hasStarterReferences = source.includes('starterPrompts') || source.includes('try-row');
  if (!hasStarterReferences) {
    process.stdout.write('[build] Homepage starter questions already removed\n');
    process.exit(0);
  }

  // The homepage action-first patch can change the surrounding markup while
  // leaving the old starter declaration behind. Remove that declaration too
  // rather than failing a second build.
  const declarationPattern = /\s*const starterPrompts\s*=\s*\[[^\n]*\];\n?/;
  const cleaned = source.replace(declarationPattern, '');
  if (cleaned !== source && !cleaned.includes('try-row') && !cleaned.includes('starterPrompts')) {
    fs.writeFileSync(path, cleaned);
    process.stdout.write('[build] Removed leftover homepage starter declaration\n');
    process.exit(0);
  }

  throw new Error('[homepage] starter question markup was not found in expected form');
}

fs.writeFileSync(path, next);
process.stdout.write('[build] Removed non-functional homepage starter questions\n');
