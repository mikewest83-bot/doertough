// Stable production bootstrap for Mike AI.
// Database readiness is established BEFORE the HTTP server is imported so
// routes never race schema creation. Railway can also run `npm run migrate`
// as a pre-deploy safety gate; this remains idempotent for existing databases.
import { migrate } from './db.mjs';
import { ensureRbacSchema } from './rbac.mjs';
import { ensureReminderSchema, startReminderScheduler } from './reminders.mjs';
import { startVoiceCleanup } from './voice-cleanup.mjs';

const dbReady = await migrate();
if (!dbReady) {
  throw new Error('database_schema_not_ready');
}

await ensureRbacSchema();
await ensureReminderSchema();
await import('./index.mjs');

startVoiceCleanup(10_000);
startReminderScheduler();
