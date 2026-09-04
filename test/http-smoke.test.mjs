import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const port = 19080 + Math.floor(Math.random() * 500);
const baseUrl = `http://127.0.0.1:${port}`;
let child;

async function waitForHealth(timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return response;
      lastError = new Error(`health status ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw lastError || new Error('health timeout');
}

describe('Mike HTTP smoke', function () {
  this.timeout(20000);

  before(async () => {
    child = spawn(process.execPath, ['server/bootstrap-voice-v2.mjs'], {
      env: {
        ...process.env,
        NODE_ENV: 'test',
        SMOKE_TEST: '1',
        PORT: String(port),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    child.stdout.on('data', (chunk) => process.stdout.write(`[smoke-server] ${chunk}`));
    child.stderr.on('data', (chunk) => process.stderr.write(`[smoke-server] ${chunk}`));

    await waitForHealth();
  });

  after(async () => {
    if (!child || child.exitCode !== null) return;
    child.kill('SIGTERM');
    await Promise.race([
      once(child, 'exit'),
      new Promise((resolve) => setTimeout(resolve, 2000)),
    ]);
    if (child.exitCode === null) child.kill('SIGKILL');
  });

  it('serves a healthy API response', async () => {
    const response = await fetch(`${baseUrl}/api/health`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.equal(body.service, 'mike-ai');
  });

  it('returns a real JSON 404 for unknown API paths', async () => {
    const response = await fetch(`${baseUrl}/api/definitely-not-a-real-route`);
    assert.equal(response.status, 404);
    assert.match(response.headers.get('content-type') || '', /application\/json/);
    const body = await response.json();
    assert.equal(body.error, 'not_found');
  });
});
