import { Conversation } from '@elevenlabs/client';

let conversation = null;
let connected = false;
let starting = false;
let installed = false;

const $ = (selector) => document.querySelector(selector);

function setVisual(mode, error = '') {
  const box = $('.voice-box');
  const state = $('.voice-state strong');
  const hint = $('.voice-hint');
  const status = $('.status');
  if (!box || !state) return;

  box.classList.toggle('is-listening', mode === 'listening');
  box.classList.toggle('is-speaking', mode === 'speaking');
  state.textContent = error ? 'MIKE VOICE ERROR' : mode === 'speaking' ? 'MIKE IS TALKING' : mode === 'listening' ? 'MIKE IS LISTENING' : connected ? 'MIKE IS READY' : 'MIKE IS HERE';
  if (status) status.textContent = `● ${error ? 'MIKE VOICE ERROR' : mode === 'speaking' ? 'MIKE IS TALKING' : mode === 'listening' ? 'MIKE IS LISTENING' : connected ? 'MIKE IS READY' : 'MIKE IS HERE'}`;
  if (hint) hint.textContent = error || (mode === 'speaking' ? 'Mike is talking.' : mode === 'listening' ? 'Go ahead. Mike is listening.' : connected ? 'Talk naturally. Mike will listen and respond.' : 'Tap here or the button below to talk with Mike.');
}

function addBubble(role, text) {
  const chat = $('.chat');
  if (!chat || !text) return;
  const bubble = document.createElement('div');
  bubble.className = `bubble ${role}`;
  bubble.textContent = text;
  chat.appendChild(bubble);
  chat.scrollTop = chat.scrollHeight;
}

// Ships a failure to the server so it shows up in the deploy log. The realtime
// session breaks in the browser, on the leg to ElevenLabs' LiveKit host, which
// the server otherwise never sees. Best-effort: never let reporting throw.
async function reportFailure(phase, error) {
  try {
    const extraKeys = ['reason', 'code', 'status', 'context', 'detail', 'cause', 'stack'];
    const extra = {};
    for (const key of extraKeys) {
      const value = error?.[key];
      if (value === undefined || value === null) continue;
      extra[key] = typeof value === 'object' ? JSON.stringify(value).slice(0, 300) : String(value).slice(0, 300);
    }
    await fetch('/api/client-log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phase,
        name: error?.name || typeof error,
        message: error?.message || String(error),
        extra: JSON.stringify(extra),
      }),
    });
  } catch {
    // reporting is diagnostic only
  }
}

// The session token is single-use in practice: a failed room join burns it, so
// each connection attempt fetches its own.
async function fetchSessionToken() {
  const tokenResponse = await fetch('/api/speech/token', {
    cache: 'no-store',
    headers: (() => {
      try {
        const token = localStorage.getItem('mike_token');
        return token ? { Authorization: `Bearer ${token}` } : {};
      } catch {
        return {};
      }
    })(),
  });

  if (!tokenResponse.ok) {
    const body = await tokenResponse.json().catch(() => ({}));
    throw new Error(body.error || `Could not start Mike realtime voice (${tokenResponse.status}).`);
  }

  const { token } = await tokenResponse.json();
  if (!token) throw new Error('Mike realtime voice returned no session token.');
  return token;
}

function sessionOptions(token, iceTransportPolicy) {
  return {
    conversationToken: token,
    connectionType: 'webrtc',
    // "relay" forces the audio through TURN (TCP/443) instead of direct UDP.
    // Networks that drop UDP flows — home routers with strict firewalls, some
    // VPNs, guest wifi — fail the default path with an empty connection error.
    ...(iceTransportPolicy ? { webRtc: { iceTransportPolicy } } : {}),
    onConnect: () => {
      connected = true;
      starting = false;
      setVisual('listening');
      console.log(`[mike-realtime] WebRTC connected${iceTransportPolicy === 'relay' ? ' (TURN relay)' : ''}`);
    },
    onDisconnect: () => {
      connected = false;
      starting = false;
      conversation = null;
      setVisual('ready');
      console.log('[mike-realtime] disconnected');
    },
    onError: (error) => {
      starting = false;
      connected = false;
      console.error('[mike-realtime] SDK error:', error);
      reportFailure('sdk_error', error);
      setVisual('ready', `Mike voice connection failed: ${error?.message || 'unknown realtime error'}`);
    },
    onModeChange: ({ mode }) => setVisual(mode === 'speaking' ? 'speaking' : 'listening'),
    onMessage: (message) => {
      if (!message) return;
      const text = message.message || message.text || '';
      if (!text) return;
      if (message.source === 'user') addBubble('user', text);
      if (message.source === 'ai') addBubble('mike', text);
    },
  };
}

async function startRealtime() {
  if (starting || connected) return;
  starting = true;
  setVisual('listening');

  try {
    if (!window.isSecureContext) throw new Error('Mike voice requires a secure HTTPS connection.');
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser does not support microphone access.');

    // Keep the microphone permission request inside the user's click gesture.
    await navigator.mediaDevices.getUserMedia({ audio: true, video: false });

    // The WebRTC conversation token already identifies the Speech Engine.
    // Do not also pass agentId; keeping the session token as the sole
    // connection credential avoids mixing agent and Speech Engine identifiers.
    try {
      conversation = await Conversation.startSession(sessionOptions(await fetchSessionToken()));
    } catch (directError) {
      // A blocked UDP path surfaces here as a bare connection failure before
      // the session exists. Retry once over TURN before giving up.
      console.warn('[mike-realtime] direct connection failed, retrying over TURN relay:', directError);
      reportFailure('webrtc_direct', directError);
      setVisual('listening');
      starting = true;
      conversation = await Conversation.startSession(sessionOptions(await fetchSessionToken(), 'relay'));
    }
  } catch (error) {
    connected = false;
    starting = false;
    console.error('[mike-realtime] start failed:', error);
    reportFailure('start_failed', error);
    setVisual('ready', error?.message || 'Mike voice could not start.');
  }
}

async function stopRealtime() {
  starting = false;
  if (!conversation) return;
  try { await conversation.endSession(); } catch (error) { console.warn('[mike-realtime] end failed:', error); }
  conversation = null;
  connected = false;
  setVisual('ready');
}

async function toggleRealtime(event) {
  event.preventDefault();
  event.stopPropagation();
  if (connected || conversation) await stopRealtime();
  else await startRealtime();
}

function install() {
  if (installed) return true;
  const box = $('.voice-box');
  const button = $('.voice-talk');
  if (!box || !button) return false;

  installed = true;

  // Capture before React's click handlers so the legacy SpeechRecognition/MP3
  // path cannot run at the same time as the realtime WebRTC session.
  box.addEventListener('click', toggleRealtime, true);
  button.addEventListener('click', toggleRealtime, true);
  box.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') toggleRealtime(event);
  }, true);

  button.textContent = 'Talk to Mike';
  window.__MIKE_REALTIME__ = { startRealtime, stopRealtime };
  console.log('[mike-realtime] voice-first WebRTC mode installed');
  return true;
}

const timer = setInterval(() => {
  if (install()) clearInterval(timer);
}, 100);

window.addEventListener('beforeunload', () => { try { conversation?.endSession(); } catch {} });
