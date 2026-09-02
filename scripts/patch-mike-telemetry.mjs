import fs from 'node:fs';

const mainPath = 'src/main.jsx';
let main = fs.readFileSync(mainPath, 'utf8');

const helperAnchor = "  const [input, setInput] = useState('');\n";
const helper = `  const mikeTelemetry = (event) => {\n    try {\n      const allowed = new Set(['landing_view','prompt_submitted','first_response','second_message','account_created','voice_started','abandoned']);\n      if (!allowed.has(event)) return;\n      void fetch('/api/client-log', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phase: 'telemetry', name: event, message: 'product_event' }) }).catch(() => {});\n    } catch {}\n  };\n`;
const telemetryRef = `  const telemetryRef = useRef({ prompts: 0, responses: 0, accountCreated: false });\n`;

if (!main.includes('const mikeTelemetry = (event) =>')) {
  if (!main.includes(helperAnchor)) throw new Error('[patch-mike-telemetry] state anchor not found');
  main = main.replace(helperAnchor, helperAnchor + helper);
}
if (!main.includes('const telemetryRef = useRef(')) {
  const refAnchor = "  const photoInputRef = useRef(null);\n";
  if (!main.includes(refAnchor)) throw new Error('[patch-mike-telemetry] ref anchor not found');
  main = main.replace(refAnchor, refAnchor + telemetryRef);
}

if (!main.includes("mikeTelemetry('landing_view')")) {
  const pos = main.indexOf("  useEffect(() => {", main.indexOf(helperAnchor));
  if (pos < 0) throw new Error('[patch-mike-telemetry] effect anchor not found');
  main = main.slice(0, pos) + "  useEffect(() => { mikeTelemetry('landing_view'); }, []);\n\n" + main.slice(pos);
}

const askAnchor = "  const ask = async (raw) => { const text = (raw || '').trim();";
if (!main.includes("telemetryRef.current.prompts += 1")) {
  if (!main.includes(askAnchor)) throw new Error('[patch-mike-telemetry] ask anchor not found');
  main = main.replace(askAnchor, askAnchor + "\n    telemetryRef.current.prompts += 1; mikeTelemetry('prompt_submitted'); if (telemetryRef.current.prompts === 2) mikeTelemetry('second_message');");
}

const responseAnchor = "setMessages((prev) => [...prev, { role: 'mike', text: data.text }]);";
if (!main.includes("telemetryRef.current.responses += 1") && main.includes(responseAnchor)) {
  main = main.replace(responseAnchor, responseAnchor + " telemetryRef.current.responses += 1; if (telemetryRef.current.responses === 1) mikeTelemetry('first_response');");
}

const voiceTranscriptAnchor = "else if (message.type === 'response.audio_transcript.done') { const text = String(message.transcript || '').trim(); if (text) setMessages((prev) => [...prev, { role: 'mike', text, voice: true }]); }";
if (main.includes(voiceTranscriptAnchor)) {
  const replacement = "else if (message.type === 'response.audio_transcript.done') { const text = String(message.transcript || '').trim(); if (text) { setMessages((prev) => [...prev, { role: 'mike', text, voice: true }]); telemetryRef.current.responses += 1; if (telemetryRef.current.responses === 1) mikeTelemetry('first_response'); } }";
  main = main.replace(voiceTranscriptAnchor, replacement);
}

const voiceAnchor = "const startRealtimeConversation = async () => {";
if (!main.includes("mikeTelemetry('voice_started')") && main.includes(voiceAnchor)) main = main.replace(voiceAnchor, voiceAnchor + "\n    mikeTelemetry('voice_started');");

const tokenAnchor = "writeToken(data.token);";
if (!main.includes("mikeTelemetry('account_created')") && main.includes(tokenAnchor)) {
  main = main.replace(tokenAnchor, tokenAnchor + " if (authMode === 'register' && !telemetryRef.current.accountCreated) { telemetryRef.current.accountCreated = true; mikeTelemetry('account_created'); }");
}

// Anchoring note: main.jsx defines a small ThinkingBubble() helper component
// ABOVE App(), and it also contains the literal substring '  return (' in its
// own useEffect cleanup ("    return () => clearInterval(id);"). A plain
// main.includes('  return (') / main.replace('  return (', ...) matches
// ThinkingBubble's cleanup first, not App's JSX return - which silently
// wires this effect (and its `messages` dependency) into a component that
// has no `messages` in scope at all, throwing "ReferenceError: messages is
// not defined" on every ThinkingBubble render. Anchor on App's actual
// `return (\n    <main>` instead, which only appears once in the file.
const appReturnAnchor = '  return (\n    <main>';
if (!main.includes("mikeTelemetry('abandoned')") && main.includes(appReturnAnchor)) {
  const abandonment = `  useEffect(() => {\n    const onHide = () => { if (document.visibilityState === 'hidden' && messages.length <= 1) mikeTelemetry('abandoned'); };\n    document.addEventListener('visibilitychange', onHide);\n    return () => document.removeEventListener('visibilitychange', onHide);\n  }, [messages.length]);\n\n`;
  main = main.replace(appReturnAnchor, abandonment + appReturnAnchor);
}

fs.writeFileSync(mainPath, main);
console.log('[patch-mike-telemetry] privacy-safe funnel events wired: landing, prompt, first response, second message, account creation, voice, abandonment');
