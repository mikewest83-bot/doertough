import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.join(root, 'src', 'main.jsx');
let source = fs.readFileSync(target, 'utf8');

// Owner Access is intentionally isolated from the main Mike experience.
// This build step only wires the dedicated OwnerPortal component into App.
if (!source.includes("import OwnerPortal from './OwnerPortal.jsx';")) {
  source = source.replace("import './style.css';", "import './style.css';\nimport OwnerPortal from './OwnerPortal.jsx';");
}

if (!source.includes('const [ownerOpen, setOwnerOpen] = useState(false);')) {
  const anchor = "  const [accountsOn, setAccountsOn] = useState(false);";
  if (!source.includes(anchor)) throw new Error('Owner state anchor not found');
  source = source.replace(anchor, `${anchor}\n  const [ownerOpen, setOwnerOpen] = useState(false);`);
}

if (!source.includes('Owner Access</button>')) {
  const anchor = '<div className="header-right"><span className="status">● {statusText}</span>';
  if (!source.includes(anchor)) throw new Error('Owner header anchor not found');
  source = source.replace(anchor, `${anchor}{user?.isOwner && (<button className="auth-btn" onClick={() => setOwnerOpen(true)}>Owner Access</button>)}`);
}

if (!source.includes('{ownerOpen && user?.isOwner && <OwnerPortal')) {
  const anchor = '{authOpen && (() => {';
  if (!source.includes(anchor)) throw new Error('Owner render anchor not found');
  source = source.replace(anchor, `{ownerOpen && user?.isOwner && <OwnerPortal onClose={() => setOwnerOpen(false)} />}\n      ${anchor}`);
}

fs.writeFileSync(target, source);
console.log('[build] Owner Access wired as isolated component; main Mike experience unchanged');
