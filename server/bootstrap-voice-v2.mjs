// Stable production bootstrap for Mike AI.
// Database readiness is established BEFORE the HTTP server is imported so
// routes never race schema creation. Railway can also run `npm run migrate`
// as a pre-deploy safety gate; this remains idempotent for existing databases.
import { migrate } from './db.mjs';
import { ensureRbacSchema } from './rbac.mjs';
import { ensureReminderSchema } from './reminders.mjs';
import { ensureDealAlertSchema } from './deal-alerts.mjs';
import { startVoiceCleanup } from './voice-cleanup.mjs';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const smokeTest = process.env.SMOKE_TEST === '1';

let dbReady = smokeTest;
let lastError;

if (!smokeTest) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      dbReady = await migrate();
      if (dbReady) break;
    } catch (error) {
      lastError = error;
      console.error(`[db] migration attempt ${attempt}/3 failed:`, error.message || error);
    }
    if (attempt < 3) await sleep(1000 * 2 ** (attempt - 1));
  }

  if (!dbReady) {
    throw lastError || new Error('database_schema_not_ready');
  }

  await ensureRbacSchema();
  await ensureReminderSchema();
  await ensureDealAlertSchema();
}

await import('./index.mjs');

if (!smokeTest) {
  startVoiceCleanup(10_000);
}
