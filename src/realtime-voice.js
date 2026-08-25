import { Conversation } from '@elevenlabs/client';

let conversation = null;
let connected = false;
let starting = false;
let installed = false;
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
async function fetchSessionToken() {
  const headers={}; try { const token=localStorage.getItem('mike_token'); if(token) headers.Authorization=`Bearer ${token}`; } catch {}
  const response=await fetch('/api/speech/token',{cache:'no-store',headers}); const body=await response.json().catch(()=>({}));
  if(!response.ok){const err=new Error(body.message||body.error||`Could not start Mike realtime voice (${response.status}).`);err.code=body.error||`http_${response.status}`;err.status=response.status;throw err;}
  if(!body.token)throw new Error('Mike realtime voice returned no session token.');
  return body.token;
}
function sessionOptions(token) {
  return { conversationToken:token, connectionType:'webrtc', onConnect:()=>{connected=true;starting=false;setVisual('listening');console.log('[mike-realtime] WebRTC connected');}, onDisconnect:()=>{connected=false;starting=false;conversation=null;setVisual('ready');console.log('[mike-realtime] disconnected');}, onError:(error,context)=>{starting=false;connected=false;console.error('[mike-realtime][SDK ERROR]',error,context);reportFailure('sdk_error',error,context);setVisual('ready','Mike couldn\'t connect right now. Please try again.');}, onModeChange:({mode})=>setVisual(mode==='speaking'?'speaking':'listening'), onMessage:(message)=>{const text=message?.message||message?.text||'';if(!text)return;if(message.source==='user')addBubble('user',text);if(message.source==='ai')addBubble('mike',text);} };
}
async function startRealtime(){
  if(starting||connected)return; starting=true; setVisual('listening');
  try { if(!window.isSecureContext)throw new Error('Mike voice requires a secure HTTPS connection.'); if(!navigator.mediaDevices?.getUserMedia)throw new Error('This browser does not support microphone access.'); const token=await fetchSessionToken(); console.log('[mike-realtime][DIAGNOSTIC] token received; starting WebRTC session'); conversation=await Conversation.startSession(sessionOptions(token)); }
  catch(error){connected=false;starting=false;console.error('[mike-realtime] start failed:',error);await reportFailure('start_failed',error);const entitlement=error?.code==='upgrade_required'||error?.code==='voice_allowance_reached'||error?.status===402;setVisual('ready',entitlement?(error?.message||'Start your free trial to talk with Mike.'):'Mike couldn\'t connect right now. Please try again.');}
}
async function stopRealtime(){starting=false;if(conversation){try{await conversation.endSession();}catch(error){console.warn('[mike-realtime] end failed:',error);}}conversation=null;connected=false;setVisual('ready');}
async function toggleRealtime(event){event.preventDefault();event.stopPropagation();if(connected||conversation)await stopRealtime();else await startRealtime();}
function install(){if(installed)return true;const box=$('.voice-box');const button=$('.voice-talk');if(!box||!button)return false;installed=true;box.addEventListener('click',toggleRealtime,true);button.addEventListener('click',toggleRealtime,true);box.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' ')toggleRealtime(event)},true);window.__MIKE_REALTIME__={startRealtime,stopRealtime};console.log('[mike-realtime] diagnostic WebRTC mode installed');return true;}
const timer=setInterval(()=>{if(install())clearInterval(timer)},100);window.addEventListener('beforeunload',()=>{try{conversation?.endSession();}catch{}});
