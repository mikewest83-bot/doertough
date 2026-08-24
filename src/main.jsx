import React, { useEffect, useRef, useState } from 'react';
import { Mic, Send, Volume2, ArrowRight, Lightbulb, Square, User, LogOut, X } from 'lucide-react';
import { createRoot } from 'react-dom/client';
import './style.css';

const SILENCE = 'data:audio/mp3;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4LjEwMAAAAAAAAAAAAAAA//tUxAADB8AhSmxhIIEVCSiJrDCQBTcu3UrAIwUdkRgQbFAZC1CQEwTJ9mjRvBA4UOLD8nKVOWfh+UlK3z/177OXrfOdKl7pynX3f//WreyTRUoAWgBgkOAGbZHBgG1OF6zM82DWbZaUmMBptgQhGjsyYqc9ae9XFz280948NMBWInljyzsNRFLPWdnZGWrddDsjK1unuSrVN9jJsK8KuQtQCtMBjCEtImISdNKJOopIpBFpNSMbIHCSRpRR5iakjTiyzLhchUUBwCgyKiweBv/7UsQbg8it7f8AAAAI3JOR1nAAAOAgAAg0AKQANEmZgAA7CAA=';

const TOKEN_KEY = 'mike_token';

const readToken = () => {
  try {
    return localStorage.getItem(TOKEN_KEY) || '';
  } catch {
    return '';
  }
};

const writeToken = (token) => {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // private browsing - the session simply won't survive a reload
  }
};

// Attaches the bearer token when signed in. Anonymous calls still work;
// Mike is public and only answers with more when he knows who you are.
const authHeaders = () => {
  const token = readToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
};

const fetchJson = async (url, options = {}, timeout = 60000) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `request_failed_${res.status}`);
    return data;
  } finally {
    clearTimeout(timer);
  }
};

function App() {
  const [messages, setMessages] = useState([{ role: 'mike', text: "What's up? I'm Mike. Tell me what you're trying to figure out. We'll figure it out." }]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [listening, setListening] = useState(false);
  const [conversationMode, setConversationMode] = useState(false);
  const [error, setError] = useState('');
  const [user, setUser] = useState(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState('login');
  const [authForm, setAuthForm] = useState({ name: '', email: '', password: '' });
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState('');
  const [accountsOn, setAccountsOn] = useState(false);
  const audioElRef = useRef(null);
  const recognitionRef = useRef(null);
  const audioContextRef = useRef(null);
  const sourceRef = useRef(null);
  const audioUrlRef = useRef(null);
  const speakJobRef = useRef(0);
  const statusRef = useRef('ready');
  const conversationModeRef = useRef(false);

  const setConversation = (enabled) => {
    conversationModeRef.current = enabled;
    setConversationMode(enabled);
  };

  const setStatus = (status) => {
    statusRef.current = status;
    setListening(status === 'listening');
    setSpeaking(status === 'talking');
  };

  const unlockAudio = () => {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      if (!audioContextRef.current) audioContextRef.current = new Ctx();
      const ctx = audioContextRef.current;
      if (ctx.state !== 'running') ctx.resume().catch(() => {});
      return ctx;
    } catch {
      return null;
    }
  };

  const ensureMicPermission = async () => {
    if (!window.isSecureContext) throw new Error('Microphone requires a secure HTTPS connection.');
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser does not provide microphone access. Use Safari or Chrome.');
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      return true;
    } catch (err) {
      if (err?.name === 'NotAllowedError' || err?.name === 'SecurityError') {
        throw new Error('Safari is blocking microphone access for Mike. Set Microphone to Allow for doertoughmikeai.com, then reopen the site.');
      }
      if (err?.name === 'NotFoundError') throw new Error('No microphone was found on this device.');
      if (err?.name === 'NotReadableError') throw new Error('The microphone is busy or unavailable. Close other apps using the microphone and try again.');
      throw new Error(`Microphone access failed: ${err?.name || 'unknown_error'}.`);
    } finally {
      stream?.getTracks().forEach((track) => track.stop());
    }
  };

  const clearAudioUrl = () => {
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
    }
  };

  const stopSpeaking = () => {
    speakJobRef.current += 1;
    try { sourceRef.current?.stop(); } catch {}
    sourceRef.current = null;
    const el = audioElRef.current;
    if (el) { try { el.pause(); el.removeAttribute('src'); el.load(); } catch {} }
    clearAudioUrl();
    if (statusRef.current === 'talking') setStatus('ready');
  };

  const startListening = async () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      document.querySelector('#input')?.focus();
      setError('Voice input is not supported by this browser. Type below to talk with Mike.');
      return;
    }

    unlockAudio();
    setError('');
    try {
      await ensureMicPermission();
    } catch (err) {
      setStatus('ready');
      setConversation(false);
      setError(err.message || 'Microphone access failed.');
      return;
    }

    recognitionRef.current?.abort();
    const recognition = new SpeechRecognition();
    recognitionRef.current = recognition;
    recognition.lang = 'en-US';
    recognition.interimResults = false;
    recognition.continuous = false;
    setStatus('listening');

    recognition.onresult = (e) => {
      setStatus('ready');
      ask(e.results[0][0].transcript);
    };
    recognition.onerror = (e) => {
      setStatus('ready');
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        setConversation(false);
        setError('Safari granted microphone access, but its speech-recognition service rejected the request. Try Safari again or type below.');
      } else if (e.error === 'audio-capture') {
        setError('Mike could not capture the microphone. Check that no other app is using it.');
      } else if (e.error !== 'aborted' && e.error !== 'no-speech') {
        setError(`Mike could not hear that (${e.error}). Try again.`);
      }
    };
    recognition.onend = () => {
      if (statusRef.current === 'listening') setStatus('ready');
    };
    try {
      recognition.start();
    } catch (err) {
      setStatus('ready');
      if (err.name !== 'InvalidStateError') setError('Mike could not start listening. Try again.');
    }
  };

  const toggleConversation = () => {
    unlockAudio();
    if (conversationModeRef.current) {
      setConversation(false);
      recognitionRef.current?.abort();
      stopSpeaking();
      setStatus('ready');
      return;
    }
    setConversation(true);
    stopSpeaking();
    startListening();
  };

  const speak = async (text) => {
    stopSpeaking();
    const job = ++speakJobRef.current;
    setStatus('talking');
    setError('');
    try {
      const data = await fetchJson('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ text }),
      }, 60000);
      if (job !== speakJobRef.current) return;
      if (!data.audioBase64) throw new Error('Mike returned no audio.');

      // Prefer the native HTML audio element. It handles MP3 decoding and
      // playback more reliably across Safari/iOS/Chrome than Web Audio's
      // decodeAudioData path. The browser's play() promise tells us whether
      // playback actually started, so failures are surfaced instead of being
      // silently swallowed.
      const raw = atob(data.audioBase64);
      const bytes = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
      const blob = new Blob([bytes], { type: data.mimeType || 'audio/mpeg' });
      clearAudioUrl();
      audioUrlRef.current = URL.createObjectURL(blob);
      const el = audioElRef.current;
      if (!el) throw new Error('audio_element_missing');
      el.volume = 1;
      el.src = audioUrlRef.current;
      el.load();

      await new Promise((resolve, reject) => {
        let settled = false;
        const cleanup = () => {
          el.onended = null;
          el.onerror = null;
          el.onabort = null;
        };
        const finish = (fn, value) => {
          if (settled) return;
          settled = true;
          cleanup();
          fn(value);
        };
        el.onended = () => finish(resolve);
        el.onerror = () => finish(reject, new Error('Mike generated audio, but this browser could not play it.'));
        el.onabort = () => finish(reject, new Error('Mike audio playback was interrupted.'));
        el.play().then(() => {
          // Playback has actually started. Keep the pulsing voice state active
          // until the native player fires ended.
        }).catch((err) => finish(reject, err));
      });

      if (job === speakJobRef.current) setStatus('ready');
      clearAudioUrl();
    } catch (err) {
      if (err.name === 'AbortError' || job !== speakJobRef.current) return;
      setStatus('ready');
      const message = String(err.message || 'Mike voice is unavailable right now.');
      setError(message.length > 240 ? `${message.slice(0, 240)}…` : message);
      console.error('[speak] failed:', err);
    }
  };

  const submitAuth = async (e) => {
    e?.preventDefault?.();
    if (authBusy) return;
    setAuthBusy(true);
    setAuthError('');
    const path = authMode === 'login' ? '/api/auth/login' : '/api/auth/register';
    const body =
      authMode === 'login'
        ? { email: authForm.email, password: authForm.password }
        : authForm;
    try {
      const data = await fetchJson(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }, 20000);
      writeToken(data.token);
      setUser(data.user);
      setAuthOpen(false);
      setAuthForm({ name: '', email: '', password: '' });
    } catch (err) {
      setAuthError(err.message || 'That did not work. Try again.');
    } finally {
      setAuthBusy(false);
    }
  };

  const signOut = () => {
    writeToken('');
    setUser(null);
    setMessages([{ role: 'mike', text: "Signed out. I'm still here if you want to talk." }]);
  };

  const ask = async (raw) => {
    const text = (raw || '').trim();
    if (!text || busy) return;
    unlockAudio();
    stopSpeaking();
    setInput('');
    setBusy(true);
    setError('');
    const history = messages.slice(-10);
    setMessages((prev) => [...prev, { role: 'user', text }]);
    try {
      const data = await fetchJson('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ message: text, history }),
      }, 55000);
      setMessages((prev) => [...prev, { role: 'mike', text: data.text }]);
      setBusy(false);
      await speak(data.text);
      if (conversationModeRef.current) {
        setTimeout(() => {
          if (conversationModeRef.current && !busy) startListening();
        }, 120);
      }
    } catch (err) {
      const msg = err.name === 'AbortError' ? 'Mike is taking too long to respond. Try that again.' : err.message || 'Mike AI is unavailable right now.';
      setError(msg);
      setMessages((prev) => [...prev, { role: 'mike', text: msg }]);
      setBusy(false);
      if (conversationModeRef.current) setTimeout(() => conversationModeRef.current && startListening(), 250);
    }
  };

  // Restore the session on load, and find out whether this server has
  // accounts turned on at all.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const health = await fetchJson('/api/health', {}, 10000);
        if (!cancelled) setAccountsOn(!!health.accountsConfigured);
      } catch {
        // health is best-effort; the sign-in button just stays hidden
      }
      if (!readToken()) return;
      try {
        const data = await fetchJson('/api/auth/me', { headers: authHeaders() }, 10000);
        if (!cancelled) setUser(data.user);
      } catch {
        writeToken('');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') { setConversation(false); recognitionRef.current?.abort(); stopSpeaking(); } };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      recognitionRef.current?.abort();
      stopSpeaking();
      try { audioContextRef.current?.close(); } catch {}
    };
  }, []);

  const statusText = listening ? 'MIKE IS LISTENING' : speaking ? 'MIKE IS TALKING' : busy ? 'MIKE IS THINKING' : 'MIKE IS HERE';

  return (
    <main>
      <audio ref={audioElRef} playsInline preload="auto" />
      <header>
        <div className="brand"><b>M</b><div><strong>MIKE AI</strong><small>DOER TOUGH</small></div></div>
        <div className="header-right">
          <span className="status">● {statusText}</span>
          {accountsOn && (user ? (
            <button className="auth-btn" onClick={signOut} title={user.email}>
              <LogOut size={15} /> {user.name.split(' ')[0]}
            </button>
          ) : (
            <button className="auth-btn" onClick={() => { setAuthError(''); setAuthOpen(true); }}>
              <User size={15} /> Sign in
            </button>
          ))}
        </div>
      </header>

      {authOpen && (
        <div className="auth-overlay" role="dialog" aria-modal="true" onClick={(e) => { if (e.target === e.currentTarget) setAuthOpen(false); }}>
          <div className="auth-card">
            <button className="auth-close" onClick={() => setAuthOpen(false)} aria-label="Close"><X size={18} /></button>
            <h2>{authMode === 'login' ? 'Welcome back' : 'Make an account'}</h2>
            <p className="auth-sub">
              {authMode === 'login'
                ? 'Sign in and Mike picks up where you left off.'
                : 'So Mike remembers you and your conversations stay yours.'}
            </p>
            <form onSubmit={submitAuth} className="auth-form">
              {authMode === 'register' && (
                <input
                  placeholder="Your name"
                  value={authForm.name}
                  autoComplete="name"
                  onChange={(e) => setAuthForm({ ...authForm, name: e.target.value })}
                />
              )}
              <input
                type="email"
                placeholder="Email"
                value={authForm.email}
                autoComplete="email"
                onChange={(e) => setAuthForm({ ...authForm, email: e.target.value })}
              />
              <input
                type="password"
                placeholder={authMode === 'login' ? 'Password' : 'Password (8+ characters)'}
                value={authForm.password}
                autoComplete={authMode === 'login' ? 'current-password' : 'new-password'}
                onChange={(e) => setAuthForm({ ...authForm, password: e.target.value })}
              />
              {authError && <div className="auth-error">{authError}</div>}
              <button type="submit" disabled={authBusy}>
                {authBusy ? 'Working...' : authMode === 'login' ? 'Sign in' : 'Create account'}
              </button>
            </form>
            <button
              className="auth-switch"
              onClick={() => { setAuthMode(authMode === 'login' ? 'register' : 'login'); setAuthError(''); }}
            >
              {authMode === 'login' ? "No account yet? Make one." : 'Already have an account? Sign in.'}
            </button>
          </div>
        </div>
      )}

      <section className="voice-hero">
        <div className={'voice-box ' + (listening ? 'is-listening' : speaking ? 'is-speaking' : '')} onClick={toggleConversation} role="button" tabIndex={0} aria-label={conversationMode ? 'Stop talking with Mike' : 'Start talking with Mike'} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') toggleConversation(); }}>
          <div className="voice-orb" aria-hidden="true"><span className="orb-core">M</span></div>
          <div className="voice-state"><span className="state-dot" /><strong>{statusText}</strong></div>
          <div className="wave" aria-hidden="true">{Array.from({ length: 17 }, (_, i) => <i key={i} style={{ '--delay': `${i * 55}ms`, '--height': `${18 + ((i * 17) % 44)}px` }} />)}</div>
          <p className="voice-hint">{conversationMode ? (listening ? 'Go ahead. Mike is listening.' : speaking ? 'Mike is talking.' : 'Conversation mode is on.') : 'Tap here or the button below to talk with Mike.'}</p>
        </div>

        <button className={'talk voice-talk ' + (conversationMode ? 'active' : '')} onClick={toggleConversation} disabled={busy && !conversationMode}>
          <Mic size={18} /> {conversationMode ? 'Stop Talking' : 'Talk to Mike'} <ArrowRight size={16} />
        </button>

        <div className="copy">
          <label>YOUR EVERYDAY COPILOT</label>
          <h1>Meet Mike.<br /><span>Just talk.</span></h1>
          <p>No avatar. No gimmicks. Just Mike. Talk it out, think it through, find the deal, make the move. Mike helps you research, plan, negotiate, write, buy, sell, and figure out what to do next.</p>
          <button className="radar" onClick={() => ask('What am I missing?')} disabled={busy}><Lightbulb size={17} /> What am I missing?</button>
        </div>
      </section>

      <section className="chat" aria-live="polite">{messages.map((m, i) => <div key={i} className={'bubble ' + m.role}>{m.text}</div>)}{busy && <div className="bubble mike">Give me a second. I'm thinking…</div>}</section>
      {error && <div className="error" role="alert">{error}</div>}

      <form onSubmit={(e) => { e.preventDefault(); ask(input); }}>
        <input id="input" value={input} onChange={(e) => setInput(e.target.value)} placeholder="What's on your mind?" autoComplete="off" />
        <button disabled={!input.trim() || busy} aria-label="Send"><Send size={18} /></button>
        <button type="button" className="read" aria-label={speaking ? 'Stop Mike' : 'Read latest response'} onClick={() => { unlockAudio(); if (speaking) stopSpeaking(); else { const last = messages.at(-1); if (last?.role === 'mike') speak(last.text); } }}>{speaking ? <Square size={17} /> : <Volume2 size={18} />}</button>
      </form>
      <p className="fine">Mike is a Doer Tough AI copilot. Current facts and changing information should be verified before important decisions.</p>
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);