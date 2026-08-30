import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.join(root, 'src', 'main.jsx');
let source = fs.readFileSync(target, 'utf8');

// Owner Access is isolated from the main Mike experience.
const importLine = "import OwnerPortal from './OwnerPortal.jsx';";
if (!source.includes(importLine)) {
  const styleImport = "import './style.css';";
  if (!source.includes(styleImport)) throw new Error('Style import anchor not found');
  source = source.replace(styleImport, `${styleImport}\n${importLine}`);
}

const stateLine = '  const [ownerOpen, setOwnerOpen] = useState(false);';
if (!source.includes(stateLine)) {
  const anchor = '  const [accountsOn, setAccountsOn] = useState(false);';
  if (!source.includes(anchor)) throw new Error('Owner state anchor not found');
  source = source.replace(anchor, `${anchor}\n${stateLine}`);
}

const ownerButton = '{user?.isOwner && (<button className="auth-btn" onClick={() => setOwnerOpen(true)}>Owner Access</button>)}';
if (!source.includes(ownerButton)) {
  const anchor = '<div className="header-right"><span className="status">● {statusText}</span>';
  if (!source.includes(anchor)) throw new Error('Owner header anchor not found');
  source = source.replace(anchor, `${anchor}${ownerButton}`);
}

const ownerRender = '{ownerOpen && user?.isOwner && <OwnerPortal onClose={() => setOwnerOpen(false)} />}';
if (!source.includes(ownerRender)) {
  const anchor = '{authOpen && (() => {';
  if (!source.includes(anchor)) throw new Error('Owner render anchor not found');
  source = source.replace(anchor, `${ownerRender}\n      ${anchor}`);
}

fs.writeFileSync(target, source);
console.log('[build] Owner Access wired as a dedicated component; main Mike experience unchanged');
