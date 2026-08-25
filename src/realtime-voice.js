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
  const label = error ? 'MIKE VOICE ERROR' : mode === 'speaking' ? 'MIKE IS TALKING' : mode === 'listening' ? 'MIKE IS LISTENING' : connected ? 'MIKE IS READY' : 'MIKE IS HERE';
  state.textContent = label;
  if (status) status.textContent = `● ${label}`;
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

async function reportFailure(phase, error, context) {
  try {
    await fetch('/api/client-log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phase,
        name: error?.name || typeof error,
        message: error?.message || String(error),
        extra: context ? JSON.stringify(context).slice(0, 1200) : '',
      }),
    });
  } catch {}
}

async function fetchSessionToken() {
  const headers = {};
  try {
    const token = localStorage.getItem('mike_token');
    if (token) headers.Authorization = `Bearer ${token}`;
  } catch {}
  const response = await fetch('/api/speech/token', { cache: 'no-store', headers });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const err = new Error(body.message || body.error || `Could not start Mike realtime voice (${response.status}).`);
    err.code = body.error || `http_${response.status}`;
    err.status = response.status;
    throw err;
  }
  if (!body.token) throw new Error('Mike realtime voice returned no session token.');
  return body.token;
}

function sessionOptions(token) {
  return {
    conversationToken: token,
    connectionType: 'webrtc',
    onConnect: () => {
      connected = true;
      starting = false;
      setVisual('listening');
      console.log('[mike-realtime] WebRTC connected');
    },
    onDisconnect: () => {
      connected = false;
      starting = false;
      conversation = null;
      setVisual('ready');
      console.log('[mike-realtime] disconnected');
    },
    onError: (error, context) => {
      starting = false;
      connected = false;
      console.error('[mike-realtime] SDK error:', error, context);
      reportFailure('sdk_error', error, context);
      // A realtime infrastructure failure is NOT a subscription failure.
      // Never send the customer to the Pro screen merely because WebRTC failed.
      setVisual('ready', `Mike couldn't connect right now. Please try again.`);
    },
    onModeChange: ({ mode }) => setVisual(mode === 'speaking' ? 'speaking' : 'listening'),
    onMessage: (message) => {
      const text = message?.message || message?.text || '';
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

    // Do not open a temporary microphone stream here. ElevenLabs/WebRTC owns
    // microphone capture for the realtime conversation. Requesting and then
    // releasing a second stream can race WebKit's audio device handling.
    const token = await fetchSessionToken();
    conversation = await Conversation.startSession(sessionOptions(token));
  } catch (error) {
    connected = false;
    starting = false;
    console.error('[mike-realtime] start failed:', error);
    reportFailure('start_failed', error);
    const isEntitlementError = error?.code === 'upgrade_required' || error?.code === 'voice_allowance_reached' || error?.status === 402;
    const message = isEntitlementError
      ? (error?.message || 'Start your free trial to talk with Mike.')
      : 'Mike couldn\'t connect right now. Please try again.';
    setVisual('ready', message);
  }
}

async function stopRealtime() {
  starting = false;
  if (conversation) {
    try { await conversation.endSession(); } catch (error) { console.warn('[mike-realtime] end failed:', error); }
  }
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
  box.addEventListener('click', toggleRealtime, true);
  button.addEventListener('click', toggleRealtime, true);
  box.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') toggleRealtime(event);
  }, true);
  window.__MIKE_REALTIME__ = { startRealtime, stopRealtime };
  console.log('[mike-realtime] voice-first WebRTC mode installed');
  return true;
}

const timer = setInterval(() => {
  if (install()) clearInterval(timer);
}, 100);
window.addEventListener('beforeunload', () => { try { conversation?.endSession(); } catch {} });
