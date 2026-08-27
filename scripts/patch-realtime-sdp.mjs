import fs from 'fs';

const file = 'src/main.jsx';
const source = fs.readFileSync(file, 'utf8');
const broken = "form.append('sdp', new Blob([pc.localDescription.sdp], { type: 'application/sdp' }));";
const fixed = "form.append('sdp', pc.localDescription.sdp);";

if (source.includes(fixed)) {
  console.log('[realtime-sdp] source already uses a string SDP form field');
  process.exit(0);
}

if (!source.includes(broken)) {
  throw new Error('[realtime-sdp] expected browser SDP FormData line was not found; refusing to build an unverified voice path');
}

fs.writeFileSync(file, source.replace(broken, fixed));
console.log('[realtime-sdp] patched SDP FormData field to a plain string');
