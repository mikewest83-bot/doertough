import React, { useEffect, useRef, useState } from 'react';
import { Mic, Send, Volume2, ArrowRight, Lightbulb, Square } from 'lucide-react';
import { createRoot } from 'react-dom/client';
import './style.css';

const SILENCE = 'data:audio/mp3;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4LjEwMAAAAAAAAAAAAAAA//tUxAADB8AhSmxhIIEVCSiJrDCQBTcu3UrAIwUdkRgQbFAZC1CQEwTJ9mjRvBA4UOLD8nKVOWfh+UlK3z/177OXrfOdKl7pyn3Xf//WreyTRUoAWgBgkOAGbZHBgG1OF6zM82DWbZaUmMBptgQhGjsyYqc9ae9XFz280948NMBWInljyzsNRFLPWdnZGWrddDsjK1unuSrVN9jJsK8KuQtQCtMBjCEtImISdNKJOopIpBFpNSMbIHCSRpRR5iakjTiyzLhchUUBwCgyKiweBv/7UsQbg8it7f8AAAAI3JOR1nAAAOAgAAg0AKQANEmZgAA7CAA=';

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
  const [error, setError] = useState('');
  const audioElRef = useRef(null);
  const recognitionRef = useRef(null);
  const audioContextRef = useRef(null);
  const sourceRef = useRef(null);
  const audioUrlRef = useRef(null);
  const speakJobRef = useRef(0);
  const statusRef = useRef('ready');

  const setStatus = (status) => {
    statusRef.current = status;
    setListening(status === 'listening');
    setSpeaking(status === 'talking');
  };

  // iPhone/Safari: create and resume the Web Audio context during the user's
  // tap. The context can then play audio that arrives later after /api/tts.
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

  const speak = async (text) => {
    stopSpeaking();
    const job = ++speakJobRef.current;
    setStatus('talking');
    setError('');
    try {
      const data = await fetchJson('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      }, 60000);
      if (job !== speakJobRef.current) return;
      if (!data.audioBase64) throw new Error('Mike returned no audio.');

      // Prefer Web Audio because Safari does not reliably allow a new HTMLAudio
      // element to autoplay after an async network request. The AudioContext was
      // resumed during the user's microphone/send tap, so this remains permitted.
      const ctx = unlockAudio();
      if (ctx) {
        const raw = atob(data.audioBase64);
        const bytes = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
        const buffer = await ctx.decodeAudioData(bytes.buffer.slice(0));
        if (job !== speakJobRef.current) return;
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(ctx.destination);
        sourceRef.current = source;
        source.onended = () => {
          if (job === speakJobRef.current) {
            sourceRef.current = null;
            setStatus('ready');
          }
        };
        if (ctx.state !== 'running') await ctx.resume();
        source.start(0);
        return;
      }

      // Desktop/native fallback.
      const raw = atob(data.audioBase64);
      const bytes = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
      const blob = new Blob([bytes], { type: data.mimeType || 'audio/mpeg' });
      clearAudioUrl();
      audioUrlRef.current = URL.createObjectURL(blob);
      const el = audioElRef.current;
      if (!el) throw new Error('audio_element_missing');
      el.src = audioUrlRef.current;
      el.onended = () => { if (job === speakJobRef.current) { clearAudioUrl(); setStatus('ready'); } };
      el.onerror = () => { if (job === speakJobRef.current) { clearAudioUrl(); setStatus('ready'); setError('Mike generated audio, but this browser could not play it. Tap the speaker button.'); } };
      await el.play();
    } catch (err) {
      if (err.name === 'AbortError' || job !== speakJobRef.current) return;
      setStatus('ready');
      const message = String(err.message || 'Mike voice is unavailable right now.');
      setError(message.length > 240 ? `${message.slice(0, 240)}…` : message);
      console.error('[speak] failed:', err);
    }
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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, history }),
      }, 55000);
      setMessages((prev) => [...prev, { role: 'mike', text: data.text }]);
      setBusy(false);
      await speak(data.text);
    } catch (err) {
      const msg = err.name === 'AbortError' ? 'Mike is taking too long to respond. Try that again.' : err.message || 'Mike AI is unavailable right now.';
      setError(msg);
      setMessages((prev) => [...prev, { role: 'mike', text: msg }]);
      setBusy(false);
    }
  };

  const listen = () => {
    unlockAudio();
    stopSpeaking();
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) { document.querySelector('#input')?.focus(); return; }
    recognitionRef.current?.abort();
    const recognition = new SpeechRecognition();
    recognitionRef.current = recognition;
    recognition.lang = 'en-US';
    recognition.interimResults = false;
    recognition.continuous = false;
    setError('');
    setStatus('listening');
    recognition.onresult = (e) => { setStatus('ready'); ask(e.results[0][0].transcript); };
    recognition.onerror = (e) => {
      setStatus('ready');
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') setError('Mic permission is blocked. Allow microphone access, or type below.');
      else if (e.error !== 'aborted' && e.error !== 'no-speech') setError("I couldn't hear that. Try again.");
      document.querySelector('#input')?.focus();
    };
    recognition.onend = () => { if (statusRef.current === 'listening') setStatus('ready'); };
    recognition.start();
  };

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') { recognitionRef.current?.abort(); stopSpeaking(); } };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); recognitionRef.current?.abort(); stopSpeaking(); try { audioContextRef.current?.close(); } catch {} };
  }, []);

  const statusText = listening ? 'MIKE IS LISTENING' : speaking ? 'MIKE IS TALKING' : busy ? 'MIKE IS THINKING' : 'MIKE IS HERE';

  return (
    <main>
      <audio ref={audioElRef} playsInline preload="auto" />
      <header>
        <div className="brand"><b>M</b><div><strong>MIKE AI</strong><small>DOER TOUGH</small></div></div>
        <span className="status">● {statusText}</span>
      </header>
      <section className="voice-hero">
        <div className={'voice-box ' + (listening ? 'is-listening' : speaking ? 'is-speaking' : '')}>
          <div className="voice-orb" aria-hidden="true"><span className="orb-core">M</span></div>
          <div className="voice-state"><span className="state-dot" /><strong>{statusText}</strong></div>
          <div className="wave" aria-hidden="true">{Array.from({ length: 17 }, (_, i) => <i key={i} style={{ '--delay': `${i * 55}ms`, '--height': `${18 + ((i * 17) % 44)}px` }} />)}</div>
          <p className="voice-hint">{listening ? 'Go ahead. Mike is listening.' : speaking ? 'Mike is talking.' : busy ? 'Give Mike a second.' : 'Talk it out. Think it through. Make the move.'}</p>
        </div>
        <div className="copy">
          <label>YOUR EVERYDAY COPILOT</label>
          <h1>Meet Mike.<br /><span>Just talk.</span></h1>
          <p>No avatar. No gimmicks. Just Mike. Talk it out, think it through, find the deal, make the move. Mike helps you research, plan, negotiate, write, buy, sell, and figure out what to do next.</p>
          <button className={'talk ' + (listening ? 'active' : '')} onClick={listen} disabled={busy}>{listening ? <><Mic size={18} /> Listening…</> : <><Mic size={18} /> Talk to Mike <ArrowRight size={16} /></>}</button>
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
