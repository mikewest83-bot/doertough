import React, { useEffect, useRef, useState } from 'react';
import { Mic, Send, ArrowRight, User, LogOut, X } from 'lucide-react';
import { createRoot } from 'react-dom/client';
import MikeVision from './MikeVision.jsx';
import './style.css';

const TOKEN_KEY = 'mike_token';
const readToken = () => { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; } };
const writeToken = (token) => { try { if (token) localStorage.setItem(TOKEN_KEY, token); else localStorage.removeItem(TOKEN_KEY); } catch {} };
const authHeaders = () => { const token = readToken(); return token ? { Authorization: `Bearer ${token}` } : {}; };
const fetchJson = async (url, options = {}, timeout = 60000) => { const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeout); try { const res = await fetch(url, { ...options, signal: controller.signal }); const data = await res.json().catch(() => ({})); if (!res.ok) { const err = new Error(data.error || `request_failed_${res.status}`); err.status = res.status; throw err; } return data; } finally { clearTimeout(timer); } };

function waitForIceComplete(pc, timeout = 8000) {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => { if (settled) return; settled = true; pc.removeEventListener('icegatheringstatechange', check); clearTimeout(timer); resolve(); };
    const check = () => { if (pc.iceGatheringState === 'complete') finish(); };
    const timer = setTimeout(finish, timeout);
    pc.addEventListener('icegatheringstatechange', check);
  });
}

function App() {
  const [messages, setMessages] = useState([{ role: 'mike', text: "What's up? I'm Mike. Tell me what you're trying to figure out. We'll figure it out." }]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [conversationMode, setConversationMode] = useState(false);
  const [error, setError] = useState('');
  const [user, setUser] = useState(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState('login');
  const [authForm, setAuthForm] = useState({ name: '', email: '', password: '' });
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState('');
  const [authNotice, setAuthNotice] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [accountsOn, setAccountsOn] = useState(false);

  const conversationRef = useRef(null);
  const conversationModeRef = useRef(false);
  const statusRef = useRef('ready');
  const voiceTransitionRef = useRef(false);
  const voiceSessionRef = useRef(null);

  const setConversation = (enabled) => { conversationModeRef.current = enabled; setConversationMode(enabled); };
  const setStatus = (status) => { statusRef.current = status; setListening(status === 'listening'); setSpeaking(status === 'talking'); };
  const logClientError = async (phase, err) => { console.error(`[voice] ${phase}:`, err); try { await fetch('/api/client-log', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phase, name: err?.name || '', message: err?.message || String(err || ''), extra: err?.stack || '' }) }); } catch {} };
  const settleVoiceSession = () => { const session = voiceSessionRef.current; voiceSessionRef.current = null; if (!session?.key) return; const seconds = Math.min(Math.round((Date.now() - session.startedAt) / 1000), session.maxSeconds); try { fetch('/api/speech/session-end', { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify({ sessionKey: session.key, seconds }) }).catch(() => {}); } catch {} };

  const stopRealtimeConversation = async () => {
    const active = conversationRef.current;
    conversationRef.current = null;
    if (active) {
      try { active.dataChannel?.close(); } catch {}
      try { active.localStream?.getTracks().forEach((track) => track.stop()); } catch {}
      try { active.audio?.pause(); active.audio.srcObject = null; } catch {}
      try { active.pc?.close(); } catch {}
    }
    settleVoiceSession();
    setConversation(false);
    setStatus('ready');
  };

  const startRealtimeConversation = async () => {
    if (voiceTransitionRef.current) return;
    voiceTransitionRef.current = true;
    try {
      if (!readToken()) {
        setAuthMode('login');
        setAuthError('Sign in to talk with Mike. Your account includes voice access.');
        setAuthOpen(true);
        setConversation(false);
        return;
      }
      setError('');
      setStatus('listening');
      if (!window.RTCPeerConnection || !navigator.mediaDevices?.getUserMedia) throw new Error('This browser does not provide realtime microphone access.');

      const tokenData = await fetchJson('/api/speech/token', { headers: authHeaders() }, 30000);
      if (!tokenData.token) throw new Error('Mike did not return a realtime voice token.');
      voiceSessionRef.current = { key: tokenData.sessionKey || null, maxSeconds: Number(tokenData.maxSessionSeconds) || 600, startedAt: Date.now() };

      const pc = new RTCPeerConnection();
      const audio = new Audio();
      audio.autoplay = true;
      audio.playsInline = true;
      pc.ontrack = (event) => {
        const stream = event.streams?.[0];
        if (stream) audio.srcObject = stream;
        audio.play().catch(() => {});
      };

      const localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));

      const dataChannel = pc.createDataChannel('oai-events');
      dataChannel.onopen = () => { setConversation(true); setStatus('listening'); setError(''); };
      dataChannel.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          if (message.type === 'input_audio_buffer.speech_started') setStatus('listening');
          else if (message.type === 'response.created') setStatus('talking');
          else if (message.type === 'response.audio.delta') setStatus('talking');
          else if (message.type === 'response.audio.done' || message.type === 'response.done') setStatus('listening');
          else if (message.type === 'conversation.item.input_audio_transcription.completed') {
            const text = String(message.transcript || '').trim();
            if (text) setMessages((prev) => [...prev, { role: 'user', text }]);
          } else if (message.type === 'response.audio_transcript.done') {
            const text = String(message.transcript || '').trim();
            if (text) setMessages((prev) => [...prev, { role: 'mike', text }]);
          } else if (message.type === 'error') {
            const detail = message.error?.message || 'Realtime voice connection error.';
            console.error('[voice] realtime server error:', message);
            setError(detail);
          }
        } catch (err) {
          console.warn('[voice] ignored realtime event:', err);
        }
      };
      dataChannel.onerror = (event) => { console.error('[voice] data channel error:', event); };
      dataChannel.onclose = () => { if (conversationRef.current?.dataChannel === dataChannel) setStatus('ready'); };

      pc.onconnectionstatechange = () => {
        const state = pc.connectionState;
        if (state === 'connected') { setConversation(true); setStatus('listening'); setError(''); }
        else if (state === 'failed') { setError('Mike lost the realtime voice connection. Tap Talk to Mike and try again.'); setConversation(false); setStatus('ready'); }
        else if (state === 'disconnected' || state === 'closed') { setConversation(false); setStatus('ready'); }
      };

      const offer = await pc.createOffer({ offerToReceiveAudio: true });
      await pc.setLocalDescription(offer);
      await waitForIceComplete(pc);

      const form = new FormData();
      form.append('sdp', new Blob([pc.localDescription.sdp], { type: 'application/sdp' }));
      const answerResponse = await fetch('https://api.openai.com/v1/realtime/calls', {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokenData.token}` },
        body: form,
      });
      const answer = await answerResponse.text();
      if (!answerResponse.ok) throw new Error(`OpenAI realtime call failed (${answerResponse.status}): ${answer.slice(0, 500)}`);
      await pc.setRemoteDescription({ type: 'answer', sdp: answer });

      conversationRef.current = { pc, dataChannel, localStream, audio };
      setConversation(true);
      setStatus('listening');
    } catch (err) {
      await logClientError('realtime-start', err);
      const active = conversationRef.current;
      conversationRef.current = null;
      try { active?.dataChannel?.close(); } catch {}
      try { active?.localStream?.getTracks().forEach((track) => track.stop()); } catch {}
      try { active?.pc?.close(); } catch {}
      settleVoiceSession();
      setConversation(false);
      setStatus('ready');
      if (err?.status === 401 || String(err?.message || '').includes('sign_in_required')) {
        setAuthMode('login');
        setAuthError('Sign in to talk with Mike.');
        setAuthOpen(true);
      } else if (err?.status === 402 || String(err?.message || '').includes('upgrade_required') || String(err?.message || '').includes('voice_allowance_reached')) {
        setError('Your available Mike voice time has been used. Try again when your voice access resets.');
      } else if (err?.status === 503) {
        setError('Mike voice is temporarily at capacity. Try again in a moment.');
      } else {
        setError(err?.message || 'Mike could not start the realtime voice connection. Check microphone access and try again.');
      }
    } finally {
      voiceTransitionRef.current = false;
    }
  };

  const toggleConversation = async () => { if (voiceTransitionRef.current) return; if (conversationModeRef.current || conversationRef.current) { voiceTransitionRef.current = true; try { await stopRealtimeConversation(); } finally { voiceTransitionRef.current = false; } } else await startRealtimeConversation(); };

  const ask = async (raw) => {
    const text = (raw || '').trim();
    if (!text || busy || conversationModeRef.current || conversationRef.current) return;
    setInput(''); setBusy(true); setError('');
    const history = messages.slice(-10);
    setMessages((prev) => [...prev, { role: 'user', text }]);
    try {
      const data = await fetchJson('/api/ask', { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify({ message: text, history }) }, 55000);
      setMessages((prev) => [...prev, { role: 'mike', text: data.text }]);
      setBusy(false);
    } catch (err) {
      const msg = err.name === 'AbortError' ? 'Mike is taking too long to respond. Try that again.' : err.message || 'Mike AI is unavailable right now.';
      setError(msg); setMessages((prev) => [...prev, { role: 'mike', text: msg }]); setBusy(false);
    }
  };

  const askVision = async (dataUrl) => {
    if (busy || conversationModeRef.current || conversationRef.current) return;
    setBusy(true); setError('');
    const history = messages.slice(-10);
    setMessages((prev) => [...prev, { role: 'user', text: '📷 I showed Mike an image.' }]);
    try {
      const data = await fetchJson('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ message: 'Take a look at this and help me understand what I am looking at.', image: { dataUrl, mediaType: 'image/jpeg' }, history }),
      }, 60000);
      setMessages((prev) => [...prev, { role: 'mike', text: data.text }]);
    } catch (err) {
      const msg = err.name === 'AbortError' ? 'Mike took too long to analyze that image. Try again.' : err.message || 'Mike could not analyze that image.';
      setError(msg);
      setMessages((prev) => [...prev, { role: 'mike', text: msg }]);
    } finally {
      setBusy(false);
    }
  };

  const switchAuthMode = (mode) => { setAuthMode(mode); setAuthError(''); setAuthNotice(''); };
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
        writeToken(data.token); setUser(data.user); setAuthOpen(false); setResetToken(''); setAuthForm({ name: '', email: '', password: '' }); return;
      }
      const path = authMode === 'login' ? '/api/auth/login' : '/api/auth/register';
      const body = authMode === 'login' ? { email: authForm.email, password: authForm.password } : authForm;
      const data = await fetchJson(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, 20000);
      writeToken(data.token); setUser(data.user); setAuthOpen(false); setAuthForm({ name: '', email: '', password: '' });
    } catch (err) {
      setAuthError(err.message || 'That did not work. Try again.');
    } finally {
      setAuthBusy(false);
    }
  };

  const signOut = async () => { await stopRealtimeConversation(); writeToken(''); setUser(null); setMessages([{ role: 'mike', text: "Signed out. I'm still here if you want to talk." }]); };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try { const health = await fetchJson('/api/health', {}, 10000); if (!cancelled) setAccountsOn(!!health.accountsConfigured); } catch {}
      if (!readToken()) return;
      try { const data = await fetchJson('/api/auth/me', { headers: authHeaders() }, 10000); if (!cancelled) setUser(data.user); } catch { writeToken(''); }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('reset');
    if (!token) return;
    setResetToken(token);
    setAuthMode('reset');
    setAuthOpen(true);
    window.history.replaceState({}, '', window.location.pathname);
  }, []);

  useEffect(() => { const onUnload = () => settleVoiceSession(); window.addEventListener('beforeunload', onUnload); window.addEventListener('pagehide', onUnload); return () => { window.removeEventListener('beforeunload', onUnload); window.removeEventListener('pagehide', onUnload); }; }, []);
  useEffect(() => () => { stopRealtimeConversation(); }, []);

  const statusText = listening ? 'MIKE IS LISTENING' : speaking ? 'MIKE IS TALKING' : busy ? 'MIKE IS THINKING' : 'MIKE IS HERE';
  const voiceControlLabel = conversationMode ? 'END CONVERSATION' : 'TAP TO TALK';

  return (
    <main>
      <header>
        <div className="brand"><b className="brand-dt"><span>D</span><em>T</em></b><div><strong>MIKE AI</strong><small>DOER TOUGH</small></div></div>
        <div className="header-right">
          <span className="status">● {statusText}</span>
          {accountsOn && (user ? (<button className="auth-btn" onClick={signOut} title={user.email}><LogOut size={15} /> {user.name.split(' ')[0]}</button>) : (<button className="auth-btn" onClick={() => { setAuthError(''); setAuthOpen(true); }}><User size={15} /> Sign in</button>))}
        </div>
      </header>

      {authOpen && (() => {
        const TITLES = { login: 'Welcome back', register: 'Make an account', forgot: 'Reset your password', reset: 'Choose a new password' };
        const SUBS = { login: 'Sign in and Mike picks up where you left off.', register: 'So Mike remembers you and your conversations stay yours.', forgot: "Put in your email and we'll send you a link to set a new password.", reset: 'Pick something you have not used elsewhere. This signs you out everywhere else.' };
        const ACTIONS = { login: 'Sign in', register: 'Create account', forgot: 'Send reset link', reset: 'Set new password' };
        const showName = authMode === 'register';
        const showEmail = authMode !== 'reset';
        const showPassword = authMode !== 'forgot';
        return (<div className="auth-overlay" role="dialog" aria-modal="true" onClick={(e) => { if (e.target === e.currentTarget) setAuthOpen(false); }}><div className="auth-card"><button className="auth-close" onClick={() => setAuthOpen(false)} aria-label="Close"><X size={18} /></button><h2>{TITLES[authMode]}</h2><p className="auth-sub">{SUBS[authMode]}</p><form onSubmit={submitAuth} className="auth-form">{showName && (<input placeholder="Your name" value={authForm.name} autoComplete="name" onChange={(e) => setAuthForm({ ...authForm, name: e.target.value })} />)}{showEmail && (<input type="email" placeholder="Email" value={authForm.email} autoComplete="email" onChange={(e) => setAuthForm({ ...authForm, email: e.target.value })} />)}{showPassword && (<input type="password" placeholder={authMode === 'login' ? 'Password' : 'Password (8+ characters)'} value={authForm.password} autoComplete={authMode === 'login' ? 'current-password' : 'new-password'} onChange={(e) => setAuthForm({ ...authForm, password: e.target.value })} />)}{authError && <div className="auth-error">{authError}</div>}{authNotice && <div className="auth-sub" style={{ margin: 0 }}>{authNotice}</div>}<button type="submit" disabled={authBusy}>{authBusy ? 'Working...' : ACTIONS[authMode]}</button></form>{authMode === 'login' && (<button className="auth-switch" onClick={() => switchAuthMode('forgot')}>Forgot your password?</button>)}<button className="auth-switch" onClick={() => switchAuthMode(authMode === 'register' ? 'login' : authMode === 'login' ? 'register' : 'login')}>{authMode === 'login' ? "No account yet? Make one." : authMode === 'register' ? 'Already have an account? Sign in.' : 'Back to sign in'}</button></div></div>);
      })()}

      <section className="voice-hero">
        <div className="copy">
          <label>YOUR EVERYDAY DOER</label>
          <h1>Talk to Mike.<br /><span>Get a straight answer.</span></h1>
          <p>Voice or text, any hour. Price a job, plan your week, talk through a call you have to make, work out what a used truck is really worth. Mike answers like somebody who has done the work — not like a manual.</p>
          <ul className="trust-row"><li>Voice + text</li><li>Cancel anytime</li><li>Mike is here</li></ul>
          <div className="try-row"><span className="try-label">Try him right now</span><div className="try-chips">{['How much concrete for a 20x24 slab at 4 inches?','Quote a 3-day framing job at $65 an hour.','What am I missing?'].map((prompt) => (<button key={prompt} type="button" className="try-chip" onClick={() => ask(prompt)} disabled={busy || conversationMode}>{prompt}</button>))}</div></div>
        </div>
        <div className={'voice-box ' + (listening ? 'is-listening' : speaking ? 'is-speaking' : '')} onClick={toggleConversation} role="button" tabIndex={0} aria-label={conversationMode ? 'Stop talking with Mike' : 'Start talking with Mike'} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') toggleConversation(); }}>
          <div className="voice-orb" aria-hidden="true"><span className="orb-core"><span>D</span><em>T</em></span></div>
          <div className="voice-state"><span className="state-dot" /><strong>{statusText}</strong></div>
          <div className="wave" aria-hidden="true">{Array.from({ length: 17 }, (_, i) => <i key={i} style={{ '--delay': `${i * 55}ms`, '--height': `${18 + ((i * 17) % 44)}px` }} />)}</div>
          <p className="voice-hint">{conversationMode ? (listening ? 'Go ahead. Mike is listening.' : speaking ? 'Mike is talking.' : 'Conversation mode is on.') : 'Tap the mic below when you are ready.'}</p>
          <button className={'voice-puck ' + (conversationMode ? 'active' : '')} onClick={(e) => { e.stopPropagation(); toggleConversation(); }} disabled={voiceTransitionRef.current || busy}><span className="voice-puck-icon"><Mic size={23} strokeWidth={2.3} /></span><span className="voice-puck-copy"><strong>{voiceControlLabel}</strong><small>{conversationMode ? 'Mike is connected' : 'Press and start talking'}</small></span><ArrowRight className="voice-puck-arrow" size={18} /></button>
        </div>
      </section>

      <section className="chat" aria-live="polite">{messages.map((m, i) => <div key={i} className={'bubble ' + m.role}>{m.text}</div>)}{busy && <div className="bubble mike">Give me a second. I'm thinking…</div>}</section>
      {error && <div className="error" role="alert">{error}</div>}
      <form onSubmit={(e) => { e.preventDefault(); ask(input); }}><input id="input" value={input} onChange={(e) => setInput(e.target.value)} placeholder="What's on your mind?" autoComplete="off" disabled={conversationMode} /><MikeVision disabled={conversationMode} busy={busy} onCapture={askVision} /><button disabled={!input.trim() || busy || conversationMode} aria-label="Send"><Send size={18} /></button></form>
      <p className="fine">Mike is a Doer Tough AI assistant. Current facts and changing information should be verified before important decisions.</p>
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);
