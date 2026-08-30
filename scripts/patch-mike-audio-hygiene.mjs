import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.join(root, 'src', 'main.jsx');
let source = fs.readFileSync(target, 'utf8');

const legacy = "const localStream = await navigator.mediaDevices.getUserMedia({ audio: true });";
const safe = `const localStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
          sampleRate: 48000,
        }
      });
      // Best-effort constraint enforcement; unsupported constraints are ignored by the browser.
      try {
        const track = localStream.getAudioTracks()[0];
        if (track?.applyConstraints) await track.applyConstraints({
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        });
      } catch (audioConstraintError) {
        console.warn('[voice] advanced audio constraints unavailable:', audioConstraintError);
      }`;

// This patch must be idempotent because the build pipeline may run the
// realtime-device patch first. Detect the generated audio implementation by
// its complete marker, not by a generic echoCancellation string that could
// belong to an unrelated helper.
const installedMarker = "const preferredInputId = await audioDevices.prepareInput();";
const hygieneMarker = "echoCancellation: true,\n          noiseSuppression: true,\n          autoGainControl: true,";

if (source.includes(installedMarker) || source.includes(hygieneMarker)) {
  console.log('[build] Audio hygiene already present; leaving existing microphone implementation intact');
  process.exit(0);
}

if (!source.includes(legacy)) throw new Error('Realtime microphone anchor not found');

source = source.replace(legacy, safe);
fs.writeFileSync(target, source);
console.log('[build] Mike audio hygiene enabled');
