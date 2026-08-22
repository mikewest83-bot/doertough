import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;
const API_BASE = (process.env.MIKE_BACKEND_URL || 'https://mike-ai-nh5g8j.v2.appdeploy.ai').replace(/\/$/, '');
const PREVIEW_VIDEO = process.env.MIKE_PREVIEW_VIDEO_URL || 'https://resource2.heygen.ai/avatar/v3/faea73f9ba464fa1983039c3f2052414/half/2.2/preview_video_target.mp4';

app.use(express.json({ limit: '15mb' }));

const proxy = async (req, res, target) => {
  try {
    const r = await fetch(target, {
      method: req.method,
      headers: { 'Content-Type': 'application/json' },
      body: req.method === 'GET' ? undefined : JSON.stringify(req.body),
    });
    const text = await r.text();
    res.status(r.status).type(r.headers.get('content-type') || 'application/json').send(text);
  } catch (e) {
    console.error('proxy_failed', e);
    res.status(502).json({ error: 'mike_backend_unavailable' });
  }
};

app.get('/api/health', (q, s) => s.json({ ok: true, service: 'mike-ai', backend: API_BASE }));

app.get('/api/avatar-preview', async (q, s) => {
  try {
    const r = await fetch(PREVIEW_VIDEO);
    if (!r.ok || !r.body) throw new Error(`preview_fetch_${r.status}`);
    s.status(200);
    s.setHeader('Content-Type', r.headers.get('content-type') || 'video/mp4');
    s.setHeader('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');
    if (r.headers.get('content-length')) s.setHeader('Content-Length', r.headers.get('content-length'));
    r.body.pipeTo(new WritableStream({
      write(chunk) { s.write(Buffer.from(chunk)); },
      close() { s.end(); },
      abort() { s.end(); },
    })).catch(() => s.end());
  } catch (e) {
    console.error('avatar_preview_failed', e);
    s.status(502).json({ error: 'avatar_preview_unavailable' });
  }
});

app.post('/api/ask', (q, s) => proxy(q, s, API_BASE + '/api/ask'));
app.post('/api/tts', (q, s) => proxy(q, s, API_BASE + '/api/tts'));
app.post('/api/avatar', (q, s) => proxy(q, s, API_BASE + '/api/avatar'));
app.get('/api/avatar/:id', (q, s) => proxy(q, s, API_BASE + '/api/avatar/' + encodeURIComponent(q.params.id)));

app.use(express.static(path.join(__dirname, '..', 'dist')));
app.use((q, s) => s.sendFile(path.join(__dirname, '..', 'dist', 'index.html')));
app.listen(PORT, () => console.log('Mike AI listening on ' + PORT));
