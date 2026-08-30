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
  const ownerStyles = "\n    .owner-overlay{position:fixed;inset:0;z-index:80;overflow:auto;background:radial-gradient(circle at 50% -10%,#13212d 0,#070a0d 34%,#030405 75%);color:#f5f7f9;padding:16px 12px 32px}\n    .owner-dashboard{max-width:1180px;margin:0 auto;border:1px solid #ffffff16;border-radius:26px;background:linear-gradient(180deg,#0b0f13,#07090b);box-shadow:0 30px 100px #000b;overflow:hidden}\n    .owner-topbar{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:18px 22px;border-bottom:1px solid #ffffff12;position:sticky;top:0;background:#070a0dee;backdrop-filter:blur(12px);z-index:3}\n    .owner-brand{display:flex;align-items:center;gap:12px}.owner-brand strong{display:block;font-size:15px;letter-spacing:.2em}.owner-brand small{display:block;margin-top:4px;color:#73777c;font-size:10px;letter-spacing:.22em}\n    .owner-brand .brand-dt{width:58px!important;height:58px!important;flex-basis:58px!important}.owner-secure{padding:10px 14px;border:1px solid #f26b2180;border-radius:999px;background:#f26b210d;color:#ff8a3d;font-size:12px;font-weight:800;letter-spacing:.05em}.owner-top-actions{display:flex;align-items:center;gap:10px}.owner-close{display:inline-flex;align-items:center;gap:7px;padding:10px 15px;border:1px solid #ffffff25;border-radius:999px;background:#ffffff06;color:#fff;font-weight:700}\n    .owner-hero{display:flex;align-items:flex-start;justify-content:space-between;gap:20px;padding:28px 30px 18px}.owner-kicker{color:#ff7b27;font-size:12px;font-weight:900;letter-spacing:.22em}.owner-hero h2{font-size:clamp(34px,5vw,54px);line-height:1;margin:8px 0}.owner-hero p{margin:0;color:#8e969d;font-size:15px}.owner-health{display:flex;align-items:center;gap:8px;padding:11px 14px;border-radius:11px;background:#ffffff08;font-size:13px;white-space:nowrap}.owner-health span,.status-dot{width:9px;height:9px;border-radius:50%;background:#24c95a;box-shadow:0 0 12px #24c95a88}.owner-health.off span{background:#ff8a3d;box-shadow:none}\n    .owner-loading,.owner-error{margin:0 30px 20px;padding:16px;border-radius:12px;background:#ffffff06;border:1px solid #ffffff12;color:#aeb5bb}.owner-error{color:#ffb39a;border-color:#7a3526;background:#21100b}\n    .owner-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;padding:0 30px 18px}.owner-stat{position:relative;min-height:150px;padding:18px;border:1px solid #ffffff14;border-radius:16px;background:linear-gradient(145deg,#12161a,#0d1013);box-shadow:inset 0 1px #ffffff08}.owner-stat small{display:block;color:#dfe3e6;font-size:13px;margin:28px 0 8px}.owner-stat strong{display:block;font-size:34px;letter-spacing:-.03em}.owner-stat em{display:block;margin-top:6px;color:#6f777e;font-size:11px;font-style:normal}.owner-icon{position:absolute;top:16px;right:18px;font-size:24px}.owner-icon.orange{color:#ff741d}.owner-icon.blue{color:#2daaff}.owner-icon.green{color:#35d56b}.owner-icon.purple{color:#b86cff}\n    .owner-grid{display:grid;grid-template-columns:1.45fr 1fr;gap:14px;padding:0 30px 14px}.owner-panel{border:1px solid #ffffff14;border-radius:16px;background:#0d1114;overflow:hidden}.owner-panel-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:18px 20px;border-bottom:1px solid #ffffff10}.owner-panel-head h3{margin:0;font-size:18px}.owner-panel-head p{margin:5px 0 0;color:#6f777e;font-size:12px}.owner-panel-head>span{color:#ff7b27;font-size:12px;font-weight:800;white-space:nowrap}.owner-event{display:grid;grid-template-columns:12px 1fr auto;gap:12px;align-items:center;padding:14px 20px;border-bottom:1px solid #ffffff0b}.owner-event:last-child{border-bottom:0}.owner-event-dot{width:9px;height:9px;border-radius:50%;background:#ff7b27;box-shadow:0 0 12px #ff7b2766}.owner-event strong{display:block;font-size:13px}.owner-event small{display:block;margin-top:4px;color:#737b82;font-size:11px}.owner-event time{color:#6f777e;font-size:10px;text-align:right}.owner-empty{padding:24px 20px;color:#727a81;font-size:13px}\n    .owner-actions{padding:10px}.owner-actions>div{display:flex;align-items:center;gap:12px;padding:15px 12px;border:1px solid #ffffff10;border-radius:11px;margin-bottom:8px;background:#ffffff03}.owner-actions>div:last-child{margin-bottom:0}.owner-actions>div>span{width:34px;height:34px;display:grid;place-items:center;border-radius:9px;background:#ff7b2714;color:#ff7b27;font-size:18px}.owner-actions div div{min-width:0;flex:1}.owner-actions strong{display:block;font-size:13px}.owner-actions small{display:block;margin-top:3px;color:#6f777e;font-size:10px}.owner-actions b{font-size:24px;color:#737b82;font-weight:400}.owner-status-panel{margin:0 30px 14px}.owner-status-list{display:grid;grid-template-columns:repeat(3,1fr)}.owner-status-list>div{display:flex;align-items:center;gap:9px;padding:16px 20px;border-right:1px solid #ffffff0b;color:#d8dde1;font-size:13px}.owner-status-list>div:last-child{border-right:0}.owner-status-list b{margin-left:auto;color:#32d766;font-size:12px}.owner-footer{margin:0 30px 26px;padding:14px 16px;border:1px solid #ffffff10;border-radius:12px;background:#ffffff03;color:#777f86;text-align:center;font-size:11px}\n    @media(max-width:760px){.owner-overlay{padding:0 8px 24px}.owner-dashboard{border-radius:20px}.owner-topbar{padding:14px 14px}.owner-brand .brand-dt{width:48px!important;height:48px!important;flex-basis:48px!important}.owner-secure{font-size:10px;padding:9px 10px}.owner-close{padding:9px 11px}.owner-hero{padding:22px 16px 16px;flex-direction:column}.owner-hero h2{font-size:36px}.owner-health{align-self:stretch;justify-content:center}.owner-stats{grid-template-columns:repeat(2,1fr);padding:0 16px 14px;gap:9px}.owner-stat{min-height:135px;padding:14px}.owner-stat strong{font-size:29px}.owner-grid{grid-template-columns:1fr;padding:0 16px 12px}.owner-status-panel{margin:0 16px 12px}.owner-status-list{grid-template-columns:1fr}.owner-status-list>div{border-right:0;border-bottom:1px solid #ffffff0b}.owner-status-list>div:last-child{border-bottom:0}.owner-footer{margin:0 16px 20px}.owner-event{grid-template-columns:10px 1fr}.owner-event time{display:none}.owner-top-actions{gap:6px}.owner-brand strong{font-size:12px}.owner-brand small{font-size:8px}}\n  ";

  return (
    <div className="owner-overlay" role="dialog" aria-modal="true" aria-label="Owner Access">
      <style>{ownerStyles}</style>
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
          <div><div className="owner-kicker">OWNER ACCESS</div><h2>Welcome back.</h2><p>Private Mike AI controls, access status, and audit activity.</p></div>
          <div className={\`owner-health \${overview?.configured ? 'ok' : 'off'}\`}><span /> {overview?.configured ? 'System Operational' : 'System Not Configured'}</div>
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
console.log('[build] Owner Access dashboard polished; main Mike experience left unchanged');
