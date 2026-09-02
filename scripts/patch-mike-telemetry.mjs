import fs from 'node:fs';

const mainPath = 'src/main.jsx';
let main = fs.readFileSync(mainPath, 'utf8');
const helperAnchor = "  const [input, setInput] = useState('');\n";
const helper = `  const mikeTelemetry = (event) => {\n    try {\n      const allowed = new Set(['landing_view','prompt_submitted','first_response','second_message','voice_started','abandoned']);\n      if (!allowed.has(event)) return;\n      void fetch('/api/client-log', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phase: 'telemetry', name: event, message: 'product_event' }) }).catch(() => {});\n    } catch {}\n  };\n`;
if (!main.includes('const mikeTelemetry = (event) =>')) {
  if (!main.includes(helperAnchor)) throw new Error('[patch-mike-telemetry] state anchor not found');
  main = main.replace(helperAnchor, helperAnchor + helper);
}
if (!main.includes("mikeTelemetry('landing_view')")) {
  const pos = main.indexOf("  useEffect(() => {", main.indexOf(helperAnchor));
  if (pos < 0) throw new Error('[patch-mike-telemetry] effect anchor not found');
  main = main.slice(0, pos) + "  useEffect(() => { mikeTelemetry('landing_view'); }, []);\n\n" + main.slice(pos);
}
const askAnchor = "  const ask = async (raw) => { const text = (raw || '').trim();";
if (!main.includes("mikeTelemetry('prompt_submitted')")) {
  if (!main.includes(askAnchor)) throw new Error('[patch-mike-telemetry] ask anchor not found');
  main = main.replace(askAnchor, askAnchor + "\n    mikeTelemetry('prompt_submitted');");
}
const voiceAnchor = "const startVoice = async () => {";
if (!main.includes("mikeTelemetry('voice_started')") && main.includes(voiceAnchor)) main = main.replace(voiceAnchor, voiceAnchor + " mikeTelemetry('voice_started');");
if (!main.includes("mikeTelemetry('abandoned')") && main.includes('  return (')) {
  const abandonment = `  useEffect(() => {\n    const onHide = () => { if (document.visibilityState === 'hidden' && messages.length <= 1) mikeTelemetry('abandoned'); };\n    document.addEventListener('visibilitychange', onHide);\n    return () => document.removeEventListener('visibilitychange', onHide);\n  }, [messages.length]);\n\n`;
  main = main.replace('  return (', abandonment + '  return (');
}
fs.writeFileSync(mainPath, main);
console.log('[patch-mike-telemetry] privacy-safe funnel events wired');
