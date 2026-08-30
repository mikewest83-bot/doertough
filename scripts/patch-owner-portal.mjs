import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.join(root, 'src', 'main.jsx');
let source = fs.readFileSync(target, 'utf8');

if (!source.includes('function OwnerPortal(')) {
  const anchor = 'function App() {';
  if (!source.includes(anchor)) throw new Error('Owner portal App anchor not found');
  const component = `function OwnerPortal({ onClose }) {
  const [overview, setOverview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchJson('/api/owner/overview', { headers: authHeaders() }, 15000);
        if (!cancelled) setOverview(data);
      } catch (err) {
        if (!cancelled) setError(err?.status === 403 ? 'Owner access required.' : 'Owner dashboard is unavailable right now.');
      } finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, []);
  return (<div className="auth-overlay" role="dialog" aria-modal="true">
    <div className="auth-card" style={{ maxWidth: 760, width: 'calc(100% - 28px)', maxHeight: '88vh', overflowY: 'auto' }}>
      <button className="auth-close" onClick={onClose} aria-label="Close owner portal"><X size={18} /></button>
      <h2>Owner Access</h2>
      <p className="auth-sub">Private Mike AI controls, access status, and audit activity.</p>
      {loading && <p>Loading owner controls…</p>}
      {error && <p role="alert">{error}</p>}
      {!loading && !error && overview && (<div style={{ display: 'grid', gap: 14 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: 10 }}>
          <div className="auth-card" style={{ margin: 0, padding: 14 }}><strong>{overview.users}</strong><small> Users</small></div>
          <div className="auth-card" style={{ margin: 0, padding: 14 }}><strong>{overview.roles?.owner || 0}</strong><small> Owners</small></div>
          <div className="auth-card" style={{ margin: 0, padding: 14 }}><strong>{overview.roles?.admin || 0}</strong><small> Admins</small></div>
          <div className="auth-card" style={{ margin: 0, padding: 14 }}><strong>{overview.configured ? 'READY' : 'OFF'}</strong><small> RBAC</small></div>
        </div>
        <section><h3>Recent audit activity</h3>{overview.recentAudit?.length ? <div style={{ display: 'grid', gap: 8 }}>{overview.recentAudit.map((item, index) => <div key={item.createdAt + item.action + index} style={{ padding: 10, border: '1px solid rgba(255,255,255,.12)', borderRadius: 8 }}><strong>{item.action}</strong>{item.targetType && <span> · {item.targetType}</span>}<small style={{ display: 'block', opacity: .65 }}>{item.createdAt ? new Date(item.createdAt).toLocaleString() : ''}</small></div>)}</div> : <p>No audit activity recorded yet.</p>}</section>
      </div>)}
    </div>
  </div>);
}

`;
  source = source.replace(anchor, component + anchor);
}

if (!source.includes('const [ownerOpen, setOwnerOpen]')) {
  const anchor = "const [accountsOn, setAccountsOn] = useState(false);";
  if (!source.includes(anchor)) throw new Error('Owner state anchor not found');
  source = source.replace(anchor, `${anchor}\n  const [ownerOpen, setOwnerOpen] = useState(false);`);
}

if (!source.includes('Owner Access</button>')) {
  const anchor = "<div className=\"header-right\"><span className=\"status\">● {statusText}</span>";
  if (!source.includes(anchor)) throw new Error('Owner header anchor not found');
  source = source.replace(anchor, `${anchor}{user?.isOwner && (<button className=\"auth-btn\" onClick={() => setOwnerOpen(true)}>Owner Access</button>)}`);
}

if (!source.includes('{ownerOpen && user?.isOwner && <OwnerPortal')) {
  const anchor = "{authOpen && (() => {";
  if (!source.includes(anchor)) throw new Error('Owner render anchor not found');
  source = source.replace(anchor, `{ownerOpen && user?.isOwner && <OwnerPortal onClose={() => setOwnerOpen(false)} />}\n      ${anchor}`);
}

fs.writeFileSync(target, source);
console.log('[build] secure Owner Access portal UI wired to /api/owner/overview');
