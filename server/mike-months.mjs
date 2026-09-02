import crypto from 'crypto';
import { query, pool, getUserById } from './db.mjs';

const REFUND_WINDOW_DAYS = Math.max(7, Number(process.env.MIKE_MONTHS_REFUND_DAYS || 7));
const SCHEDULER_INTERVAL_MS = Math.max(60 * 60 * 1000, Number(process.env.MIKE_MONTHS_INTERVAL_MS || 60 * 60 * 1000));
const APP_URL = String(process.env.PUBLIC_APP_URL || 'https://doertoughmikeai.com').replace(/\/+$/, '');

function makeCode() {
  return crypto.randomBytes(6).toString('base64url').replace(/[-_]/g, '').slice(0, 10).toUpperCase();
}

function monthLater(date) {
  const d = new Date(date);
  const originalDay = d.getUTCDate();
  d.setUTCMonth(d.getUTCMonth() + 1);
  if (d.getUTCDate() < originalDay) d.setUTCDate(0);
  return d;
}

export async function migrateMikeMonths() {
  await query(`
    CREATE TABLE IF NOT EXISTS referral_codes (
      user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      code TEXT NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS referrals (
      id BIGSERIAL PRIMARY KEY,
      referrer_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      referred_user_id BIGINT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      referral_code TEXT NOT NULL REFERENCES referral_codes(code),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      subscription_id TEXT,
      stripe_customer_id TEXT,
      subscription_started_at TIMESTAMPTZ,
      refund_eligible_at TIMESTAMPTZ,
      qualified_at TIMESTAMPTZ,
      status TEXT NOT NULL DEFAULT 'pending',
      reward_months INT NOT NULL DEFAULT 1,
      rejected_reason TEXT,
      CHECK (status IN ('pending','subscribed','qualified','rejected'))
    );

    CREATE INDEX IF NOT EXISTS referrals_referrer_idx ON referrals(referrer_user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS referrals_due_idx ON referrals(status, refund_eligible_at);
    CREATE UNIQUE INDEX IF NOT EXISTS referrals_subscription_idx ON referrals(subscription_id) WHERE subscription_id IS NOT NULL;

    CREATE TABLE IF NOT EXISTS mike_months_ledger (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      referral_id BIGINT NOT NULL UNIQUE REFERENCES referrals(id) ON DELETE RESTRICT,
      months INT NOT NULL CHECK (months > 0),
      earned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      redeemed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS mike_months_ledger_user_idx ON mike_months_ledger(user_id, redeemed_at, earned_at);
    ALTER TABLE users ADD COLUMN IF NOT EXISTS mike_months_covered_until TIMESTAMPTZ;
  `);
  return true;
}

export async function ensureReferralCode(userId) {
  const existing = await query('SELECT code FROM referral_codes WHERE user_id = $1', [userId]);
  if (existing.rows[0]?.code) return existing.rows[0].code;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = makeCode();
    try {
      const { rows } = await query(
        `INSERT INTO referral_codes (user_id, code) VALUES ($1, $2)
         ON CONFLICT (user_id) DO NOTHING
         RETURNING code`,
        [userId, code]
      );
      if (rows[0]?.code) return rows[0].code;
      const retry = await query('SELECT code FROM referral_codes WHERE user_id = $1', [userId]);
      if (retry.rows[0]?.code) return retry.rows[0].code;
    } catch (error) {
      if (error?.code !== '23505') throw error;
    }
  }
  throw new Error('referral_code_generation_failed');
}

export async function attributeReferral(referredUserId, referralCode) {
  const code = String(referralCode || '').trim().toUpperCase();
  if (!code) return null;

  const { rows } = await query(
    `SELECT user_id FROM referral_codes WHERE code = $1`,
    [code]
  );
  const referrerId = rows[0]?.user_id;
  if (!referrerId || String(referrerId) === String(referredUserId)) return null;

  const referred = await getUserById(referredUserId);
  if (!referred) return null;

  try {
    const result = await query(
      `INSERT INTO referrals (referrer_user_id, referred_user_id, referral_code)
       VALUES ($1, $2, $3)
       ON CONFLICT (referred_user_id) DO NOTHING
       RETURNING *`,
      [referrerId, referredUserId, code]
    );
    return result.rows[0] || null;
  } catch (error) {
    console.error('[mike-months] attribution failed:', error.message || error);
    return null;
  }
}

export async function noteSubscriptionForReferral(userId, subscription) {
  if (!subscription?.id) return null;
  const startEpoch = Number(subscription.current_period_start || subscription.start || Math.floor(Date.now() / 1000));
  const startedAt = new Date(startEpoch * 1000);
  const refundEligibleAt = new Date(startedAt.getTime() + REFUND_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const { rows } = await query(
    `UPDATE referrals
        SET subscription_id = $2,
            stripe_customer_id = $3,
            subscription_started_at = $4,
            refund_eligible_at = $5,
            status = CASE WHEN status = 'pending' THEN 'subscribed' ELSE status END
      WHERE referred_user_id = $1
        AND status IN ('pending','subscribed')
      RETURNING *`,
    [userId, String(subscription.id), subscription.customer ? String(subscription.customer) : null, startedAt, refundEligibleAt]
  );
  return rows[0] || null;
}

async function awardReferral(referralId) {
  if (!pool) throw new Error('database_not_configured');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT r.*, u.subscription_status, u.current_period_end
         FROM referrals r
         JOIN users u ON u.id = r.referred_user_id
        WHERE r.id = $1
        FOR UPDATE OF r`,
      [referralId]
    );
    const referral = rows[0];
    if (!referral) {
      await client.query('ROLLBACK');
      return null;
    }
    if (referral.status === 'qualified') {
      const existing = await client.query('SELECT * FROM mike_months_ledger WHERE referral_id = $1', [referralId]);
      await client.query('COMMIT');
      return existing.rows[0] || null;
    }

    const active = new Set(['active', 'trialing']).has(String(referral.subscription_status || ''));
    if (!active || (referral.current_period_end && new Date(referral.current_period_end) <= new Date())) {
      await client.query(
        `UPDATE referrals SET status = 'rejected', rejected_reason = 'subscription_not_active_after_refund_window'
          WHERE id = $1 AND status <> 'qualified'`,
        [referralId]
      );
      await client.query('COMMIT');
      return null;
    }

    const { rows: ledgerRows } = await client.query(
      `INSERT INTO mike_months_ledger (user_id, referral_id, months)
       VALUES ($1, $2, $3)
       ON CONFLICT (referral_id) DO NOTHING
       RETURNING *`,
      [referral.referrer_user_id, referralId, referral.reward_months]
    );

    await client.query(
      `UPDATE referrals SET status = 'qualified', qualified_at = COALESCE(qualified_at, now()) WHERE id = $1`,
      [referralId]
    );
    await client.query('COMMIT');
    return ledgerRows[0] || null;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function qualifyDueReferrals() {
  if (!pool) return { checked: 0, qualified: 0 };
  const { rows } = await query(
    `SELECT id FROM referrals
      WHERE status = 'subscribed'
        AND refund_eligible_at IS NOT NULL
        AND refund_eligible_at <= now()
      ORDER BY id
      LIMIT 100`
  );
  let qualified = 0;
  for (const row of rows) {
    try {
      const reward = await awardReferral(row.id);
      if (reward) qualified += 1;
    } catch (error) {
      console.error(`[mike-months] qualification ${row.id} failed:`, error.message || error);
    }
  }
  return { checked: rows.length, qualified };
}

export async function activateBankedMikeMonths() {
  if (!pool) return { activated: 0 };
  const { rows: users } = await query(
    `SELECT u.id, u.current_period_end, u.mike_months_covered_until,
            COALESCE(SUM(l.months) FILTER (WHERE l.redeemed_at IS NULL), 0)::int AS banked
       FROM users u
       LEFT JOIN mike_months_ledger l ON l.user_id = u.id
      WHERE COALESCE(u.subscription_status, '') NOT IN ('active','trialing')
         OR (u.current_period_end IS NOT NULL AND u.current_period_end <= now())
      GROUP BY u.id
      HAVING COALESCE(SUM(l.months) FILTER (WHERE l.redeemed_at IS NULL), 0) > 0
      LIMIT 100`
  );

  let activated = 0;
  for (const user of users) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: pending } = await client.query(
        `SELECT id, months FROM mike_months_ledger
          WHERE user_id = $1 AND redeemed_at IS NULL
          ORDER BY earned_at, id
          FOR UPDATE`,
        [user.id]
      );
      if (!pending.length) {
        await client.query('COMMIT');
        continue;
      }

      let cursor = user.mike_months_covered_until && new Date(user.mike_months_covered_until) > new Date()
        ? new Date(user.mike_months_covered_until)
        : new Date();
      for (const reward of pending) {
        for (let i = 0; i < Number(reward.months || 0); i += 1) cursor = monthLater(cursor);
        await client.query('UPDATE mike_months_ledger SET redeemed_at = now() WHERE id = $1', [reward.id]);
        activated += 1;
      }
      await client.query('UPDATE users SET mike_months_covered_until = $2 WHERE id = $1', [user.id, cursor]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      console.error(`[mike-months] activation for account ${user.id} failed:`, error.message || error);
    } finally {
      client.release();
    }
  }
  return { activated };
}

export async function startMikeMonthsScheduler() {
  if (!pool) return;
  try {
    await migrateMikeMonths();
    await qualifyDueReferrals();
    await activateBankedMikeMonths();
  } catch (error) {
    console.error('[mike-months] startup check failed:', error.message || error);
  }

  const timer = setInterval(async () => {
    try {
      const result = await qualifyDueReferrals();
      const activation = await activateBankedMikeMonths();
      if (result.checked || activation.activated) {
        console.log(`[mike-months] checked=${result.checked} qualified=${result.qualified} activated=${activation.activated}`);
      }
    } catch (error) {
      console.error('[mike-months] scheduler failed:', error.message || error);
    }
  }, SCHEDULER_INTERVAL_MS);
  timer.unref?.();
}

export async function getMikeMonthsSummary(userId) {
  const code = await ensureReferralCode(userId);
  const { rows } = await query(
    `SELECT
       (SELECT COUNT(*) FROM referrals WHERE referrer_user_id = $1 AND status = 'qualified')::int AS qualified_referrals,
       (SELECT COALESCE(SUM(months), 0) FROM mike_months_ledger WHERE user_id = $1)::int AS earned_months,
       (SELECT COALESCE(SUM(months), 0) FROM mike_months_ledger WHERE user_id = $1 AND redeemed_at IS NULL)::int AS banked_months,
       (SELECT mike_months_covered_until FROM users WHERE id = $1) AS covered_until`,
    [userId]
  );
  const summary = rows[0] || {};
  return {
    code,
    link: `${APP_URL}/?ref=${encodeURIComponent(code)}`,
    qualifiedReferrals: Number(summary.qualified_referrals || 0),
    earnedMonths: Number(summary.earned_months || 0),
    bankedMonths: Number(summary.banked_months || 0),
    coveredUntil: summary.covered_until || null,
  };
}

export { REFUND_WINDOW_DAYS };
