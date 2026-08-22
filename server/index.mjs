import express from 'express';
import path from 'path';
import { Readable } from 'stream';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;
const API_BASE = (process.env.MIKE_BACKEND_URL || 'https://mike-ai-nh5g8j.v2.appdeploy.ai').replace(/\/$/, '');
const PREVIEW_VIDEO = process.env.MIKE_PREVIEW_VIDEO_URL || 'https://resource2.heygen.ai/avatar/v3/faea73f9ba464fa1983039c3f2052414/half/2.2/preview_video_target.mp4';

app.disable('x-powered-by');
app.use(express.json({ limit: '15mb' }));

const proxy = async (req, res, target) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45000);
  try {
    const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
    const r = await fetch(target, { method: req.method, headers, body: req.method === 'GET' ? undefined : JSON.stringify(req.body), signal: controller.signal });
    const text = await r.text();
    res.status(r.status).type(r.headers.get('content-type') || 'application/json').send(text);
  } catch (e) {
    console.error('proxy_failed', e);
    if (!res.headersSent) res.status(e.name === 'AbortError' ? 504 : 502).json({ error: e.name === 'AbortError' ? 'mike_backend_timeout' : 'mike_backend_unavailable' });
  } finally {
    clearTimeout(timer);
  }
};

app.get('/api/health', (q, s) => s.json({ ok: true, service: 'mike-ai', backend: API_BASE }));

app.get('/api/avatar-preview', async (q, s) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const range = q.headers.range;
    const headers = range ? { Range: range } : {};
    const r = await fetch(PREVIEW_VIDEO, { headers, signal: controller.signal });
    if (!r.ok || !r.body) throw new Error(`preview_fetch_${r.status}`);
    s.status(r.status);
    for (const name of ['content-type','content-length','content-range','accept-ranges']) {
      const value = r.headers.get(name);
      if (value) s.setHeader(name, value);
    }
    s.setHeader('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');
    s.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    Readable.fromWeb(r.body).pipe(s);
  } catch (e) {
    console.error('avatar_preview_failed', e);
    if (!s.headersSent) s.status(e.name === 'AbortError' ? 504 : 502).json({ error: 'avatar_preview_unavailable' });
  } finally {
    clearTimeout(timer);
  }
});

app.post('/api/ask', (q, s) => proxy(q, s, API_BASE + '/api/ask'));
app.post('/api/tts', (q, s) => proxy(q, s, API_BASE + '/api/tts'));
app.post('/api/avatar', (q, s) => proxy(q, s, API_BASE + '/api/avatar'));
app.get('/api/avatar/:id', (q, s) => proxy(q, s, API_BASE + '/api/avatar/' + encodeURIComponent(q.params.id)));

app.use(express.static(path.join(__dirname, '..', 'dist'), { maxAge: '1h', etag: true }));
app.use((q, s) => s.sendFile(path.join(__dirname, '..', 'dist', 'index.html')));
app.listen(PORT, () => console.log('Mike AI listening on ' + PORT));
