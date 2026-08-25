import { Conversation } from '@elevenlabs/client';

let conversation = null;
let connected = false;
let starting = false;
let installed = false;

// Minute accounting. The server charges a full session up front and settles
// down to the real duration when we report it back. Report and we release the
// unused minutes; stay silent and the caller keeps the worst-case charge.
let sessionKey = null;
let sessionStartedAt = 0;
let maxSessionSeconds = 600;
let settling = false;
const $ = (selector) => document.querySelector(selector);

function setVisual(mode, error = '') {
  const box = $('.voice-box'); const state = $('.voice-state strong'); const hint = $('.voice-hint'); const status = $('.status');
  if (!box || !state) return;
  box.classList.toggle('is-listening', mode === 'listening'); box.classList.toggle('is-speaking', mode === 'speaking');
  const label = error ? 'MIKE VOICE ERROR' : mode === 'speaking' ? 'MIKE IS TALKING' : mode === 'listening' ? 'MIKE IS LISTENING' : connected ? 'MIKE IS READY' : 'MIKE IS HERE';
  state.textContent = label; if (status) status.textContent = `● ${label}`;
  if (hint) hint.textContent = error || (mode === 'speaking' ? 'Mike is talking.' : mode === 'listening' ? 'Go ahead. Mike is listening.' : connected ? 'Talk naturally. Mike will listen and respond.' : 'Tap here or the button below to talk with Mike.');
}
function addBubble(role, text) { const chat=$('.chat'); if(!chat||!text)return; const bubble=document.createElement('div'); bubble.className=`bubble ${role}`; bubble.textContent=text; chat.appendChild(bubble); chat.scrollTop=chat.scrollHeight; }
function safeSerialize(value) { try { return JSON.stringify(value, (key, val) => { if (typeof val === 'function') return '[function]'; if (val instanceof Error) return { name: val.name, message: val.message, stack: val.stack, ...val }; return val; }).slice(0, 6000); } catch { return String(value); } }
async function reportFailure(phase, error, context) {
  const detail = { phase, name: error?.name || typeof error, message: error?.message || String(error), code: error?.code || '', status: error?.status || '', stack: error?.stack || '', errorObject: safeSerialize(error), context: safeSerialize(context), connectionType: 'webrtc', href: location.href, online: navigator.onLine, ua: navigator.userAgent };
  console.error('[mike-realtime][DIAGNOSTIC]', detail);
  try { await fetch('/api/client-log', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ phase, name:detail.name, message:detail.message, extra:safeSerialize(detail) }) }); } catch {}
}
function authHeaders(extra = {}) {
  const headers = { ...extra };
  try { const token = localStorage.getItem('mike_token'); if (token) headers.Authorization = `Bearer ${token}`; } catch {}
  return headers;
}

async function fetchSessionToken() {
  const response=await fetch('/api/speech/token',{cache:'no-store',headers:authHeaders()}); const body=await response.json().catch(()=>({}));
  if(!response.ok){const err=new Error(body.message||body.error||`Could not start Mike realtime voice (${response.status}).`);err.code=body.error||`http_${response.status}`;err.status=response.status;throw err;}
  if(!body.token)throw new Error('Mike realtime voice returned no session token.');
  // The server hands back the key that identifies this reservation.
  sessionKey = body.sessionKey || null;
  if (Number(body.maxSessionSeconds) > 0) maxSessionSeconds = Number(body.maxSessionSeconds);
  sessionStartedAt = Date.now();
  return body.token;
}

// Report the real duration so the reservation can be released. Safe to call
// more than once - the flag stops a double report, and the server refuses a
// second settle for the same key anyway. `keepalive` lets this survive the
// page being closed mid-call, which sendBeacon could not do because it cannot
// carry the Authorization header.
async function settleSession() {
  if (!sessionKey || settling) return;
  settling = true;
  const key = sessionKey;
  const seconds = sessionStartedAt
    ? Math.min(Math.round((Date.now() - sessionStartedAt) / 1000), maxSessionSeconds)
    : maxSessionSeconds;
  sessionKey = null;
  sessionStartedAt = 0;
  try {
    await fetch('/api/speech/session-end', {
      method: 'POST',
      keepalive: true,
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ sessionKey: key, seconds }),
    });
    console.log(`[mike-realtime] session settled at ${seconds}s`);
  } catch (error) {
    // Nothing to recover here - an unsettled session just keeps its full
    // reservation, which is the safe direction.
    console.warn('[mike-realtime] settle failed:', error);
  } finally {
    settling = false;
  }
}
function sessionOptions(token) {
  return {
    conversationToken: token,
    connectionType: 'webrtc',
    webRtc: { iceTransportPolicy: 'relay' },
    onConnect:()=>{connected=true;starting=false;setVisual('listening');console.log('[mike-realtime] WebRTC connected');},
    onDisconnect:(details)=>{connected=false;starting=false;conversation=null;console.log('[mike-realtime] disconnected',details);settleSession();reportFailure('disconnect',new Error('WebRTC session disconnected'),details);setVisual('ready');},
    onError:(error,context)=>{starting=false;connected=false;console.error('[mike-realtime][SDK ERROR]',error,context);reportFailure('sdk_error',error,context);setVisual('ready','Mike couldn\'t connect right now. Please try again.');},
    onModeChange:({mode})=>setVisual(mode==='speaking'?'speaking':'listening'),
    onMessage:(message)=>{const text=message?.message||message?.text||'';if(!text)return;if(message.source==='user')addBubble('user',text);if(message.source==='ai')addBubble('mike',text);}
  };
}
async function startRealtime(){
  if(starting||connected)return; starting=true; setVisual('listening');
  try {
    if(!window.isSecureContext)throw new Error('Mike voice requires a secure HTTPS connection.');
    if(!navigator.mediaDevices?.getUserMedia)throw new Error('This browser does not support microphone access.');
    const permissionStream = await navigator.mediaDevices.getUserMedia({audio:true});
    permissionStream.getTracks().forEach((track)=>track.stop());
    const token=await fetchSessionToken();
    console.log('[mike-realtime][DIAGNOSTIC] token received; starting WebRTC session with TURN relay');
    conversation=await Conversation.startSession(sessionOptions(token));
  }
  catch(error){connected=false;starting=false;
    // A token was minted but the call never connected - settle at 0s so the
    // reservation is released instead of charging a full session for nothing.
    if(sessionKey)await settleSession();
    console.error('[mike-realtime] start failed:',error);await reportFailure('start_failed',error);const entitlement=error?.code==='upgrade_required'||error?.code==='voice_allowance_reached'||error?.status===402;setVisual('ready',entitlement?(error?.message||'Start your free trial to talk with Mike.'):'Mike couldn\'t connect right now. Please try again.');}
}
async function stopRealtime(){starting=false;if(conversation){try{await conversation.endSession();}catch(error){console.warn('[mike-realtime] end failed:',error);}}conversation=null;connected=false;await settleSession();setVisual('ready');}
async function toggleRealtime(event){event.preventDefault();event.stopPropagation();if(connected||conversation)await stopRealtime();else await startRealtime();}
function install(){if(installed)return true;const box=$('.voice-box');const button=$('.voice-talk');if(!box||!button)return false;installed=true;box.addEventListener('click',toggleRealtime,true);button.addEventListener('click',toggleRealtime,true);box.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' ')toggleRealtime(event)},true);window.__MIKE_REALTIME__={startRealtime,stopRealtime};console.log('[mike-realtime] diagnostic WebRTC mode installed');return true;}
const timer=setInterval(()=>{if(install())clearInterval(timer)},100);window.addEventListener('beforeunload',()=>{try{conversation?.endSession();}catch{}settleSession();});
// beforeunload does not fire reliably on mobile Safari when the tab is
// backgrounded and then discarded; pagehide does.
window.addEventListener('pagehide',()=>{settleSession();});
