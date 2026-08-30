import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.join(root, 'src', 'main.jsx');
let source = fs.readFileSync(target, 'utf8');

const helper = `
function mikeAudioDeviceSupport() {
  const state = { inputDeviceId: '', outputDeviceId: '', supported: false };
  const mediaDevices = navigator.mediaDevices;
  const canEnumerate = !!mediaDevices?.enumerateDevices;
  const refresh = async () => {
    if (!canEnumerate) return [];
    try { return await mediaDevices.enumerateDevices(); } catch { return []; }
  };
  const audioConstraints = (deviceId = '') => ({
    channelCount: { ideal: 1 },
    echoCancellation: { ideal: true },
    noiseSuppression: { ideal: true },
    autoGainControl: { ideal: true },
    ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
  });
  const prepareInput = async () => {
    state.inputDeviceId = '';
    if (!mediaDevices?.getUserMedia) return null;
    // Acquire the microphone exactly once. Reuse this stream for Realtime so
    // permission prompts and device contention cannot occur twice.
    let stream = null;
    try {
      stream = await mediaDevices.getUserMedia({ audio: audioConstraints() });
    } catch {
      try { stream = await mediaDevices.getUserMedia({ audio: true }); } catch { return null; }
    }
    const devices = await refresh();
    const activeInput = stream.getAudioTracks?.()[0]?.getSettings?.()?.deviceId || '';
    const input = devices.find((d) => d.kind === 'audioinput' && d.deviceId === activeInput)
      || devices.find((d) => d.kind === 'audioinput' && d.deviceId);
    state.inputDeviceId = input?.deviceId || activeInput || '';
    return { stream, inputDeviceId: state.inputDeviceId };
  };
  const routeOutput = async (audio) => {
    if (!audio || typeof audio.setSinkId !== 'function' || !canEnumerate) return false;
    const devices = await refresh();
    const output = devices.find((d) => d.kind === 'audiooutput' && d.deviceId);
    if (!output?.deviceId) return false;
    try { await audio.setSinkId(output.deviceId); state.outputDeviceId = output.deviceId; state.supported = true; return true; } catch { return false; }
  };
  return { state, prepareInput, routeOutput, audioConstraints };
}
`;

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
  "const preparedAudio = await audioDevices.prepareInput();\n      if (!preparedAudio?.stream) throw new Error('Mike could not access the microphone. Check microphone permission and try again.');\n      const localStream = preparedAudio.stream;"
);

const outputPatch = "const audio = new Audio(); audio.autoplay = true;\n      audioDevices.routeOutput(audio).catch(() => {});";
if (!source.includes(outputPatch)) {
  source = source.replace(
    'const audio = new Audio(); audio.autoplay = true;',
    outputPatch
  );
}

fs.writeFileSync(target, source);
console.log('[build] Audio cleanup and device routing wired with single microphone acquisition');
