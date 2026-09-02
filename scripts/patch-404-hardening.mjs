import fs from 'node:fs';

const path = 'server/index.mjs';
let source = fs.readFileSync(path, 'utf8');

const oldBlock = `app.use((req, res) => {\n  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');\n  res.setHeader('Pragma', 'no-cache');\n  res.setHeader('Expires', '0');\n  res.sendFile(path.join(DIST_DIR, 'index.html'));\n});`;

const newBlock = `const SPA_ROUTES = new Set(['/']);\nconst SPA_ROUTE_PREFIXES = ['/app', '/login', '/register', '/forgot-password', '/reset-password', '/games', '/privacy', '/refunds', '/support'];\nconst isKnownSpaRoute = (pathname) => SPA_ROUTES.has(pathname) || SPA_ROUTE_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(prefix + '/'));\n\napp.use((req, res, next) => {\n  if (req.method !== 'GET' && req.method !== 'HEAD') return res.status(404).json({ error: 'not_found' });\n  if (!isKnownSpaRoute(req.path)) return res.status(404).json({ error: 'not_found' });\n  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');\n  res.setHeader('Pragma', 'no-cache');\n  res.setHeader('Expires', '0');\n  return res.sendFile(path.join(DIST_DIR, 'index.html'));\n});`;

if (source.includes(newBlock)) {
  console.log('[patch-404-hardening] already hardened');
  process.exit(0);
}
if (!source.includes(oldBlock)) throw new Error('[patch-404-hardening] SPA fallback anchor not found');
source = source.replace(oldBlock, newBlock);
fs.writeFileSync(path, source);
console.log('[patch-404-hardening] unknown paths now return JSON 404 instead of SPA index');
