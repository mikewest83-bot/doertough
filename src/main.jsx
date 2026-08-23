import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Mic, Send, Volume2, ArrowRight, Lightbulb, Square } from 'lucide-react';
import './style.css';

const PREVIEW = '/api/avatar-preview';

// 50ms of silence. Played on the first tap to unlock audio on iOS, where a
// play() call that isn't inside a user gesture is rejected.
const SILENCE =
  'data:audio/mp3;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA//tUxAADB8AhSmxhIIEVCSiJrDCQBTcu3UrAIwUdkRgQbFAZC1CQEwTJ9mjRvBA4UOLD8nKVOWfh+UlK3z/177OXrfOdKl7pyn3Xf//WreyTRUoAWgBgkOAGbZHBgG1OF6zM82DWbZaUmMBptgQhGjsyYqc9ae9XFz280948NMBWInljyzsNRFLPWdnZGWrddDsjK1unuSrVN9jJsK8KuQtQCtMBjCEtImISdNKJOopIpBFpNSMbIHCSRpRR5iakjTiyzLhchUUBwCgyKiweBv/7UsQbg8it7f8AAAAI3JOR1nAAAOAgAAg0AKQANEmZgAA7CAA=';

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
  const [messages, setMessages] = useState([
    {
      role: 'mike',
      text: "What's up? I'm Mike. Tell me what you're trying to figure out. We'll figure it out.",
    },
  ]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [listening, setListening] = useState(false);
  const [previewFailed, setPreviewFailed] = useState(false);
  const [error, setError] = useState('');

  const audioElRef = useRef(null);
  const previewVideoRef = useRef(null);
  const recognitionRef = useRef(null);
  const unlockedRef = useRef(false);
  const speakJobRef = useRef(0);
  const statusRef = useRef('ready');

  const setStatus = (status) => {
    statusRef.current = status;
    setListening(status === 'listening');
    setSpeaking(status === 'talking');
  };

  // iOS only allows audio that started inside a user gesture. Priming the one
  // persistent <audio> element on first tap keeps every later play() legal,
  // even though it happens after an await.
  const unlockAudio = () => {
    if (unlockedRef.current) return;
    const el = audioElRef.current;
    if (!el) return;
    el.src = SILENCE;
    el.play()
      .then(() => {
        el.pause();
        el.currentTime = 0;
        unlockedRef.current = true;
      })
      .catch(() => {});
  };

  const stopSpeaking = () => {
    speakJobRef.current += 1;
    const el = audioElRef.current;
    if (el) {
      try {
        el.pause();
        el.removeAttribute('src');
        el.load();
      } catch {}
    }
    if (statusRef.current === 'talking') setStatus('ready');
  };

  const replayPreviewOnce = () => {
    const v = previewVideoRef.current;
    if (!v) return;
    try {
      v.currentTime = 0;
      v.play().catch(() => {});
    } catch {}
  };

  const speak = async (text) => {
    stopSpeaking();
    const job = ++speakJobRef.current;
    setStatus('talking');
    setError('');
    replayPreviewOnce();

    try {
      const data = await fetchJson(
        '/api/tts',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text }),
        },
        60000
      );

      if (job !== speakJobRef.current) return; // superseded or stopped

      const el = audioElRef.current;
      if (!el) throw new Error('audio_element_missing');

      el.src = `data:${data.mimeType || 'audio/mpeg'};base64,${data.audioBase64}`;

      el.onended = () => {
        if (job === speakJobRef.current) setStatus('ready');
      };
      el.onerror = () => {
        if (job !== speakJobRef.current) return;
        setStatus('ready');
        setError('Mike voice had a problem playing. Try again.');
      };

      await el.play();
    } catch (err) {
      if (err.name === 'AbortError' || job !== speakJobRef.current) return;
      setStatus('ready');

      if (err.name === 'NotAllowedError') {
        setError('Tap the speaker button to let Mike talk — your browser blocked autoplay.');
      } else {
        setError('Mike voice is unavailable right now. His answer is still in the conversation.');
      }
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
    replayPreviewOnce();

    const history = messages.slice(-10);
    setMessages((prev) => [...prev, { role: 'user', text }]);

    try {
      const data = await fetchJson(
        '/api/ask',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: text, history }),
        },
        55000
      );

      setMessages((prev) => [...prev, { role: 'mike', text: data.text }]);
      setBusy(false);
      await speak(data.text);
    } catch (err) {
      const msg =
        err.name === 'AbortError'
          ? 'Mike is taking too long to respond. Try that again.'
          : err.message || 'Mike AI is unavailable right now.';
      setError(msg);
      setMessages((prev) => [...prev, { role: 'mike', text: msg }]);
      setBusy(false);
    }
  };

  const listen = () => {
    unlockAudio();
    stopSpeaking(); // barge-in: tapping the mic cuts Mike off

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      document.querySelector('#input')?.focus();
      return;
    }

    recognitionRef.current?.abort();
    const recognition = new SpeechRecognition();
    recognitionRef.current = recognition;

    recognition.lang = 'en-US';
    recognition.interimResults = false;
    recognition.continuous = false;

    setError('');
    setStatus('listening');

    recognition.onresult = (e) => {
      setStatus('ready');
      ask(e.results[0][0].transcript);
    };

    recognition.onerror = (e) => {
      setStatus('ready');
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        setError('Mic permission is blocked. Allow microphone access, or just type below.');
      } else if (e.error !== 'aborted' && e.error !== 'no-speech') {
        setError("I couldn't hear that. Try again.");
      }
      document.querySelector('#input')?.focus();
    };

    recognition.onend = () => {
      if (statusRef.current === 'listening') setStatus('ready');
    };

    recognition.start();
  };

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        recognitionRef.current?.abort();
        stopSpeaking();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      recognitionRef.current?.abort();
      stopSpeaking();
    };
  }, []);

  const statusText = listening
    ? 'MIKE IS LISTENING'
    : speaking
    ? 'MIKE IS TALKING'
    : busy
    ? 'MIKE IS THINKING'
    : 'MIKE IS HERE';

  return (
    <main>
      <audio ref={audioElRef} playsInline preload="auto" />

      <header>
        <div className="brand">
          <b>M</b>
          <div>
            <strong>MIKE AI</strong>
            <small>DOER TOUGH</small>
          </div>
        </div>
        <span className="status">● {statusText}</span>
      </header>

      <section className="hero">
        <div>
          <div className={'avatar avatar-ready ' + (busy || speaking ? 'responding' : '')}>
            <video
              ref={previewVideoRef}
              className="idle"
              src={PREVIEW}
              autoPlay
              muted
              loop
              playsInline
              preload="auto"
              onLoadedData={() => setPreviewFailed(false)}
              onError={() => setPreviewFailed(true)}
            />

            {previewFailed && (
              <div className="avatar-fallback">
                <span>M</span>
                <small>Mike AI</small>
              </div>
            )}

            <div className="response-badge">
              {busy ? 'THINKING…' : speaking ? 'RESPONDING' : ''}
            </div>
            <div className="halo" />
          </div>

          <button className={'talk ' + (listening ? 'active' : '')} onClick={listen} disabled={busy}>
            {listening ? (
              <>
                <Mic size={18} /> Listening…
              </>
            ) : (
              <>
                <Mic size={18} /> Talk to Mike <ArrowRight size={16} />
              </>
            )}
          </button>
        </div>

        <div className="copy">
          <label>YOUR EVERYDAY COPILOT</label>
          <h1>
            Meet Mike.
            <br />
            <span>Your everyday copilot.</span>
          </h1>
          <p>
            Talk it out. Think it through. Find the deal. Make the move. Mike helps you research,
            plan, negotiate, write, buy, sell, and figure out what to do next.
          </p>
          <button className="radar" onClick={() => ask('What am I missing?')} disabled={busy}>
            <Lightbulb size={17} /> What am I missing?
          </button>
        </div>
      </section>

      <section className="chat" aria-live="polite">
        {messages.map((m, i) => (
          <div key={i} className={'bubble ' + m.role}>
            {m.text}
          </div>
        ))}
        {busy && <div className="bubble mike">Give me a second. I'm thinking…</div>}
      </section>

      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          ask(input);
        }}
      >
        <input
          id="input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="What's on your mind?"
          autoComplete="off"
        />
        <button disabled={!input.trim() || busy} aria-label="Send">
          <Send size={18} />
        </button>
        <button
          type="button"
          className="read"
          aria-label={speaking ? 'Stop Mike' : 'Read latest response'}
          onClick={() => {
            unlockAudio();
            if (speaking) {
              stopSpeaking();
            } else {
              const last = messages.at(-1);
              if (last?.role === 'mike') speak(last.text);
            }
          }}
        >
          {speaking ? <Square size={17} /> : <Volume2 size={18} />}
        </button>
      </form>

      <p className="fine">
        Mike is a Doer Tough AI copilot. Current facts and changing information should be verified
        before important decisions.
      </p>
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);
