import React, { useEffect, useState } from 'react';
import { ArrowRight, Users, ShieldCheck, ClipboardList } from 'lucide-react';

const authHeaders = () => {
  try {
    const token = localStorage.getItem('mike_token') || '';
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch { return {}; }
};

async function ownerFetch(path, options = {}) {
  const res = await fetch(path, { ...options, headers: { ...authHeaders(), ...(options.headers || {}) } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || 'Owner request failed.');
    err.status = res.status;
    throw err;
  }
  return data;
}

export default function OwnerPortal({ onClose }) {
  const [overview, setOverview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [panel, setPanel] = useState(null);

  useEffect(() => {
    let cancelled = false;
    ownerFetch('/api/owner/overview')
      .then((data) => { if (!cancelled) setOverview(data); })
      .catch((err) => { if (!cancelled) setError(err.status === 403 ? 'Owner access required.' : 'Owner dashboard is unavailable right now.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const users = overview?.users ?? 0;
  const owners = overview?.roles?.owner ?? 0;
  const admins = overview?.roles?.admin ?? 0;
  const audit = Array.isArray(overview?.recentAudit) ? overview.recentAudit : [];

  const openPanel = (name) => {
    setError('');
    setPanel(panel === name ? null : name);
  };

  return (
    <div className="owner-overlay" role="dialog" aria-modal="true" aria-label="Owner Access">
      <style>{`
        .owner-overlay{position:fixed;inset:0;z-index:100;overflow:auto;background:#050709;color:#f5f7f9;padding:14px}
        .owner-dashboard{max-width:1180px;margin:0 auto;border:1px solid #ffffff14;border-radius:22px;background:#090d11;box-shadow:0 30px 100px #000c;overflow:hidden}
        .owner-topbar{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:16px 20px;border-bottom:1px solid #ffffff10;background:#090c10;position:sticky;top:0;z-index:2}
        .owner-brand{display:flex;align-items:center;gap:12px}.owner-brand strong{display:block;font-size:14px;letter-spacing:.18em}.owner-brand small{display:block;margin-top:3px;color:#747c84;font-size:9px;letter-spacing:.2em}.owner-brand .brand-dt{width:48px!important;height:48px!important;flex-basis:48px!important}
        .owner-actions{display:flex;align-items:center;gap:9px}.owner-secure{padding:9px 12px;border:1px solid #f26b2166;border-radius:999px;color:#ff8a3d;background:#f26b210c;font-size:10px;font-weight:800}.owner-close{display:inline-flex;align-items:center;gap:6px;padding:9px 13px;border:1px solid #ffffff20;border-radius:999px;background:#ffffff06;color:#fff;font-weight:700}
        .owner-hero{display:flex;justify-content:space-between;gap:20px;padding:28px 28px 18px}.owner-kicker{color:#ff7b27;font-size:11px;font-weight:900;letter-spacing:.2em}.owner-hero h2{margin:7px 0;font-size:clamp(34px,5vw,52px);line-height:1}.owner-hero p{margin:0;color:#8b949c;font-size:14px}.owner-health{align-self:flex-start;display:flex;align-items:center;gap:8px;padding:10px 13px;border-radius:10px;background:#ffffff07;font-size:12px;white-space:nowrap}.owner-health i{width:8px;height:8px;border-radius:50%;background:#2bd866;box-shadow:0 0 10px #2bd86677}.owner-health.off i{background:#ff8a3d;box-shadow:none}
        .owner-message{margin:0 28px 18px;padding:14px;border:1px solid #ffffff10;border-radius:12px;background:#ffffff05;color:#aeb5bb}.owner-error{color:#ffb09a;border-color:#713426;background:#21100d}
        .owner-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;padding:0 28px 18px}.owner-stat{padding:18px;border:1px solid #ffffff12;border-radius:15px;background:#0e1318}.owner-stat small{display:block;color:#aeb6bd;font-size:12px}.owner-stat strong{display:block;margin-top:8px;font-size:32px}.owner-stat em{display:block;margin-top:5px;color:#68727a;font-size:10px;font-style:normal}
        .owner-grid{display:grid;grid-template-columns:1.4fr 1fr;gap:12px;padding:0 28px 14px}.owner-panel{border:1px solid #ffffff12;border-radius:15px;background:#0d1217;overflow:hidden}.owner-panel-head{padding:16px 18px;border-bottom:1px solid #ffffff0d}.owner-panel-head h3{margin:0;font-size:17px}.owner-panel-head p{margin:4px 0 0;color:#6e7880;font-size:11px}.owner-event{display:grid;grid-template-columns:8px 1fr auto;gap:12px;align-items:center;padding:13px 18px;border-bottom:1px solid #ffffff09}.owner-event:last-child{border-bottom:0}.owner-event i{width:8px;height:8px;border-radius:50%;background:#ff7b27}.owner-event strong{display:block;font-size:12px}.owner-event small{display:block;margin-top:3px;color:#6e7880;font-size:10px}.owner-event time{color:#69737b;font-size:9px}.owner-quick{padding:10px}.owner-quick button{width:100%;display:flex;align-items:center;gap:10px;padding:14px 11px;margin-bottom:7px;border:1px solid #ffffff0c;border-radius:10px;background:#ffffff03;color:#fff;text-align:left;cursor:pointer}.owner-quick button:last-child{margin-bottom:0}.owner-quick span{color:#ff7b27;font-size:17px}.owner-quick strong{display:block;font-size:12px}.owner-quick small{display:block;margin-top:3px;color:#6d777f;font-size:10px}.owner-quick b{margin-left:auto;color:#68727a;font-size:20px;font-weight:400}.owner-detail{margin:0 10px 10px;padding:13px;border:1px solid #ffffff0c;border-radius:10px;background:#080c10;color:#aeb5bb;font-size:11px;line-height:1.5}.owner-detail strong{color:#fff}.owner-status{margin:0 28px 14px}.owner-status-row{display:grid;grid-template-columns:repeat(3,1fr)}.owner-status-row div{padding:15px 18px;border-right:1px solid #ffffff09;font-size:12px}.owner-status-row div:last-child{border-right:0}.owner-status-row b{float:right;color:#2bd866}.owner-footer{margin:0 28px 24px;padding:12px;border:1px solid #ffffff0c;border-radius:10px;text-align:center;color:#69737b;font-size:10px}
        @media(max-width:760px){.owner-overlay{padding:0 7px 20px}.owner-dashboard{border-radius:18px}.owner-topbar{padding:13px}.owner-secure{display:none}.owner-close{padding:8px 10px}.owner-hero{padding:22px 15px 15px;display:block}.owner-hero h2{font-size:35px}.owner-health{margin-top:14px;justify-content:center}.owner-stats{grid-template-columns:1fr 1fr;padding:0 15px 12px;gap:8px}.owner-stat{padding:14px}.owner-stat strong{font-size:27px}.owner-grid{grid-template-columns:1fr;padding:0 15px 12px}.owner-status{margin:0 15px 12px}.owner-status-row{grid-template-columns:1fr}.owner-status-row div{border-right:0;border-bottom:1px solid #ffffff09}.owner-status-row div:last-child{border-bottom:0}.owner-footer{margin:0 15px 18px}.owner-event{grid-template-columns:8px 1fr}.owner-event time{display:none}}
      `}</style>
      <div className="owner-dashboard">
        <div className="owner-topbar"><div className="owner-brand"><b className="brand-dt"><span>D</span><em>T</em></b><div><strong>MIKE AI</strong><small>DOER TOUGH</small></div></div><div className="owner-actions"><span className="owner-secure">🔒 OWNER ACCESS</span><button className="owner-close" onClick={onClose}><ArrowRight size={17} style={{transform:'rotate(180deg)'}} /> Mike</button></div></div>
        <section className="owner-hero"><div><div className="owner-kicker">OWNER ACCESS</div><h2>Welcome back.</h2><p>Private Mike AI controls, access status, and audit activity.</p></div><div className={`owner-health ${overview?.configured ? '' : 'off'}`}><i />{overview?.configured ? 'System Operational' : 'System Not Configured'}</div></section>
        {loading && <div className="owner-message">Loading owner controls…</div>}
        {error && <div className="owner-message owner-error" role="alert">{error}</div>}
        {!loading && !error && overview && <>
          <div className="owner-stats"><div className="owner-stat"><small>Total Users</small><strong>{users}</strong><em>Accounts in Mike AI</em></div><div className="owner-stat"><small>Owners</small><strong>{owners}</strong><em>Privileged owner accounts</em></div><div className="owner-stat"><small>Admins</small><strong>{admins}</strong><em>Administrative accounts</em></div></div>
          <div className="owner-grid"><section className="owner-panel"><div className="owner-panel-head"><h3>Recent Activity</h3><p>Latest security and owner events</p></div>{audit.length ? audit.map((item,index)=><div className="owner-event" key={`${item.createdAt||''}-${item.action||''}-${index}`}><i/><div><strong>{item.action}</strong><small>{item.targetType || 'System activity'}{item.targetId ? ` · ${item.targetId}` : ''}</small></div><time>{item.createdAt ? new Date(item.createdAt).toLocaleString() : ''}</time></div>) : <div className="owner-message">No audit activity recorded yet.</div>}</section><section className="owner-panel"><div className="owner-panel-head"><h3>Owner Controls</h3><p>Administrative areas</p></div><div className="owner-quick">
            <button type="button" onClick={() => openPanel('users')} aria-expanded={panel === 'users'}><Users /><div><strong>User Management</strong><small>Role and access controls</small></div><b>›</b></button>
            {panel === 'users' && <div className="owner-detail"><strong>User Management</strong><br/>The owner dashboard exposes account totals and role counts here. Mutating user roles is intentionally not enabled until a dedicated server-side owner endpoint is present.</div>}
            <button type="button" onClick={() => openPanel('audit')} aria-expanded={panel === 'audit'}><ClipboardList /><div><strong>Audit Activity</strong><small>Review security events</small></div><b>›</b></button>
            {panel === 'audit' && <div className="owner-detail"><strong>Audit Activity</strong><br/>Showing the latest audit events above. Audit records are stored server-side and ordered newest first.</div>}
            <button type="button" onClick={() => openPanel('access')} aria-expanded={panel === 'access'}><ShieldCheck /><div><strong>Access Control</strong><small>RBAC status and permissions</small></div><b>›</b></button>
            {panel === 'access' && <div className="owner-detail"><strong>Access Control</strong><br/>Owner permissions are enforced server-side. The dashboard does not accept roles or permissions from the browser.</div>}
          </div></section></div>
          <section className="owner-panel owner-status"><div className="owner-panel-head"><h3>System Status</h3><p>Current owner-access service state</p></div><div className="owner-status-row"><div>RBAC <b>{overview.configured ? 'Operational' : 'Not configured'}</b></div><div>Owner API <b>Operational</b></div><div>Audit Log <b>{overview.configured ? 'Available' : 'Unavailable'}</b></div></div></section>
        </>}
        <div className="owner-footer">🔒 Owner access is restricted. Activity is logged for security.</div>
      </div>
    </div>
  );
}
