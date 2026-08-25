import React, { useEffect, useRef, useState } from 'react';
import { Conversation } from '@elevenlabs/client';
import { Mic, Send, Volume2, ArrowRight, Lightbulb, Square, User, LogOut, X } from 'lucide-react';
import { createRoot } from 'react-dom/client';
import './style.css';

const TOKEN_KEY = 'mike_token';
const readToken = () => { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; } };
const writeToken = (token) => { try { if (token) localStorage.setItem(TOKEN_KEY, token); else localStorage.removeItem(TOKEN_KEY); } catch {} };
const authHeaders = () => { const token = readToken(); return token ? { Authorization: `Bearer ${token}` } : {}; };
const fetchJson = async (url, options = {}, timeout = 60000) => { const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeout); try { const res = await fetch(url, { ...options, signal: controller.signal }); const data = await res.json().catch(() => ({})); if (!res.ok) { const err = new Error(data.error || `request_failed_${res.status}`); err.status = res.status; throw err; } return data; } finally { clearTimeout(timer); } };

function App() {
  const [messages, setMessages] = useState([{ role: 'mike', text: "What's up? I'm Mike. Tell me what you're trying to figure out. We'll figure it out." }]);
  const [input, setInput] = useState(''); const [busy, setBusy] = useState(false); const [speaking, setSpeaking] = useState(false); const [listening, setListening] = useState(false); const [conversationMode, setConversationMode] = useState(false); const [error, setError] = useState(''); const [user, setUser] = useState(null); const [authOpen, setAuthOpen] = useState(false); const [authMode, setAuthMode] = useState('login'); const [authForm, setAuthForm] = useState({ name: '', email: '', password: '' }); const [authBusy, setAuthBusy] = useState(false); const [authError, setAuthError] = useState(''); const [authNotice, setAuthNotice] = useState(''); const [resetToken, setResetToken] = useState(''); const [accountsOn, setAccountsOn] = useState(false);
  const conversationRef = useRef(null); const conversationModeRef = useRef(false); const audioElRef = useRef(null); const audioUrlRef = useRef(null); const speakJobRef = useRef(0); const statusRef = useRef('ready');
  // Voice-minute budget: the server reserves a full session's worth of
  // minutes the instant a token is minted, and only releases the unused
  // part once this sessionKey is reported back on hangup. Without that
  // report every tap - even a two-second one - burns the full reservation
  // and never gives it back.
  const voiceSessionRef = useRef(null);
  const setConversation = (enabled) => { conversationModeRef.current = enabled; setConversationMode(enabled); };
  const setStatus = (status) => { statusRef.current = status; setListening(status === 'listening'); setSpeaking(status === 'talking'); };
  const clearAudioUrl = () => { if (audioUrlRef.current) { try { URL.revokeObjectURL(audioUrlRef.current); } catch {} audioUrlRef.current = null; } };
  const unlockAudio = () => { try { const Ctx = window.AudioContext || window.webkitAudioContext; if (!Ctx) return; const ctx = new Ctx(); if (ctx.state !== 'running') ctx.resume().catch(() => {}); setTimeout(() => ctx.close().catch(() => {}), 500); } catch {} };
  const stopSpeaking = () => { speakJobRef.current += 1; const el = audioElRef.current; if (el) { try { el.pause(); } catch {} } clearAudioUrl(); if (statusRef.current === 'talking') setStatus('ready'); };
  const logClientError = async (phase, err) => { console.error(`[voice] ${phase}:`, err); try { await fetch('/api/client-log', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phase, name: err?.name || '', message: err?.message || String(err || ''), extra: err?.stack || '' }) }); } catch {} };
  // Report the real duration so the server releases the unused part of the
  // reservation. Safe to call more than once - it clears the ref immediately
  // so a second call is a no-op, and the server refuses a second report for
  // the same key regardless. keepalive lets this survive a closed tab.
  const settleVoiceSession = () => {
    const session = voiceSessionRef.current;
    voiceSessionRef.current = null;
    if (!session?.key) return;
    const seconds = Math.min(Math.round((Date.now() - session.startedAt) / 1000), session.maxSeconds);
    try {
      fetch('/api/speech/session-end', {
        method: 'POST',
        keepalive: true,
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ sessionKey: session.key, seconds }),
      }).catch(() => {});
    } catch {}
  };
  const stopRealtimeConversation = async () => { const active = conversationRef.current; conversationRef.current = null; if (active) { try { await active.endSession(); } catch (err) { console.warn('[voice] endSession:', err); } } settleVoiceSession(); setConversation(false); setStatus('ready'); };
  const startRealtimeConversation = async () => {
    if (!readToken()) { setAuthMode('login'); setAuthError('Sign in to talk with Mike. Your account includes the free voice trial.'); setAuthOpen(true); setConversation(false); return; }
    unlockAudio(); setError(''); setStatus('listening');
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser does not provide microphone access.');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      stream.getTracks().forEach((track) => track.stop());
      const tokenData = await fetchJson('/api/speech/token', { headers: authHeaders() }, 30000);
      if (!tokenData.token) throw new Error('Mike did not return a voice conversation token.');
      voiceSessionRef.current = {
        key: tokenData.sessionKey || null,
        maxSeconds: Number(tokenData.maxSessionSeconds) || 600,
        startedAt: Date.now(),
      };
      let session;
      session = await Conversation.startSession({
        conversationToken: tokenData.token,
        connectionType: 'webrtc',
        onConnect: () => { conversationRef.current = session; setConversation(true); setStatus('listening'); setError(''); },
        onDisconnect: () => { if (conversationRef.current === session) conversationRef.current = null; settleVoiceSession(); setConversation(false); setStatus('ready'); },
        onError: (err) => { logClientError('realtime-error', err); setStatus('ready'); setError(err?.message || 'Mike lost the voice connection. Tap Talk to Mike and try again.'); },
        onStatusChange: (status) => { if (status === 'connecting') setStatus('listening'); else if (status === 'connected' && !speaking) setStatus('listening'); else if (status === 'disconnected') setStatus('ready'); },
        onModeChange: ({ mode }) => { if (mode === 'speaking') setStatus('talking'); else if (mode === 'listening') setStatus('listening'); },
        onMessage: (message) => { const text = message?.message || message?.text || message?.content || ''; if (!text || typeof text !== 'string') return; const role = message?.source === 'user' || message?.role === 'user' ? 'user' : 'mike'; setMessages((prev) => [...prev, { role, text }]); },
      });
      conversationRef.current = session; setConversation(true); setStatus('listening');
    } catch (err) {
      // A token may have been minted for a call that never actually
      // connected (mic denied, network drop) - settle it at its real
      // (near-zero) duration rather than leaving the full reservation charged.
      settleVoiceSession();
      await logClientError('realtime-start', err); setConversation(false); setStatus('ready');
      if (err?.status === 401 || String(err?.message || '').includes('sign_in_required')) { setAuthMode('login'); setAuthError('Sign in to talk with Mike.'); setAuthOpen(true); }
      else if (err?.status === 402 || String(err?.message || '').includes('upgrade_required')) setError('Your free voice session has been used. Start the Mike AI free trial to keep talking.');
      else if (err?.status === 503) setError('Mike voice is temporarily at capacity. Try again in a moment.');
      else setError(err?.message || 'Mike could not start the voice connection. Check microphone access and try again.');
    }
  };
  const toggleConversation = async () => { if (conversationModeRef.current || conversationRef.current) await stopRealtimeConversation(); else await startRealtimeConversation(); };
  const speak = async (text) => { stopSpeaking(); const job = ++speakJobRef.current; setStatus('talking'); setError(''); try { const data = await fetchJson('/api/tts', { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify({ text }) }, 60000); if (job !== speakJobRef.current) return; if (!data.audioBase64) throw new Error('Mike returned no audio.'); const binary = atob(data.audioBase64); const bytes = new Uint8Array(binary.length); for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i); clearAudioUrl(); audioUrlRef.current = URL.createObjectURL(new Blob([bytes], { type: data.mimeType || 'audio/mpeg' })); const el = audioElRef.current; if (!el) throw new Error('audio_element_missing'); el.volume = 1; el.src = audioUrlRef.current; await new Promise((resolve, reject) => { let settled = false; const finish = (fn, value) => { if (settled) return; settled = true; el.onended = null; el.onerror = null; el.onabort = null; fn(value); }; el.onended = () => finish(resolve); el.onerror = () => finish(reject, new Error(`Mike generated audio, but the browser could not play it (media error ${el.error?.code || 'unknown'}).`)); el.onabort = () => finish(reject, new Error('Mike audio playback was interrupted.')); Promise.resolve(el.play()).catch((err) => finish(reject, err)); }); clearAudioUrl(); if (job === speakJobRef.current) setStatus('ready'); } catch (err) { if (job !== speakJobRef.current) return; setStatus('ready'); const message = String(err?.message || 'Mike voice is unavailable right now.'); setError(message.length > 240 ? `${message.slice(0, 240)}…` : message); console.error('[speak] failed:', err); } };
  const ask = async (raw) => { const text = (raw || '').trim(); if (!text || busy) return; setInput(''); setBusy(true); setError(''); const history = messages.slice(-10); setMessages((prev) => [...prev, { role: 'user', text }]); try { const data = await fetchJson('/api/ask', { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify({ message: text, history }) }, 55000); setMessages((prev) => [...prev, { role: 'mike', text: data.text }]); setBusy(false); await speak(data.text); } catch (err) { const msg = err.name === 'AbortError' ? 'Mike is taking too long to respond. Try that again.' : err.message || 'Mike AI is unavailable right now.'; setError(msg); setMessages((prev) => [...prev, { role: 'mike', text: msg }]); setBusy(false); } };
  const switchAuthMode = (mode) => { setAuthMode(mode); setAuthError(''); setAuthNotice(''); };

  // One submit handler for four modes. login/register sign you straight in;
  // forgot returns the same reassurance whether or not the address exists, so
  // the UI must not imply an account was found; reset redeems the emailed
  // token and signs in on the new session.
  const submitAuth = async (e) => {
    e?.preventDefault?.();
    if (authBusy) return;
    setAuthBusy(true); setAuthError(''); setAuthNotice('');

    try {
      if (authMode === 'forgot') {
        const data = await fetchJson('/api/auth/forgot-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: authForm.email }) }, 20000);
        setAuthNotice(data.message || 'If that email has an account, a reset link is on its way.');
        return;
      }

      if (authMode === 'reset') {
        const data = await fetchJson('/api/auth/reset-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: resetToken, password: authForm.password }) }, 20000);
        writeToken(data.token); setUser(data.user); setAuthOpen(false); setResetToken('');
        setAuthForm({ name: '', email: '', password: '' });
        return;
      }

      const path = authMode === 'login' ? '/api/auth/login' : '/api/auth/register';
      const body = authMode === 'login' ? { email: authForm.email, password: authForm.password } : authForm;
      const data = await fetchJson(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, 20000);
      writeToken(data.token); setUser(data.user); setAuthOpen(false);
      setAuthForm({ name: '', email: '', password: '' });
    } catch (err) {
      setAuthError(err.message || 'That did not work. Try again.');
    } finally {
      setAuthBusy(false);
    }
  };
  const signOut = async () => { await stopRealtimeConversation(); writeToken(''); setUser(null); setMessages([{ role: 'mike', text: "Signed out. I'm still here if you want to talk." }]); };
  useEffect(() => { let cancelled = false; (async () => { try { const health = await fetchJson('/api/health', {}, 10000); if (!cancelled) setAccountsOn(!!health.accountsConfigured); } catch {} if (!readToken()) return; try { const data = await fetchJson('/api/auth/me', { headers: authHeaders() }, 10000); if (!cancelled) setUser(data.user); } catch { writeToken(''); } })(); return () => { cancelled = true; }; }, []);
  // A password-reset email lands here. Pull the token out of the URL, open
  // the modal straight into reset mode, and strip the parameter so the token
  // is not left sitting in the address bar or in browser history.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('reset');
    if (!token) return;
    window.history.replaceState({}, '', window.location.pathname);
    setResetToken(token);
    setAuthMode('reset'); setAuthError(''); setAuthNotice('');
    setAuthOpen(true);
  }, []);

  useEffect(() => {
    const onUnload = () => settleVoiceSession();
    window.addEventListener('beforeunload', onUnload);
    // beforeunload is unreliable on mobile Safari for a backgrounded tab
    // that gets discarded; pagehide covers that case.
    window.addEventListener('pagehide', onUnload);
    return () => { window.removeEventListener('beforeunload', onUnload); window.removeEventListener('pagehide', onUnload); };
  }, []);
  useEffect(() => () => { stopRealtimeConversation(); stopSpeaking(); }, []);
  const statusText = listening ? 'MIKE IS LISTENING' : speaking ? 'MIKE IS TALKING' : busy ? 'MIKE IS THINKING' : 'MIKE IS HERE';
  const voiceControlLabel = conversationMode ? 'END CONVERSATION' : 'TAP TO TALK';
  return (
    <main>
      <audio ref={audioElRef} playsInline preload="auto" />
      <header><div className="brand"><b className="brand-dt"><span>D</span><em>T</em></b><div><strong>MIKE AI</strong><small>DOER TOUGH</small></div></div><div className="header-right"><span className="status">● {statusText}</span>{accountsOn && (user ? (<button className="auth-btn" onClick={signOut} title={user.email}><LogOut size={15} /> {user.name.split(' ')[0]}</button>) : (<button className="auth-btn" onClick={() => { setAuthError(''); setAuthOpen(true); }}><User size={15} /> Sign in</button>))}</div></header>
      {authOpen && (() => {
        const TITLES = { login: 'Welcome back', register: 'Make an account', forgot: 'Reset your password', reset: 'Choose a new password' };
        const SUBS = {
          login: 'Sign in and Mike picks up where you left off.',
          register: 'So Mike remembers you and your conversations stay yours.',
          forgot: "Put in your email and we'll send you a link to set a new password.",
          reset: 'Pick something you have not used elsewhere. This signs you out everywhere else.',
        };
        const ACTIONS = { login: 'Sign in', register: 'Create account', forgot: 'Send reset link', reset: 'Set new password' };
        const showName = authMode === 'register';
        const showEmail = authMode !== 'reset';
        const showPassword = authMode !== 'forgot';
        return (
        <div className="auth-overlay" role="dialog" aria-modal="true" onClick={(e) => { if (e.target === e.currentTarget) setAuthOpen(false); }}><div className="auth-card"><button className="auth-close" onClick={() => setAuthOpen(false)} aria-label="Close"><X size={18} /></button><h2>{TITLES[authMode]}</h2><p className="auth-sub">{SUBS[authMode]}</p><form onSubmit={submitAuth} className="auth-form">{showName && (<input placeholder="Your name" value={authForm.name} autoComplete="name" onChange={(e) => setAuthForm({ ...authForm, name: e.target.value })} />)}{showEmail && (<input type="email" placeholder="Email" value={authForm.email} autoComplete="email" onChange={(e) => setAuthForm({ ...authForm, email: e.target.value })} />)}{showPassword && (<input type="password" placeholder={authMode === 'login' ? 'Password' : 'Password (8+ characters)'} value={authForm.password} autoComplete={authMode === 'login' ? 'current-password' : 'new-password'} onChange={(e) => setAuthForm({ ...authForm, password: e.target.value })} />)}{authError && <div className="auth-error">{authError}</div>}{authNotice && <div className="auth-sub" style={{ margin: 0 }}>{authNotice}</div>}<button type="submit" disabled={authBusy}>{authBusy ? 'Working...' : ACTIONS[authMode]}</button></form>{authMode === 'login' && (<button className="auth-switch" onClick={() => switchAuthMode('forgot')}>Forgot your password?</button>)}<button className="auth-switch" onClick={() => switchAuthMode(authMode === 'register' ? 'login' : authMode === 'login' ? 'register' : 'login')}>{authMode === 'login' ? "No account yet? Make one." : authMode === 'register' ? 'Already have an account? Sign in.' : 'Back to sign in'}</button></div></div>
        );
      })()}
      <section className="voice-hero"><div className="copy"><label>YOUR EVERYDAY DOER</label><h1>Talk to Mike.<br /><span>Get a straight answer.</span></h1><p>Voice or text, any hour. Price a job, plan your week, talk through a call you have to make, work out what a used truck is really worth. Mike answers like somebody who has done the work — not like a manual.</p><ul className="trust-row"><li>3 days free</li><li>Cancel anytime</li><li>1% to carbon removal</li></ul><button className="radar" onClick={() => ask('What am I missing?')} disabled={busy}><Lightbulb size={17} /> What am I missing?</button></div><div className={'voice-box ' + (listening ? 'is-listening' : speaking ? 'is-speaking' : '')} onClick={toggleConversation} role="button" tabIndex={0} aria-label={conversationMode ? 'Stop talking with Mike' : 'Start talking with Mike'} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') toggleConversation(); }}><div className="voice-orb" aria-hidden="true"><span className="orb-core"><span>D</span><em>T</em></span></div><div className="voice-state"><span className="state-dot" /><strong>{statusText}</strong></div><div className="wave" aria-hidden="true">{Array.from({ length: 17 }, (_, i) => <i key={i} style={{ '--delay': `${i * 55}ms`, '--height': `${18 + ((i * 17) % 44)}px` }} />)}</div><p className="voice-hint">{conversationMode ? (listening ? 'Go ahead. Mike is listening.' : speaking ? 'Mike is talking.' : 'Conversation mode is on.') : 'Tap the mic below when you are ready.'}</p><button className={'voice-puck ' + (conversationMode ? 'active' : '')} onClick={(e) => { e.stopPropagation(); toggleConversation(); }} disabled={busy && !conversationMode} aria-label={voiceControlLabel}><span className="voice-puck-icon"><Mic size={23} strokeWidth={2.3} /></span><span className="voice-puck-copy"><strong>{voiceControlLabel}</strong><small>{conversationMode ? 'Mike is connected' : 'Press and start talking'}</small></span><ArrowRight className="voice-puck-arrow" size={18} /></button></div></section>
      <section className="chat" aria-live="polite">{messages.map((m, i) => <div key={i} className={'bubble ' + m.role}>{m.text}</div>)}{busy && <div className="bubble mike">Give me a second. I'm thinking…</div>}</section>
      {error && <div className="error" role="alert">{error}</div>}
      <form onSubmit={(e) => { e.preventDefault(); ask(input); }}><input id="input" value={input} onChange={(e) => setInput(e.target.value)} placeholder="What's on your mind?" autoComplete="off" /><button disabled={!input.trim() || busy} aria-label="Send"><Send size={18} /></button><button type="button" className="read" aria-label={speaking ? 'Stop Mike' : 'Read latest response'} onClick={() => { if (speaking) stopSpeaking(); else { const last = messages.at(-1); if (last?.role === 'mike') speak(last.text); } }}>{speaking ? <Square size={17} /> : <Volume2 size={18} />}</button></form>
      <p className="fine">Mike is a Doer Tough AI assistant. Current facts and changing information should be verified before important decisions.</p>
    </main>
  );
}
createRoot(document.getElementById('root')).render(<App />);
