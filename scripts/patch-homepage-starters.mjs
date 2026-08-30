import fs from 'node:fs';

const path = 'src/main.jsx';
const source = fs.readFileSync(path, 'utf8');
const block = "<div className=\"try-row\"><span className=\"try-label\">Try him right now</span><div className=\"try-chips\">{starterPrompts.map((prompt) => (<button key={prompt} type=\"button\" className=\"try-chip\" onClick={() => prompt.startsWith('📷') ? openPhotoPicker() : ask(prompt)} disabled={busy || (conversationMode && !prompt.startsWith('📷'))}>{prompt}</button>))}</div></div>";
const starterLine = "  const starterPrompts = ['What would you do?', 'Help me figure this out.', 'I need a second opinion.', '📷 Ask Mike about a photo'];\n";
const next = source.replace(starterLine, '').replace(block, '');

if (next === source) {
  if (!source.includes('starterPrompts') && !source.includes('try-row')) {
    process.stdout.write('[build] Homepage starter questions already removed\n');
    process.exit(0);
  }
  throw new Error('[homepage] starter question markup was not found in expected form');
}

fs.writeFileSync(path, next);
process.stdout.write('[build] Removed non-functional homepage starter questions\n');
