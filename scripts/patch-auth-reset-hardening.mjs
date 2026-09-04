import fs from 'node:fs';

const path = 'src/main.jsx';
let source = fs.readFileSync(path, 'utf8');

const keyAnchor = "const TOKEN_KEY = 'mike_token';";
const keyBlock = "const TOKEN_KEY = 'mike_token';\nconst RESET_TOKEN_KEY = 'mike_reset_token';\nconst readResetToken = () => { try { return sessionStorage.getItem(RESET_TOKEN_KEY) || ''; } catch { return ''; } };\nconst writeResetToken = (token) => { try { if (token) sessionStorage.setItem(RESET_TOKEN_KEY, token); else sessionStorage.removeItem(RESET_TOKEN_KEY); } catch {} };";
if (!source.includes('const RESET_TOKEN_KEY')) {
  if (!source.includes(keyAnchor)) throw new Error('[auth-reset] token anchor not found');
  source = source.replace(keyAnchor, keyBlock);
}

const oldSubmit = "const submitAuth = async (e) => { e?.preventDefault?.(); if (authBusy) return; setAuthBusy(true); setAuthError(''); setAuthNotice(''); try { if (authMode === 'forgot') { const data = await fetchJson('/api/auth/forgot-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: authForm.email }) }, 20000); setAuthNotice(data.message || 'If that email has an account, a reset link is on its way.'); return; } if (authMode === 'reset') { const data = await fetchJson('/api/auth/reset-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: resetToken, password: authForm.password }) }, 20000); writeToken(data.token); setUser(data.user); setAuthOpen(false); setResetToken(''); setAuthForm({ name: '', email: '', password: '' }); return; }";
const newSubmit = "const submitAuth = async (e) => { e?.preventDefault?.(); if (authBusy) return; setAuthBusy(true); setAuthError(''); setAuthNotice(''); try { if (authMode === 'forgot') { const data = await fetchJson('/api/auth/forgot-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: authForm.email }) }, 20000); setAuthNotice(data.message || 'If that email has an account, a reset link is on its way.'); return; } if (authMode === 'reset') { const urlToken = new URLSearchParams(window.location.search).get('reset') || ''; const token = resetToken || readResetToken() || urlToken; if (!token) { setAuthError('This reset link is missing or invalid. Request a new reset link.'); return; } if (!authForm.password || authForm.password.length < 8) { setAuthError('Use a password of at least 8 characters.'); return; } const data = await fetchJson('/api/auth/reset-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, password: authForm.password }) }, 20000); writeToken(data.token); writeResetToken(''); setUser(data.user); setAuthOpen(false); setResetToken(''); setAuthForm({ name: '', email: '', password: '' }); window.history.replaceState({}, '', window.location.pathname); return; }";
if (!source.includes(newSubmit)) {
  if (!source.includes(oldSubmit)) throw new Error('[auth-reset] submitAuth anchor not found');
  source = source.replace(oldSubmit, newSubmit);
}

const oldResetEffect = "useEffect(() => { const params = new URLSearchParams(window.location.search); const token = params.get('reset'); if (!token) return; setResetToken(token); setAuthMode('reset'); setAuthOpen(true); window.history.replaceState({}, '', window.location.pathname); }, []);";
const newResetEffect = "useEffect(() => { const params = new URLSearchParams(window.location.search); const token = params.get('reset') || ''; const stored = readResetToken(); if (!token && !stored) return; const activeToken = token || stored; setResetToken(activeToken); writeResetToken(activeToken); setAuthMode('reset'); setAuthError(''); setAuthNotice(''); setAuthOpen(true); }, []);";
if (!source.includes(newResetEffect)) {
  if (!source.includes(oldResetEffect)) throw new Error('[auth-reset] reset effect anchor not found');
  source = source.replace(oldResetEffect, newResetEffect);
}

const oldResetButton = "<button type=\"submit\" disabled={authBusy}>{authBusy ? 'Working...' : ACTIONS[authMode]}</button>";
const newResetButton = "<button type=\"submit\" disabled={authBusy || (authMode === 'reset' && !authForm.password)}>{authBusy ? 'Working...' : ACTIONS[authMode]}</button>";
if (!source.includes(newResetButton)) {
  if (!source.includes(oldResetButton)) throw new Error('[auth-reset] submit button anchor not found');
  source = source.replace(oldResetButton, newResetButton);
}

const authLogOld = "} catch (err) { setAuthError(err.message || 'That did not work. Try again.'); } finally { setAuthBusy(false); } };";
const authLogNew = "} catch (err) { console.error('[auth] browser auth flow failed:', err); try { await fetch('/api/client-log', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phase: `auth-${authMode}`, name: err?.name || '', message: err?.message || String(err || ''), extra: err?.status ? `status=${err.status}` : '' }) }); } catch {} setAuthError(err.message || 'That did not work. Try again.'); } finally { setAuthBusy(false); } };";
if (!source.includes('browser auth flow failed')) {
  if (!source.includes(authLogOld)) throw new Error('[auth-reset] auth catch anchor not found');
  source = source.replace(authLogOld, authLogNew);
}

fs.writeFileSync(path, source);
console.log('[patch-auth-reset-hardening] reset token persistence, retry-safe reset, and auth diagnostics wired');
