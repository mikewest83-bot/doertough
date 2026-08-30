import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.join(root, 'src', 'main.jsx');
let source = fs.readFileSync(target, 'utf8');

const helper = `\nfunction mikeAudioDeviceSupport() {\n  const state = { inputDeviceId: '', outputDeviceId: '' };\n  const canEnumerate = !!navigator.mediaDevices?.enumerateDevices;\n  const refresh = async () => {\n    if (!canEnumerate) return [];\n    try { return await navigator.mediaDevices.enumerateDevices(); } catch { return []; }\n  };\n  const pickBluetooth = (devices, kind) => devices.find((d) => d.kind === kind && /bluetooth|airpods|headset|hands-free/i.test(d.label || ''));\n  const prepareInput = async () => {\n    const devices = await refresh();\n    const preferred = pickBluetooth(devices, 'audioinput');\n    state.inputDeviceId = preferred?.deviceId || '';\n    return state.inputDeviceId;\n  };\n  const routeOutput = async (audio) => {\n    if (!audio || typeof audio.setSinkId !== 'function') return false;\n    const devices = await refresh();\n    const preferred = pickBluetooth(devices, 'audiooutput');\n    if (!preferred?.deviceId) return false;\n    try { await audio.setSinkId(preferred.deviceId); state.outputDeviceId = preferred.deviceId; return true; } catch { return false; }\n  };\n  return { state, prepareInput, routeOutput };\n}\n`;

if (!source.includes('function mikeAudioDeviceSupport()')) {
  const anchor = 'function App() {';
  if (!source.includes(anchor)) throw new Error('App anchor not found');
  source = source.replace(anchor, `${helper}\n${anchor}`);
}

if (!source.includes('const audioDevices = mikeAudioDeviceSupport();')) {
  const anchor = '  const photoInputRef = useRef(null);';
  if (!source.includes(anchor)) throw new Error('photoInputRef anchor not found');
  source = source.replace(anchor, `${anchor}\n  const audioDevices = mikeAudioDeviceSupport();`);
}

source = source.replace(
  'const localStream = await navigator.mediaDevices.getUserMedia({ audio: true });',
  "const preferredInputId = await audioDevices.prepareInput();\n      const localStream = await navigator.mediaDevices.getUserMedia({ audio: preferredInputId ? { deviceId: { exact: preferredInputId } } : true });"
);
source = source.replace(
  "const audio = new Audio(); audio.autoplay = true;",
  "const audio = new Audio(); audio.autoplay = true;\n      audioDevices.routeOutput(audio).catch(() => {});"
);

fs.writeFileSync(target, source);
console.log('[build] Realtime audio-device routing wired with Bluetooth-aware input/output fallback');
