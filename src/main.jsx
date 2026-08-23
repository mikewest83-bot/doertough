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
  const [conversationMode, setConversationMode] = useState(false);
  const [error, setError] = useState('');
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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      }, 60000);
      if (job !== speakJobRef.current) return;
      if (!data.audioBase64) throw new Error('Mike returned no audio.');

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
          if (job === speakJobRef.current) sourceRef.current = null;
        };
        if (ctx.state !== 'running') await ctx.resume();
        source.start(0);
        const durationMs = Math.max(250, buffer.duration * 1000);
        await new Promise((resolve) => setTimeout(resolve, durationMs));
        if (job === speakJobRef.current) setStatus('ready');
        return;
      }

      const raw = atob(data.audioBase64);
      const bytes = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
      const blob = new Blob([bytes], { type: data.mimeType || 'audio/mpeg' });
      clearAudioUrl();
      audioUrlRef.current = URL.createObjectURL(blob);
      const el = audioElRef.current;
      if (!el) throw new Error('audio_element_missing');
      el.src = audioUrlRef.current;
      await new Promise((resolve, reject) => {
        el.onended = resolve;
        el.onerror = () => reject(new Error('Mike generated audio, but this browser could not play it.'));
        el.play().catch(reject);
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
        <span className="status">● {statusText}</span>
      </header>

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
