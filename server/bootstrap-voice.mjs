import { startVoiceCleanup } from './voice-cleanup.mjs';
import { ensureReminderSchema, startReminderScheduler } from './reminders.mjs';

await import('./index.mjs');
await ensureReminderSchema().catch((error) => console.error('[reminders] schema setup failed:', error.message || error));
startVoiceCleanup(10_000);
startReminderScheduler();
