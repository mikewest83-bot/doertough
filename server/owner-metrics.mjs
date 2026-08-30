import { query } from './db.mjs';

const daysAgo = (days) => `now() - interval '${Number(days)} days'`;

async function safe(label, fn) {
  try {
    return await fn();
  } catch (error) {
    console.error(`[owner-metrics] ${label} failed:`, error.message || error);
    return null;
  }
}

const one = async (text, params = []) => {
  const { rows } = await query(text, params);
  return rows[0] || {};
};

const many = async (text, params = []) => {
  const { rows } = await query(text, params);
  return rows;
};

export async function getOwnerMetrics() {
  const [overview, growth, subscriptions, voice, access] = await Promise.all([
    safe('overview', async () => one(`
      SELECT
        COUNT(*)::int AS accounts,
        COUNT(*) FILTER (WHERE plan = 'pro' AND subscription_status IN ('active','trialing') AND (current_period_end IS NULL OR current_period_end >= now()))::int AS paying,
        COUNT(*) FILTER (WHERE subscription_status = 'trialing' AND (trial_end IS NULL OR trial_end >= now()))::int AS trialing,
        COUNT(*) FILTER (WHERE subscription_status = 'past_due')::int AS past_due,
        COUNT(*) FILTER (WHERE subscription_status = 'canceled')::int AS canceled,
        COUNT(*) FILTER (WHERE created_at >= ${daysAgo(7)})::int AS new_this_week,
        COUNT(*) FILTER (WHERE last_seen_at >= ${daysAgo(1)})::int AS active_today,
        COUNT(*) FILTER (WHERE plan = 'pro' AND current_period_end IS NOT NULL AND current_period_end < now())::int AS entitled_past_period
      FROM users
    `)),
    safe('growth', async () => ({
      bars: await many(`
        SELECT day::date AS date, COUNT(u.id)::int AS signups
        FROM generate_series(current_date - interval '13 days', current_date, interval '1 day') day
        LEFT JOIN users u ON u.created_at::date = day::date
        GROUP BY day::date ORDER BY day::date
      `),
      signups: await many(`
        SELECT id, name, email, plan, subscription_status, created_at
        FROM users ORDER BY created_at DESC LIMIT 8
      `),
    })),
    safe('subscriptions', async () => ({
      trialsEnding: await many(`
        SELECT id, name, email, trial_end
        FROM users
        WHERE subscription_status = 'trialing'
          AND trial_end IS NOT NULL
          AND trial_end >= now()
          AND trial_end <= now() + interval '3 days'
        ORDER BY trial_end ASC
      `),
      pastDue: await many(`
        SELECT id, name, email, current_period_end
        FROM users WHERE subscription_status = 'past_due'
        ORDER BY current_period_end ASC NULLS LAST
      `),
      canceled: await many(`
        SELECT id, name, email, current_period_end
        FROM users WHERE subscription_status = 'canceled'
        ORDER BY current_period_end DESC NULLS LAST LIMIT 25
      `),
    })),
    safe('voice', async () => one(`
      SELECT
        COALESCE(SUM(CASE WHEN actual_seconds IS NULL THEN reserved_seconds ELSE actual_seconds END),0)::bigint AS billed_seconds,
        COALESCE(SUM(reserved_seconds) FILTER (WHERE actual_seconds IS NULL),0)::bigint AS unsettled_reserved_seconds,
        COUNT(*)::int AS sessions,
        COUNT(DISTINCT user_id)::int AS callers,
        COUNT(*) FILTER (WHERE actual_seconds IS NULL)::int AS never_settled
      FROM voice_sessions
      WHERE started_at >= now() - interval '30 days'
    `)),
    safe('access', async () => ({
      roles: await many(`
        SELECT
          CASE WHEN lower(email) = lower(COALESCE(current_setting('app.owner_email', true), '')) THEN 'owner'
               ELSE 'user' END AS role,
          COUNT(*)::int AS count
        FROM users GROUP BY 1 ORDER BY 1
      `),
      configured: true,
    })),
  ]);

  const paid = overview?.paying ?? 0;
  const trialing = overview?.trialing ?? 0;
  const voiceMinutes = voice ? Number(voice.billed_seconds || 0) / 60 : null;
  const voicePoolMinutes = Number(process.env.VOICE_MINUTES_GLOBAL || 5000);

  const alerts = [];
  if (subscriptions?.trialsEnding?.length) alerts.push({ type: 'warning', count: subscriptions.trialsEnding.length, text: `${subscriptions.trialsEnding.length} trial${subscriptions.trialsEnding.length === 1 ? '' : 's'} ending within 3 days` });
  if (overview?.past_due) alerts.push({ type: 'danger', count: overview.past_due, text: `${overview.past_due} past-due subscription${overview.past_due === 1 ? '' : 's'}` });
  if (overview?.entitled_past_period) alerts.push({ type: 'danger', count: overview.entitled_past_period, text: `${overview.entitled_past_period} account${overview.entitled_past_period === 1 ? '' : 's'} entitled past paid period end` });
  if (voice?.never_settled) alerts.push({ type: 'danger', count: voice.never_settled, text: `${voice.never_settled} voice session${voice.never_settled === 1 ? '' : 's'} never settled` });
  if (voice && voicePoolMinutes > 0 && Number(voiceMinutes) / voicePoolMinutes > 0.75) alerts.push({ type: 'danger', count: Math.round((Number(voiceMinutes) / voicePoolMinutes) * 100), text: `Voice pool is above 75% of the 30-day ceiling` });

  return {
    overview: overview ? {
      accounts: overview.accounts ?? 0,
      paying: paid,
      trialing,
      pastDue: overview.past_due ?? 0,
      canceled: overview.canceled ?? 0,
      newThisWeek: overview.new_this_week ?? 0,
      activeToday: overview.active_today ?? 0,
      entitledPastPeriod: overview.entitled_past_period ?? 0,
      paidPlanPercent: overview.accounts ? Math.round((paid / Number(overview.accounts)) * 100) : 0,
      mrr: null,
      trialMrr: null,
    } : null,
    growth,
    subscriptions,
    voice: voice ? {
      minutes: Math.round(voiceMinutes * 10) / 10,
      poolMinutes: voicePoolMinutes,
      poolPercent: voicePoolMinutes ? Math.round((voiceMinutes / voicePoolMinutes) * 100) : 0,
      sessions: voice.sessions ?? 0,
      callers: voice.callers ?? 0,
      neverSettled: voice.never_settled ?? 0,
    } : null,
    access,
    alerts: overview && (subscriptions || voice) ? alerts : [],
    configured: true,
  };
}
