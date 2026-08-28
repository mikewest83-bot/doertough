// Persistent reminders/alarms for Mike AI.
// Reminders are account-scoped and survive process restarts. Delivery uses the
// existing mail transport when configured; the scheduler never exposes data
// across accounts.
import { query, dbEnabled } from './db.mjs';
import { sendReminder } from './mailer.mjs';

let ready = false;
const MAX_TITLE = 160;
const MAX_NOTE = 1200;
const RECURRENCES = new Set(['once', 'daily', 'weekly', 'monthly']);

const clean = (value, max) => String(value || '').trim().slice(0, max);

function parseWhen(value) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

export async function ensureReminderSchema() {
  if (!dbEnabled || ready) return dbEnabled;
  await query(`
    CREATE TABLE IF NOT EXISTS reminders (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      note TEXT,
      remind_at TIMESTAMPTZ NOT NULL,
      timezone TEXT NOT NULL DEFAULT 'UTC',
      recurrence TEXT NOT NULL DEFAULT 'once' CHECK (recurrence IN ('once','daily','weekly','monthly')),
      delivered_at TIMESTAMPTZ,
      canceled_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS reminders_due_idx ON reminders(remind_at, delivered_at, canceled_at);
    CREATE INDEX IF NOT EXISTS reminders_user_idx ON reminders(user_id, canceled_at, remind_at DESC);
  `);
  ready = true;
  return true;
}

export async function createReminder(userId, { title, note, remindAt, timezone = 'UTC', recurrence = 'once' } = {}) {
  if (!userId || !(await ensureReminderSchema())) throw new Error('reminders_not_configured');
  const cleanTitle = clean(title, MAX_TITLE);
  const when = parseWhen(remindAt);
  const repeat = RECURRENCES.has(String(recurrence)) ? String(recurrence) : 'once';
  if (!cleanTitle) throw new Error('reminder_title_required');
  if (!when) throw new Error('reminder_time_invalid');
  if (when.getTime() <= Date.now()) throw new Error('reminder_time_must_be_future');
  const tz = clean(timezone, 80) || 'UTC';
  const { rows } = await query(
    `INSERT INTO reminders (user_id, title, note, remind_at, timezone, recurrence)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [userId, cleanTitle, clean(note, MAX_NOTE) || null, when, tz, repeat]
  );
  return rows[0];
}

export async function listReminders(userId, { includePast = false } = {}) {
  if (!userId || !(await ensureReminderSchema())) return [];
  const where = includePast
    ? 'user_id = $1 AND canceled_at IS NULL'
    : 'user_id = $1 AND canceled_at IS NULL AND (delivered_at IS NULL OR recurrence <> \'once\') AND remind_at >= now() - interval \'1 day\'';
  const { rows } = await query(
    `SELECT id, title, note, remind_at, timezone, recurrence, delivered_at, created_at
       FROM reminders WHERE ${where} ORDER BY remind_at ASC LIMIT 100`,
    [userId]
  );
  return rows;
}

export async function cancelReminder(userId, id) {
  if (!userId || !(await ensureReminderSchema())) return false;
  const { rowCount } = await query(
    `UPDATE reminders SET canceled_at = now(), updated_at = now()
      WHERE id = $1 AND user_id = $2 AND canceled_at IS NULL`,
    [id, userId]
  );
  return rowCount > 0;
}

function advance(date, recurrence) {
  const next = new Date(date);
  if (recurrence === 'daily') next.setUTCDate(next.getUTCDate() + 1);
  else if (recurrence === 'weekly') next.setUTCDate(next.getUTCDate() + 7);
  else if (recurrence === 'monthly') next.setUTCMonth(next.getUTCMonth() + 1);
  else return null;
  return next;
}

async function dueReminders(limit = 20) {
  if (!(await ensureReminderSchema())) return [];
  const { rows } = await query(
    `SELECT r.*, u.email, u.name
       FROM reminders r
       JOIN users u ON u.id = r.user_id
      WHERE r.canceled_at IS NULL
        AND r.remind_at <= now()
        AND (r.delivered_at IS NULL OR r.recurrence <> 'once')
      ORDER BY r.remind_at ASC
      LIMIT $1`,
    [Math.min(50, Math.max(1, limit))]
  );
  return rows;
}

export async function deliverDueReminders() {
  const rows = await dueReminders();
  let delivered = 0;
  for (const reminder of rows) {
    try {
      if (reminder.recurrence === 'once') {
        const { rowCount } = await query(
          `UPDATE reminders SET delivered_at = now(), updated_at = now()
            WHERE id = $1 AND delivered_at IS NULL AND canceled_at IS NULL`,
          [reminder.id]
        );
        if (!rowCount) continue;
        await sendReminder({
          to: reminder.email,
          name: reminder.name,
          title: reminder.title,
          note: reminder.note,
          remindAt: reminder.remind_at,
        });
        delivered += 1;
        continue;
      }

      const next = advance(reminder.remind_at, reminder.recurrence);
      if (!next) continue;
      const { rowCount } = await query(
        `UPDATE reminders SET remind_at = $2, delivered_at = now(), updated_at = now()
          WHERE id = $1 AND canceled_at IS NULL AND remind_at = $3`,
        [reminder.id, next, reminder.remind_at]
      );
      if (!rowCount) continue;
      await sendReminder({
        to: reminder.email,
        name: reminder.name,
        title: reminder.title,
        note: reminder.note,
        remindAt: reminder.remind_at,
      });
      delivered += 1;
    } catch (error) {
      console.error(`[reminders] delivery failed for #${reminder.id}:`, error.message || error);
    }
  }
  return delivered;
}

export function startReminderScheduler() {
  const run = async () => {
    try {
      const count = await deliverDueReminders();
      if (count) console.log(`[reminders] delivered ${count} reminder(s)`);
    } catch (error) {
      console.error('[reminders] scheduler failed:', error.message || error);
    }
  };
  void run();
  const timer = setInterval(run, 30_000);
  timer.unref?.();
  return timer;
}

function toolError(error) {
  return { error: error.message || 'reminder_unavailable' };
}

export async function setReminderTool(userId, args = {}) {
  try {
    const reminder = await createReminder(userId, args);
    return { tool: 'set_reminder', reminder, message: `Reminder set for ${new Date(reminder.remind_at).toLocaleString()}.` };
  } catch (error) {
    return toolError(error);
  }
}

export async function listRemindersTool(userId, args = {}) {
  try { return { tool: 'list_reminders', reminders: await listReminders(userId, args) }; }
  catch (error) { return toolError(error); }
}

export async function cancelReminderTool(userId, args = {}) {
  try {
    const id = Number(args.id);
    if (!Number.isInteger(id) || id <= 0) return { error: 'reminder_id_invalid' };
    const canceled = await cancelReminder(userId, id);
    return { tool: 'cancel_reminder', canceled, message: canceled ? 'Reminder canceled.' : 'I could not find an active reminder with that id.' };
  } catch (error) { return toolError(error); }
}

export const REMINDER_TOOLS = [
  { type: 'function', name: 'set_reminder', description: 'Set a persistent reminder or recurring alarm for the signed-in user. Use an ISO-8601 remindAt with timezone information when possible. Never claim a reminder was set unless this tool succeeds.', parameters: { type: 'object', properties: { title: { type: 'string' }, note: { type: 'string' }, remindAt: { type: 'string', description: 'Future ISO-8601 date/time, preferably with offset.' }, timezone: { type: 'string', description: 'IANA timezone such as America/New_York.' }, recurrence: { type: 'string', enum: ['once','daily','weekly','monthly'] } }, required: ['title','remindAt'], additionalProperties: false } },
  { type: 'function', name: 'list_reminders', description: 'List the signed-in user\'s active reminders and recurring alarms.', parameters: { type: 'object', properties: { includePast: { type: 'boolean' } }, required: [], additionalProperties: false } },
  { type: 'function', name: 'cancel_reminder', description: 'Cancel one of the signed-in user\'s reminders by id.', parameters: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'], additionalProperties: false } },
];

export function reminderHandlerFor(name, userId) {
  if (name === 'set_reminder') return (args) => setReminderTool(userId, args);
  if (name === 'list_reminders') return (args) => listRemindersTool(userId, args);
  if (name === 'cancel_reminder') return (args) => cancelReminderTool(userId, args);
  return null;
}
