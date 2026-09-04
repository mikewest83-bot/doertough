// Lightweight production auth-flow smoke test helper.
// Usage: node scripts/auth-flow-smoke.mjs https://doertoughmikeai.com
// This intentionally does NOT create or modify an account.

const base = (process.argv[2] || 'https://doertoughmikeai.com').replace(/\/$/, '');

async function check(path, method = 'POST', body = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: method === 'GET' ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  console.log(`${method} ${path} -> ${res.status}`, text.slice(0, 300));
  return { res, text };
}

// Verify the public auth endpoints are reachable without exposing whether an
// account exists. A valid-but-nonexistent email should still return the generic
// success response from forgot-password.
await check('/api/auth/forgot-password', 'POST', { email: 'smoke-test-nonexistent@example.invalid' });
console.log('Auth endpoint smoke check complete.');
