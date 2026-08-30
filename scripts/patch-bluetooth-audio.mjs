import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.join(root, 'src', 'main.jsx');
let source = fs.readFileSync(target, 'utf8');

const marker = "// Mike Bluetooth audio compatibility: prefer an OS-selected Bluetooth headset when the browser exposes it.\n";
if (source.includes(marker)) {
  console.log('[build] Bluetooth audio compatibility already applied');
  process.exit(0);
}

const oldLine = '      const localStream = await navigator.mediaDevices.getUserMedia({ audio: true });';
const newBlock = `${marker}      let localStream = await navigator.mediaDevices.getUserMedia({ audio: true });\n      try {\n        const devices = await navigator.mediaDevices.enumerateDevices();\n        const bluetoothPattern = /airpods|beats|bluetooth|headset|earbuds|buds|wireless/i;\n        const preferredInput = devices.find((device) => device.kind === 'audioinput' && device.deviceId && bluetoothPattern.test(device.label || ''));\n        if (preferredInput && preferredInput.deviceId) {\n          try {\n            const preferredStream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: preferredInput.deviceId } } });\n            localStream.getTracks().forEach((track) => track.stop());\n            localStream = preferredStream;\n          } catch (selectionError) {\n            console.info('[voice] Bluetooth input selection unavailable; keeping browser-selected microphone.', selectionError);\n          }\n        }\n      } catch (deviceError) {\n        console.info('[voice] Could not inspect audio devices; keeping browser-selected audio.', deviceError);\n      }`;
if (!source.includes(oldLine)) throw new Error('Realtime microphone initialization anchor not found');
source = source.replace(oldLine, newBlock);

const audioLine = '      const audio = new Audio(); audio.autoplay = true;';
const audioBlock = `${audioLine}\n      try {\n        if (typeof audio.setSinkId === 'function') {\n          const outputs = await navigator.mediaDevices.enumerateDevices();\n          const bluetoothOutput = outputs.find((device) => device.kind === 'audiooutput' && device.deviceId && /airpods|beats|bluetooth|headset|earbuds|buds|wireless/i.test(device.label || ''));\n          if (bluetoothOutput?.deviceId) await audio.setSinkId(bluetoothOutput.deviceId);\n        }\n      } catch (outputError) {\n        console.info('[voice] Bluetooth output routing unavailable; keeping system audio.', outputError);\n      }`;
if (!source.includes(audioLine)) throw new Error('Realtime audio element anchor not found');
source = source.replace(audioLine, audioBlock);

fs.writeFileSync(target, source);
console.log('[build] Bluetooth audio compatibility applied with safe fallback');
