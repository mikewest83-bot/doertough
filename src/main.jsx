import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Mic, Send, Volume2, ArrowRight, Lightbulb, Square } from 'lucide-react';
import './style.css';

const PREVIEW = '/api/avatar-preview';

const fetchJson = async (url, options = {}, timeout = 50000) => {
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
  const [video, setVideo] = useState(null);
  const [previewFailed, setPreviewFailed] = useState(false);
  const [avatarReady, setAvatarReady] = useState(false);
  const [error, setError] = useState('');

  const audioRef = useRef(null);
  const videoRef = useRef(null);
  const previewVideoRef = useRef(null);
  const recognitionRef = useRef(null);
  const avatarJobRef = useRef(0);
  const syncTimerRef = useRef(null);
  const statusRef = useRef('ready');

  const setStatus = (status) => {
    statusRef.current = status;
    setListening(status === 'listening');
    setSpeaking(status === 'talking');
  };

  const clearSync = () => {
    if (syncTimerRef.current) {
      clearInterval(syncTimerRef.current);
      syncTimerRef.current = null;
    }
  };

  const stopMike = () => {
    avatarJobRef.current += 1;
    clearSync();

    if (audioRef.current) {
      try {
        audioRef.current.pause();
        audioRef.current.src = '';
      } catch {}
      audioRef.current = null;
    }

    setStatus('ready');
    setVideo(null);
    setAvatarReady(false);
  };

  const replayPreviewOnce = () => {
    const v = previewVideoRef.current;
    if (!v) return;
    try {
      v.currentTime = 0;
      v.play().catch(() => {});
    } catch {}
  };

  // More reliable avatar polling
  const pollAvatar = async (generationId) => {
    if (!generationId) return;

    const job = ++avatarJobRef.current;
    console.log('[avatar] starting poll for', generationId);

    // Poll for up to ~2 minutes
    for (let i = 0; i < 160; i++) {
      await new Promise((r) => setTimeout(r, 750));

      if (job !== avatarJobRef.current) {
        console.log('[avatar] poll cancelled');
        return;
      }

      try {
        const data = await fetchJson(
          `/api/avatar/${encodeURIComponent(generationId)}`,
          {},
          10000
        );

        if (job !== avatarJobRef.current) return;

        if (data.status === 'completed' && data.videoUrl) {
          console.log('[avatar] ready:', data.videoUrl);
          setVideo(data.videoUrl);
          setAvatarReady(true);
          return;
        }

        if (data.status === 'failed') {
          console.warn('[avatar] generation failed');
          return;
        }
      } catch (err) {
        if (err.name === 'AbortError') return;
        // Keep trying on temporary errors
        console.warn('[avatar] poll temporary error:', err.message);
      }
    }

    console.warn('[avatar] timed out waiting for video');
  };

  const beginVideoSync = () => {
    const v = videoRef.current;
    const a = audioRef.current;
    if (!v || !a) return;

    try {
      if (Number.isFinite(a.currentTime) && Number.isFinite(v.duration) && v.duration > 0) {
        v.currentTime = Math.min(a.currentTime, Math.max(0, v.duration - 0.05));
      }
    } catch {}

    v.play().catch(() => {});

    clearSync();
    syncTimerRef.current = setInterval(() => {
      const vv = videoRef.current;
      const aa = audioRef.current;

      if (!vv || !aa || aa.paused) {
        clearSync();
        return;
      }

      try {
        const drift = aa.currentTime - vv.currentTime;
        if (Math.abs(drift) > 0.18) {
          vv.currentTime = Math.min(
            aa.currentTime,
            Math.max(0, (vv.duration || aa.currentTime) - 0.05)
          );
        }
      } catch {}
    }, 120);
  };

  const speak = async (text) => {
    stopMike();
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
        70000
      );

      // Start lip-sync in background if available
      if (data.generationId) {
        pollAvatar(data.generationId);
      } else {
        console.log('[avatar] no generationId returned — voice only');
      }

      const audio = new Audio(`data:audio/mpeg;base64,${data.audioBase64}`);
      audioRef.current = audio;

      audio.onended = () => {
        clearSync();
        avatarJobRef.current += 1;
        setStatus('ready');
        setVideo(null);
        setAvatarReady(false);
        audioRef.current = null;
      };

      audio.onerror = () => {
        clearSync();
        avatarJobRef.current += 1;
        setStatus('ready');
        setVideo(null);
        setAvatarReady(false);
        audioRef.current = null;
        setError('Mike voice had a problem. Try again.');
      };

      await audio.play();
    } catch (err) {
      if (err.name === 'AbortError') return;

      setStatus('ready');
      setError('Mike voice is unavailable right now. The AI response is still in the conversation.');
      console.error('[speak] failed:', err);
    }
  };

  const ask = async (text) => {
    text = text.trim();
    if (!text || busy) return;

    stopMike();
    setInput('');
    setBusy(true);
    setError('');
    replayPreviewOnce();

    setMessages((prev) => [...prev, { role: 'user', text }]);

    try {
      const data = await fetchJson(
        '/api/ask',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: text,
            history: messages.slice(-10),
          }),
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
    if (busy || speaking) return;

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
      if (e.error !== 'aborted' && e.error !== 'no-speech') {
        setError("I couldn’t hear that. Try again.");
      }
      document.querySelector('#input')?.focus();
    };

    recognition.onend = () => {
      if (statusRef.current === 'listening') {
        setStatus('ready');
      }
    };

    recognition.start();
  };

  // Escape stops everything
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        recognitionRef.current?.abort();
        stopMike();
      }
    };

    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      recognitionRef.current?.abort();
      stopMike();
    };
  }, []);

  // Sync video with audio when lip-sync arrives
  useEffect(() => {
    if (!video) return;

    const v = videoRef.current;
    if (!v) return;

    v.muted = true;
    v.playsInline = true;
    v.load();

    const start = () => beginVideoSync();
    v.addEventListener('loadedmetadata', start);
    v.addEventListener('canplay', start);

    return () => {
      v.removeEventListener('loadedmetadata', start);
      v.removeEventListener('canplay', start);
      clearSync();
    };
  }, [video]);

  const statusText = listening
    ? 'MIKE IS LISTENING'
    : speaking
    ? 'MIKE IS TALKING'
    : busy
    ? 'MIKE IS THINKING'
    : 'MIKE IS HERE';

  return (
    <main>
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
          <div
            className={
              'avatar ' +
              (avatarReady ? 'avatar-ready ' : '') +
              (busy || speaking ? 'responding' : '')
            }
          >
            <video
              ref={previewVideoRef}
              className={video ? 'idle hidden' : 'idle'}
              src={PREVIEW}
              autoPlay
              muted
              playsInline
              preload="auto"
              onLoadedData={() => {
                setPreviewFailed(false);
                if (!video) setAvatarReady(true);
              }}
              onEnded={() => {
                if (!video) setAvatarReady(true);
              }}
              onError={() => setPreviewFailed(true)}
            />

            <video
              ref={videoRef}
              className={video ? 'talking' : 'talking hidden'}
              src={video || undefined}
              autoPlay
              muted
              playsInline
              preload="auto"
              onError={() => {
                setVideo(null);
                setAvatarReady(false);
              }}
            />

            {previewFailed && !video && (
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

          <button
            className={'talk ' + (listening ? 'active' : '')}
            onClick={listen}
            disabled={busy || speaking}
          >
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
          <button
            className="radar"
            onClick={() => ask('What am I missing?')}
            disabled={busy}
          >
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
            if (speaking) {
              stopMike();
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