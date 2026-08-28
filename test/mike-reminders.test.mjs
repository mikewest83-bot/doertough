import { strict as assert } from 'node:assert';
import { REMINDER_TOOLS, reminderHandlerFor } from '../server/reminders.mjs';

describe('Mike reminders', () => {
  it('exposes set, list, and cancel tools', () => {
    const names = REMINDER_TOOLS.map((tool) => tool.name);
    assert.deepEqual(names, ['set_reminder', 'list_reminders', 'cancel_reminder']);
  });

  it('binds reminder handlers to the authenticated user id', () => {
    const handler = reminderHandlerFor('set_reminder', 42);
    assert.equal(typeof handler, 'function');
    assert.equal(reminderHandlerFor('unknown', 42), null);
  });
});
