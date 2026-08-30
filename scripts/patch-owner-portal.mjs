import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.join(root, 'src', 'main.jsx');
let source = fs.readFileSync(target, 'utf8');

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
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const owners = overview?.roles?.owner || 0;
  const admins = overview?.roles?.admin || 0;
  const users = overview?.users || 0;
  const audit = overview?.recentAudit || [];

  return (
    <div className="owner-overlay" role="dialog" aria-modal="true" aria-label="Owner Access">
      <div className="owner-dashboard">
        <div className="owner-topbar">
          <div className="owner-brand">
            <b className="brand-dt"><span>D</span><em>T</em></b>
            <div><strong>MIKE AI</strong><small>DOER TOUGH</small></div>
          </div>
          <div className="owner-top-actions">
            <span className="owner-secure">🔒 OWNER ACCESS</span>
            <button className="owner-close" onClick={onClose}><ArrowRight size={18} style={{ transform: 'rotate(180deg)' }} /> Mike</button>
          </div>
        </div>

        <section className="owner-hero">
          <div>
            <div className="owner-kicker">OWNER ACCESS</div>
            <h2>Welcome back.</h2>
            <p>Private Mike AI controls, access status, and audit activity.</p>
          </div>
          <div className={\`owner-health \${overview?.configured ? 'ok' : 'off'}\`}>
            <span /> {overview?.configured ? 'System Operational' : 'System Not Configured'}
          </div>
        </section>

        {loading && <div className="owner-loading">Loading owner controls…</div>}
        {error && <div className="owner-error" role="alert">{error}</div>}

        {!loading && !error && overview && (
          <>
            <div className="owner-stats">
              <div className="owner-stat"><span className="owner-icon orange">♟</span><small>Total Users</small><strong>{users}</strong><em>Accounts in Mike AI</em></div>
              <div className="owner-stat"><span className="owner-icon blue">●</span><small>Conversations</small><strong>—</strong><em>Not tracked by owner API</em></div>
              <div className="owner-stat"><span className="owner-icon green">✓</span><small>Owners</small><strong>{owners}</strong><em>Privileged owner accounts</em></div>
              <div className="owner-stat"><span className="owner-icon purple">◆</span><small>Admins</small><strong>{admins}</strong><em>Administrative accounts</em></div>
            </div>

            <div className="owner-grid">
              <section className="owner-panel owner-audit">
                <div className="owner-panel-head"><div><h3>Recent Activity</h3><p>Latest security and owner events</p></div><span>{audit.length} events</span></div>
                {audit.length ? audit.map((item, index) => (
                  <div className="owner-event" key={item.createdAt + item.action + index}>
                    <span className="owner-event-dot" />
                    <div><strong>{item.action}</strong><small>{item.targetType ? item.targetType : 'System activity'}{item.targetId ? \` · \${item.targetId}\` : ''}</small></div>
                    <time>{item.createdAt ? new Date(item.createdAt).toLocaleString() : ''}</time>
                  </div>
                )) : <div className="owner-empty">No audit activity recorded yet.</div>}
              </section>

              <section className="owner-panel">
                <div className="owner-panel-head"><div><h3>Quick Actions</h3><p>Owner controls available in this build</p></div></div>
                <div className="owner-actions">
                  <div><span>♟</span><div><strong>User Management</strong><small>Role and access controls</small></div><b>›</b></div>
                  <div><span>▣</span><div><strong>Audit Activity</strong><small>Review security events</small></div><b>›</b></div>
                  <div><span>✓</span><div><strong>Access Control</strong><small>RBAC status and permissions</small></div><b>›</b></div>
                </div>
              </section>
            </div>

            <section className="owner-panel owner-status-panel">
              <div className="owner-panel-head"><div><h3>System Status</h3><p>Current owner-access service state</p></div></div>
              <div className="owner-status-list">
                <div><span className="status-dot" /> RBAC <b>{overview.configured ? 'Operational' : 'Not configured'}</b></div>
                <div><span className="status-dot" /> Owner API <b>Operational</b></div>
                <div><span className="status-dot" /> Audit Log <b>{overview.configured ? 'Available' : 'Unavailable'}</b></div>
              </div>
            </section>
          </>
        )}

        <div className="owner-footer">🔒 Owner access is restricted. Activity is logged for security.</div>
      </div>
    </div>
  );
}
`;

const ownerStart = source.indexOf('function OwnerPortal(');
const appStart = source.indexOf('function App() {');
if (ownerStart >= 0 && appStart > ownerStart) {
  source = source.slice(0, ownerStart) + component + '\n' + source.slice(appStart);
} else if (appStart >= 0) {
  source = source.replace('function App() {', component + '\nfunction App() {');
} else {
  throw new Error('Owner/App anchor not found');
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
console.log('[build] Owner Access dashboard rebuilt; main Mike experience left unchanged');
