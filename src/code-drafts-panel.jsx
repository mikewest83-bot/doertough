// src/code-drafts-panel.jsx
//
// Owner-only view of what Mike AI has proposed via read_code_file /
// save_code_draft. This panel is READ + BOOKKEEPING only: it can show a
// diff and let the owner mark a draft applied/dismissed for their own
// tracking. There is no button here that pushes anything to GitHub or the
// live app - that action does not exist anywhere in this codebase, on
// purpose. Applying a draft is still: read it here, make the change
yourself in GitHub, same as every fix shipped by hand today.
import { useEffect, useState } from 'react';
import { X, Code2, Check, RotateCcw } from 'lucide-react';

export default function CodeDraftsPanel({ authHeaders, fetchJson, onClose }) {
  const [drafts, setDrafts] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null);

  const load = async () => {
    try {
      const data = await fetchJson('/api/code-drafts', { headers: authHeaders() }, 20000);
      setDrafts(data.drafts || []);
    } catch (err) {
      setError(err.message || 'Could not load drafts.');
      setDrafts([]);
    }
  };

  useEffect(() => { load(); }, []);

  const openDraft = async (id) => {
    if (openId === id) { setOpenId(null); setDetail(null); return; }
    setOpenId(id); setDetail(null);
    try {
      setDetail(await fetchJson(`/api/code-drafts/${id}`, { headers: authHeaders() }, 20000));
    } catch (err) {
      setError(err.message || 'Could not load that draft.');
    }
  };

  const setStatus = async (id, status) => {
    setBusyId(id);
    try {
      await fetchJson(`/api/code-drafts/${id}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ status }),
      }, 20000);
      await load();
    } catch (err) {
      setError(err.message || 'Could not update that draft.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="drafts-overlay" role="dialog" aria-modal="true" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="drafts-card">
        <div className="drafts-head">
          <h2><Code2 size={18} /> Code Drafts</h2>
          <button className="drafts-close" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <p className="drafts-sub">
          Things Mike AI has proposed. Nothing here has been applied anywhere - review a diff, make the
          change in GitHub yourself, then mark it applied.
        </p>
        {error && <div className="drafts-error">{error}</div>}
        {drafts === null && <div className="drafts-empty">Loading…</div>}
        {drafts && drafts.length === 0 && <div className="drafts-empty">No drafts yet.</div>}
        {drafts && drafts.length > 0 && (
          <ul className="drafts-list">
            {drafts.map((d) => (
              <li key={d.id} className={`drafts-item status-${d.status}`}>
                <button className="drafts-item-head" onClick={() => openDraft(d.id)}>
                  <span className="drafts-path">{d.path}</span>
                  <span className="drafts-status">{d.status}</span>
                </button>
                <p className="drafts-desc">{d.description}</p>
                {openId === d.id && (
                  <div className="drafts-detail">
                    {!detail && <div className="drafts-empty">Loading diff…</div>}
                    {detail && <pre className="drafts-diff">{detail.diff_text}</pre>}
                    <div className="drafts-actions">
                      <button disabled={busyId === d.id} onClick={() => setStatus(d.id, 'applied')}>
                        <Check size={14} /> Mark applied
                      </button>
                      <button disabled={busyId === d.id} onClick={() => setStatus(d.id, 'dismissed')}>
                        <RotateCcw size={14} /> Dismiss
                      </button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
