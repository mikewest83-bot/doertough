import React, { useEffect, useState } from 'react';
import { ArrowRight } from 'lucide-react';

const authHeaders = () => {
  try { const token = localStorage.getItem('mike_token') || ''; return token ? { Authorization: `Bearer ${token}` } : {}; }
  catch { return {}; }
};
const fmt = (n) => Number(n || 0).toLocaleString();
const money = (n) => n == null ? '—' : `$${Number(n).toLocaleString(undefined,{maximumFractionDigits:0})}`;
const date = (v) => v ? new Date(v).toLocaleDateString() : '—';
const ago = (v) => {
  if (!v) return '—';
  const secs = Math.max(0, Math.round((Date.now() - new Date(v).getTime()) / 1000));
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.round(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.round(secs / 3600)}h ago`;
  return `${Math.round(secs / 86400)}d ago`;
};

export default function OwnerPortal({ onClose }) {
  const [data,setData]=useState(null); const [loading,setLoading]=useState(true); const [tab,setTab]=useState('users');
  const [dir,setDir]=useState(null); const [dirErr,setDirErr]=useState(false);
  const [openUser,setOpenUser]=useState(null);   // { user, conversations } once loaded
  const [openConvo,setOpenConvo]=useState(null); // { ...conversation } once loaded
  const [activity,setActivity]=useState(null);
  const [q,setQ]=useState(''); const [results,setResults]=useState(null); const [searching,setSearching]=useState(false);
  useEffect(()=>{let dead=false; fetch('/api/owner/metrics',{headers:authHeaders()}).then(async r=>{if(!r.ok) throw new Error('unavailable'); return r.json();}).then(v=>{if(!dead)setData(v);}).catch(()=>{}).finally(()=>{if(!dead)setLoading(false);}); return()=>{dead=true;};},[]);
  useEffect(()=>{
    if (tab!=='users') return; let dead=false;
    const load=()=>fetch('/api/owner/users?minutes=1440',{headers:authHeaders()})
      .then(r=>{if(!r.ok) throw new Error('unavailable'); return r.json();})
      .then(d=>{if(!dead){setDir(d); setDirErr(false);}})
      .catch(()=>{if(!dead) setDirErr(true);});
    load(); const t=setInterval(load, 15000);
    fetch('/api/owner/activity',{headers:authHeaders()}).then(r=>r.ok?r.json():null).then(d=>{if(!dead&&d)setActivity(d);}).catch(()=>{});
    return ()=>{dead=true; clearInterval(t);};
  },[tab]);
  const openUserRow=(id)=>{ setOpenConvo(null); setOpenUser({ loading:true });
    fetch(`/api/owner/users/${id}`,{headers:authHeaders()}).then(r=>r.ok?r.json():null)
      .then(d=>setOpenUser(d||{error:true})).catch(()=>setOpenUser({error:true})); };
  const runSearch=(e)=>{ if(e&&e.preventDefault)e.preventDefault(); const term=q.trim(); if(term.length<2){setResults({tooShort:true,results:[]});return;} setSearching(true); setResults(null);
    fetch('/api/owner/search?q='+encodeURIComponent(term),{headers:authHeaders()}).then(r=>r.ok?r.json():{results:[]}).then(d=>setResults(d)).catch(()=>setResults({error:true,results:[]})).finally(()=>setSearching(false)); };
  const openConvoRow=(id)=>{ setOpenConvo({ loading:true });
    fetch(`/api/owner/conversations/${id}`,{headers:authHeaders()}).then(r=>r.ok?r.json():null)
      .then(d=>setOpenConvo(d||{error:true})).catch(()=>setOpenConvo({error:true})); };
  const o=data?.overview, v=data?.voice, g=data?.growth, s=data?.subscriptions, a=data?.access;
  const alerts=data?.alerts || [];
  return <div className="owner-overlay" role="dialog" aria-modal="true" aria-label="Owner Access"><style>{`
    .owner-overlay{position:fixed;inset:0;z-index:100;overflow:auto;background:#050709;color:#f5f7f9;padding:14px}.owner-dashboard{max-width:1200px;margin:0 auto;border:1px solid #ffffff14;border-radius:22px;background:#090d11;box-shadow:0 30px 100px #000c;overflow:hidden}.owner-topbar{display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid #ffffff10;background:#090c10;position:sticky;top:0;z-index:3}.owner-brand{display:flex;align-items:center;gap:12px}.owner-brand strong{display:block;font-size:14px;letter-spacing:.18em}.owner-brand small{display:block;margin-top:3px;color:#747c84;font-size:9px;letter-spacing:.2em}.brand-dt{width:48px;height:48px;display:grid;place-items:center;border-radius:10px;background:#111820;font-weight:900}.brand-dt span{color:#fff}.brand-dt em{color:#ff7b27;font-style:normal}.owner-actions{display:flex;gap:9px;align-items:center}.owner-secure{padding:9px 12px;border:1px solid #f26b2166;border-radius:999px;color:#ff8a3d;font-size:10px;font-weight:800}.owner-close{display:inline-flex;align-items:center;gap:6px;padding:9px 13px;border:1px solid #ffffff20;border-radius:999px;background:#ffffff06;color:#fff;font-weight:700;cursor:pointer}.owner-hero{display:flex;justify-content:space-between;gap:20px;padding:28px}.owner-kicker{color:#ff7b27;font-size:11px;font-weight:900;letter-spacing:.2em}.owner-hero h2{margin:7px 0;font-size:clamp(34px,5vw,52px);line-height:1}.owner-hero p{margin:0;color:#8b949c;font-size:14px}.owner-health{align-self:flex-start;padding:10px 13px;border-radius:10px;background:#ffffff07;font-size:12px}.owner-health i{display:inline-block;width:8px;height:8px;margin-right:8px;border-radius:50%;background:#2bd866}.owner-alerts{margin:0 28px 18px;display:grid;gap:7px}.owner-alert{padding:12px 14px;border-radius:10px;border:1px solid #ff7b2744;background:#1b120d;color:#ffc09e;font-size:12px}.owner-alert.danger{border-color:#8b3a2f;background:#210f0d}.owner-stats{display:grid;grid-template-columns:repeat(6,1fr);gap:10px;padding:0 28px 18px}.owner-stat{padding:16px;border:1px solid #ffffff12;border-radius:15px;background:#0e1318}.owner-stat small{display:block;color:#aeb6bd;font-size:11px}.owner-stat strong{display:block;margin-top:7px;font-size:26px}.owner-stat em{display:block;margin-top:4px;color:#68727a;font-size:9px;font-style:normal}.owner-tabs{display:flex;gap:6px;padding:0 28px 12px;overflow:auto}.owner-tab{border:1px solid #ffffff12;background:#0e1318;color:#8d969d;padding:10px 13px;border-radius:9px;font-weight:800;font-size:11px;white-space:nowrap;cursor:pointer}.owner-tab.active{color:#fff;border-color:#ff7b2766;background:#ff7b270d}.owner-panel{margin:0 28px 14px;border:1px solid #ffffff12;border-radius:15px;background:#0d1217;overflow:hidden}.owner-panel-head{padding:16px 18px;border-bottom:1px solid #ffffff0d}.owner-panel-head h3{margin:0;font-size:17px}.owner-panel-head p{margin:4px 0 0;color:#6e7880;font-size:11px}.owner-table{width:100%;border-collapse:collapse}.owner-table th,.owner-table td{padding:11px 14px;border-bottom:1px solid #ffffff09;text-align:left;font-size:11px}.owner-table th{color:#737d85;font-size:9px;letter-spacing:.08em;text-transform:uppercase}.owner-table td{color:#d7dce0}.owner-bars{display:flex;align-items:end;gap:7px;height:180px;padding:22px 18px}.owner-bar{flex:1;display:flex;flex-direction:column;justify-content:end;align-items:center;height:100%;gap:5px}.owner-bar i{width:100%;max-width:34px;border-radius:5px 5px 0 0;background:#ff7b27;min-height:2px}.owner-bar small{color:#68727a;font-size:8px}.owner-bar b{font-size:9px}.owner-kpis{display:grid;grid-template-columns:repeat(4,1fr)}.owner-kpi{padding:18px;border-right:1px solid #ffffff09}.owner-kpi:last-child{border-right:0}.owner-kpi small{color:#747e86}.owner-kpi strong{display:block;margin-top:7px;font-size:25px}.owner-role{display:flex;justify-content:space-between;padding:14px 18px;border-bottom:1px solid #ffffff09;font-size:12px}.owner-role b{color:#2bd866}.owner-empty{padding:28px;text-align:center;color:#68727a;font-size:12px}.owner-foot{margin:0 28px 24px;padding:12px;border:1px solid #ffffff0c;border-radius:10px;text-align:center;color:#69737b;font-size:10px}
    @media(max-width:850px){.owner-stats{grid-template-columns:repeat(3,1fr)}}@media(max-width:600px){.owner-overlay{padding:0 7px 20px}.owner-topbar{padding:13px}.owner-secure{display:none}.owner-hero{display:block;padding:22px 15px}.owner-health{margin-top:14px}.owner-stats{grid-template-columns:1fr 1fr;padding:0 15px 12px}.owner-tabs{padding:0 15px 12px}.owner-panel,.owner-alerts{margin-left:15px;margin-right:15px}.owner-kpis{grid-template-columns:1fr 1fr}.owner-kpi{border-bottom:1px solid #ffffff09}.owner-foot{margin-left:15px;margin-right:15px}.owner-table{min-width:600px}.owner-panel{overflow:auto}}
.owner-actrow{display:flex;flex-wrap:wrap;gap:10px;padding:16px 18px 4px}.owner-actstat{flex:1;min-width:92px;padding:12px 14px;border:1px solid #ffffff12;border-radius:11px;background:#0e1318}.owner-actstat b{display:block;font-size:22px;font-variant-numeric:tabular-nums}.owner-actstat b.owner-hot{color:#2bd866}.owner-actstat span{display:block;margin-top:3px;font-size:9px;letter-spacing:.08em;text-transform:uppercase;color:#747e86}.owner-search{display:flex;gap:8px;padding:14px 18px 6px;flex-wrap:wrap}.owner-search input{flex:1;min-width:180px;padding:11px 13px;border:1px solid #ffffff18;border-radius:9px;background:#0e1318;color:#f5f7f9;font-size:13px}.owner-search input:focus{outline:none;border-color:#ff7b2766}.owner-search button{padding:11px 16px;border:1px solid #ff7b2766;border-radius:9px;background:#ff7b270d;color:#ff8a3d;font-weight:800;font-size:12px;cursor:pointer}.owner-search button.owner-search-clear{border-color:#ffffff20;background:#ffffff06;color:#c7ccd1}.owner-results{padding:0 0 6px}.owner-userrow{cursor:pointer}.owner-userrow:hover td{background:#ffffff08}.owner-live{display:inline-flex;align-items:center;gap:5px;color:#2bd866;font-weight:800;font-size:9px;letter-spacing:.08em}.owner-live i{width:7px;height:7px;border-radius:50%;background:#2bd866;box-shadow:0 0 0 0 #2bd86688;animation:ownerPulse 1.8s infinite}@keyframes ownerPulse{0%{box-shadow:0 0 0 0 #2bd86688}70%{box-shadow:0 0 0 7px #2bd86600}100%{box-shadow:0 0 0 0 #2bd86600}}@media(prefers-reduced-motion:reduce){.owner-live i{animation:none}}.owner-dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:#3a444c}.owner-preview{color:#aeb6bd;max-width:340px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.owner-drawer{position:fixed;inset:0;z-index:120;padding-top:40px;background:#050709d9;overflow:auto;padding:24px 14px;display:flex;justify-content:center;align-items:flex-start}.owner-drawer--top{z-index:130;background:#050709ee}.owner-drawer-card{width:100%;max-width:860px;margin-top:24px;border:1px solid #ffffff18;border-radius:16px;background:#0c1116;box-shadow:0 30px 90px #000c;overflow:hidden}.owner-drawer-head{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;padding:18px 20px;border-bottom:1px solid #ffffff0d}.owner-drawer-head h3{margin:5px 0 0;font-size:20px}.owner-drawer-head p{margin:5px 0 0;color:#6e7880;font-size:11px}.owner-thread{padding:16px 18px;display:flex;flex-direction:column;gap:12px;max-height:70vh;overflow:auto}.owner-msg{max-width:78%;padding:10px 13px;border-radius:13px;font-size:13px;line-height:1.5}.owner-msg small{display:block;margin-bottom:5px;font-size:9px;letter-spacing:.06em;text-transform:uppercase;opacity:.6}.owner-msg p{margin:0;white-space:pre-wrap;word-break:break-word}.owner-msg.is-user{align-self:flex-end;background:#ff7b271a;border:1px solid #ff7b2733}.owner-msg.is-mike{align-self:flex-start;background:#0f151b;border:1px solid #ffffff12}@media(max-width:600px){.owner-preview{max-width:150px}.owner-msg{max-width:90%}}  `}</style><div className="owner-dashboard">
    <div className="owner-topbar"><div className="owner-brand"><b className="brand-dt"><span>D</span><em>T</em></b><div><strong>MIKE AI</strong><small>DOER TOUGH</small></div></div><div className="owner-actions"><span className="owner-secure">🔒 OWNER ACCESS</span><button className="owner-close" onClick={onClose}><ArrowRight size={17} style={{transform:'rotate(180deg)'}}/> Mike</button></div></div>
    <section className="owner-hero"><div><div className="owner-kicker">OWNER ACCESS</div><h2>Welcome back.</h2><p>Live production metrics, growth, subscriptions, voice usage, and access.</p></div><div className="owner-health"><i/>{loading?'Loading metrics…':'System Operational'}</div></section>
    {alerts.length>0&&<div className="owner-alerts">{alerts.map((x,i)=><div key={i} className={`owner-alert ${x.type}`}>⚠ {x.text}</div>)}</div>}
    {!loading&&<>{o&&<div className="owner-stats"><Stat label="Paying" value={fmt(o.paying)} sub="accounts"/><Stat label="MRR" value={money(o.mrr)} sub="subscription price not stored in DB"/><Stat label="In Trial" value={fmt(o.trialing)} sub={money(o.trialMrr)+' if converted'}/><Stat label="Accounts" value={fmt(o.accounts)} sub={`${o.paidPlanPercent}% on paid plan`}/><Stat label="New This Week" value={fmt(o.newThisWeek)} sub="created accounts"/><Stat label="Active Today" value={fmt(o.activeToday)} sub={`${fmt(v?.minutes)} voice minutes / 30d`}/></div>}
      <div className="owner-tabs">{[['users','Users'],['growth','Accounts & Growth'],['subs','Subscriptions'],['voice','Voice Usage'],['access','Access Control']].map(([id,label])=><button key={id} className={`owner-tab ${tab===id?'active':''}`} onClick={()=>setTab(id)}>{label}</button>)}</div>
      {tab==='users'&&<Panel title="Users" subtitle="Everyone active in the last 24 hours. Green means moving right now — click a user to see what they're doing.">
        {activity&&<div className="owner-actrow">
          <div className="owner-actstat"><b>{fmt(activity.users)}</b><span>users</span></div>
          <div className="owner-actstat"><b>{fmt(activity.activeToday)}</b><span>active today</span></div>
          <div className="owner-actstat"><b className={activity.liveNow?'owner-hot':''}>{fmt(activity.liveNow)}</b><span>live now</span></div>
          <div className="owner-actstat"><b>{fmt(activity.messagesToday)}</b><span>messages today</span></div>
          <div className="owner-actstat"><b>{fmt(activity.conversations)}</b><span>conversations</span></div>
          {activity.voiceSessions30d!=null&&<div className="owner-actstat"><b>{fmt(activity.voiceSessions30d)}</b><span>voice / 30d</span></div>}
        </div>}
        <form className="owner-search" onSubmit={runSearch}>
          <input value={q} onChange={e=>setQ(e.target.value)} placeholder="Search everything users have said…" aria-label="Search conversations"/>
          <button type="submit">{searching?'Searching…':'Search'}</button>
          {results&&<button type="button" className="owner-search-clear" onClick={()=>{setResults(null);setQ('');}}>Clear</button>}
        </form>
        {results&&<div className="owner-results">
          {results.tooShort&&<div className="owner-empty">Type at least 2 characters.</div>}
          {results.error&&<div className="owner-empty">Search unavailable.</div>}
          {!results.tooShort&&!results.error&&results.results.length===0&&<div className="owner-empty">No matches for “{results.term}”.</div>}
          {results.results.length>0&&<table className="owner-table"><thead><tr><th>User</th><th>Match</th><th>Hits</th><th>When</th><th></th></tr></thead><tbody>
            {results.results.map(r=><tr key={r.id} className="owner-userrow" onClick={()=>openConvoRow(r.id)}>
              <td>{r.user.name||r.user.email||'—'}</td>
              <td className="owner-preview">{r.snippetRole==='user'?'':'Mike: '}{r.snippet||'—'}</td>
              <td>{fmt(r.matches)}</td><td>{ago(r.at)}</td>
              <td><ArrowRight size={14} style={{opacity:.5}}/></td>
            </tr>)}
          </tbody></table>}
        </div>}
        {dirErr&&<div className="owner-empty">User directory unavailable.</div>}
        {!dirErr&&!dir&&<div className="owner-empty">Loading users…</div>}
        {!dirErr&&dir&&dir.users.length===0&&<div className="owner-empty">No active users in this window.</div>}
        {!dirErr&&dir&&dir.users.length>0&&<table className="owner-table"><thead><tr><th></th><th>Name</th><th>Email</th><th>Plan</th><th>Convos</th><th>Turns</th><th>Last seen</th><th></th></tr></thead><tbody>
          {dir.users.map(u=><tr key={u.id} className="owner-userrow" onClick={()=>openUserRow(u.id)}>
            <td>{u.live?<span className="owner-live"><i/>LIVE</span>:<span className="owner-dot"/>}</td>
            <td>{u.name||'—'}</td><td>{u.email||'—'}</td><td>{u.plan||'free'}</td>
            <td>{fmt(u.conversations)}</td><td>{fmt(u.turns)}</td><td>{ago(u.lastSeenAt)}</td>
            <td><ArrowRight size={14} style={{opacity:.5}}/></td>
          </tr>)}
        </tbody></table>}
      </Panel>}
      {o&&tab==='growth'&&<><Panel title="14-Day Signups" subtitle="Real account creation activity"><div className="owner-bars">{(g?.bars||[]).map((x,i)=>{const max=Math.max(1,...(g?.bars||[]).map(b=>Number(b.signups)||0));return <div className="owner-bar" key={i}><b>{x.signups}</b><i style={{height:`${Math.max(2,(Number(x.signups)||0)/max*120)}px`}}/><small>{new Date(x.date).toLocaleDateString(undefined,{month:'numeric',day:'numeric'})}</small></div>})}</div></Panel><Panel title="Last 8 Signups" subtitle="Plan and subscription state"><Table heads={['Name','Email','Plan','Status','Created']} rows={(g?.signups||[]).map(x=>[x.name,x.email,x.plan||'free',x.subscription_status||'—',date(x.created_at)])}/></Panel></>}
      {o&&tab==='subs'&&<><Panel title="Subscription Overview" subtitle="Current database-backed billing state"><div className="owner-kpis"><Kpi label="Paying" value={fmt(o.paying)}/><Kpi label="MRR" value={money(o.mrr)}/><Kpi label="Trials" value={fmt(o.trialing)}/><Kpi label="Past Due" value={fmt(o.pastDue)}/></div></Panel><Panel title="Trials Ending Within 3 Days" subtitle="Requires attention"><Table heads={['Name','Email','Trial End']} rows={(s?.trialsEnding||[]).map(x=>[x.name,x.email,date(x.trial_end)])}/></Panel><Panel title="Past Due" subtitle="Billing state"><Table heads={['Name','Email','Period End']} rows={(s?.pastDue||[]).map(x=>[x.name,x.email,date(x.current_period_end)])}/></Panel></>}
      {o&&tab==='voice'&&<Panel title="Voice Usage" subtitle="Rolling 30-day production metering"><div className="owner-kpis"><Kpi label="Minutes" value={fmt(v?.minutes)}/><Kpi label="Pool Share" value={`${fmt(v?.poolPercent)}%`}/><Kpi label="Sessions" value={fmt(v?.sessions)}/><Kpi label="Distinct Callers" value={fmt(v?.callers)}/></div><div className="owner-role"><span>30-day ceiling</span><b>{fmt(v?.poolMinutes)} min</b></div><div className="owner-role"><span>Never settled</span><b>{fmt(v?.neverSettled)}</b></div></Panel>}
      {o&&tab==='access'&&<Panel title="Access Control" subtitle="Real RBAC role counts"><>{Object.entries(a?.roles||{}).map(([role,count])=><div className="owner-role" key={role}><span>{role}</span><b>{fmt(count)}</b></div>)}{!a&&<div className="owner-empty">Access metrics unavailable.</div>}</></Panel>}
      {!o&&tab!=='users'&&<div className="owner-panel"><div className="owner-empty">Owner metrics are unavailable right now. The user directory above still works.</div></div>}
    </>}
    {openUser&&<div className="owner-drawer" role="dialog" aria-modal="true" aria-label="User activity">
      <div className="owner-drawer-card">
        <div className="owner-drawer-head">
          <div>
            <div className="owner-kicker">USER</div>
            <h3>{openUser.loading?'Loading…':openUser.error?'Unavailable':(openUser.user?.name||openUser.user?.email||'User')}</h3>
            {openUser.user&&<p>{openUser.user.email} · {openUser.user.plan||'free'} · joined {date(openUser.user.createdAt)} · last seen {ago(openUser.user.lastSeenAt)}</p>}
          </div>
          <button className="owner-close" onClick={()=>{setOpenUser(null);setOpenConvo(null);}}>Close</button>
        </div>
        {openUser.error&&<div className="owner-empty">Could not load this user.</div>}
        {openUser.conversations&&openUser.conversations.length===0&&<div className="owner-empty">No conversations yet.</div>}
        {openUser.conversations&&openUser.conversations.length>0&&<table className="owner-table"><thead><tr><th></th><th>Last message</th><th>Turns</th><th>When</th><th></th></tr></thead><tbody>
          {openUser.conversations.map(c=><tr key={c.id} className="owner-userrow" onClick={()=>openConvoRow(c.id)}>
            <td>{c.live?<span className="owner-live"><i/>LIVE</span>:<span className="owner-dot"/>}</td>
            <td className="owner-preview">{c.lastRole==='user'?'':'Mike: '}{c.preview||'—'}</td>
            <td>{fmt(c.turns)}</td><td>{ago(c.lastAt)}</td>
            <td><ArrowRight size={14} style={{opacity:.5}}/></td>
          </tr>)}
        </tbody></table>}
      </div>
    </div>}
    {openConvo&&<div className="owner-drawer owner-drawer--top" role="dialog" aria-modal="true" aria-label="Conversation transcript">
      <div className="owner-drawer-card">
        <div className="owner-drawer-head">
          <div><div className="owner-kicker">TRANSCRIPT</div><h3>{openConvo.loading?'Loading…':openConvo.error?'Unavailable':`Conversation #${openConvo.id}`}</h3>
          {openConvo.startedAt&&<p>Started {date(openConvo.startedAt)} · {openConvo.messages?.length||0} turns{openConvo.truncated?' (showing latest)':''}</p>}</div>
          <button className="owner-close" onClick={()=>setOpenConvo(null)}>Back</button>
        </div>
        {openConvo.error&&<div className="owner-empty">Could not load this conversation.</div>}
        {openConvo.messages&&<div className="owner-thread">{openConvo.messages.map(m=><div key={m.id} className={`owner-msg ${m.role==='user'?'is-user':'is-mike'}`}>
          <small>{m.role==='user'?'User':'Mike'} · {ago(m.at)}</small><p>{m.content}</p>
        </div>)}</div>}
      </div>
    </div>}
    <div className="owner-foot">🔒 Owner access is restricted. Activity is logged for security.</div>
  </div></div>;
}
function Stat({label,value,sub}){return <div className="owner-stat"><small>{label}</small><strong>{value}</strong><em>{sub}</em></div>}
function Kpi({label,value}){return <div className="owner-kpi"><small>{label}</small><strong>{value}</strong></div>}
function Panel({title,subtitle,children}){return <section className="owner-panel"><div className="owner-panel-head"><h3>{title}</h3><p>{subtitle}</p></div>{children}</section>}
function Table({heads,rows}){return rows.length?<table className="owner-table"><thead><tr>{heads.map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{rows.map((r,i)=><tr key={i}>{r.map((c,j)=><td key={j}>{c}</td>)}</tr>)}</tbody></table>:<div className="owner-empty">No records.</div>}
