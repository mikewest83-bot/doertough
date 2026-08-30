import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.join(root, 'src', 'main.jsx');
let source = fs.readFileSync(target, 'utf8');

// Owner Access is isolated from the main Mike experience.
const importLine = "import OwnerPortal from './OwnerPortal.jsx';";
if (!source.includes(importLine)) {
  const styleImport = "import './style.css';";
  if (!source.includes(styleImport)) throw new Error('Style import anchor not found');
  source = source.replace(styleImport, `${styleImport}\n${importLine}`);
}

const stateLine = '  const [ownerOpen, setOwnerOpen] = useState(false);';
if (!source.includes(stateLine)) {
  const anchor = '  const [accountsOn, setAccountsOn] = useState(false);';
  if (!source.includes(anchor)) throw new Error('Owner state anchor not found');
  source = source.replace(anchor, `${anchor}\n${stateLine}`);
}

const ownerButton = '{user?.isOwner && (<button className="auth-btn" onClick={() => setOwnerOpen(true)}>Owner Access</button>)}';
if (!source.includes(ownerButton)) {
  const anchor = '<div className="header-right"><span className="status">● {statusText}</span>';
  if (!source.includes(anchor)) throw new Error('Owner header anchor not found');
  source = source.replace(anchor, `${anchor}${ownerButton}`);
}

const ownerRender = '{ownerOpen && user?.isOwner && <OwnerPortal onClose={() => setOwnerOpen(false)} />}';
if (!source.includes(ownerRender)) {
  const anchor = '{authOpen && (() => {';
  if (!source.includes(anchor)) throw new Error('Owner render anchor not found');
  source = source.replace(anchor, `${ownerRender}\n      ${anchor}`);
}

// Bluetooth audio compatibility: prefer a browser-exposed Bluetooth headset when available.
const bluetoothMarker = '// Mike Bluetooth audio compatibility applied';
if (!source.includes(bluetoothMarker)) {
  const micAnchor = '      const localStream = await navigator.mediaDevices.getUserMedia({ audio: true });';
  const micReplacement = `${bluetoothMarker}\n      let localStream = await navigator.mediaDevices.getUserMedia({ audio: true });\n      try {\n        const devices = await navigator.mediaDevices.enumerateDevices();\n        const bluetoothPattern = /airpods|beats|bluetooth|headset|earbuds|buds|wireless/i;\n        const preferredInput = devices.find((device) => device.kind === 'audioinput' && device.deviceId && bluetoothPattern.test(device.label || ''));\n        if (preferredInput?.deviceId) {\n          try {\n            const preferredStream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: preferredInput.deviceId } } });\n            localStream.getTracks().forEach((track) => track.stop());\n            localStream = preferredStream;\n          } catch (selectionError) {\n            console.info('[voice] Bluetooth input selection unavailable; keeping browser-selected microphone.', selectionError);\n          }\n        }\n      } catch (deviceError) {\n        console.info('[voice] Could not inspect audio devices; keeping browser-selected audio.', deviceError);\n      }`;
  if (!source.includes(micAnchor)) throw new Error('Realtime microphone initialization anchor not found');
  source = source.replace(micAnchor, micReplacement);

  const audioAnchor = '      const audio = new Audio(); audio.autoplay = true;';
  const audioReplacement = `${audioAnchor}\n      try {\n        if (typeof audio.setSinkId === 'function') {\n          const outputs = await navigator.mediaDevices.enumerateDevices();\n          const bluetoothOutput = outputs.find((device) => device.kind === 'audiooutput' && device.deviceId && /airpods|beats|bluetooth|headset|earbuds|buds|wireless/i.test(device.label || ''));\n          if (bluetoothOutput?.deviceId) await audio.setSinkId(bluetoothOutput.deviceId);\n        }\n      } catch (outputError) {\n        console.info('[voice] Bluetooth output routing unavailable; keeping system audio.', outputError);\n      }`;
  if (!source.includes(audioAnchor)) throw new Error('Realtime audio element anchor not found');
  source = source.replace(audioAnchor, audioReplacement);
}

fs.writeFileSync(target, source);
console.log('[build] Owner Access isolated; Bluetooth audio compatibility applied with safe fallback');
