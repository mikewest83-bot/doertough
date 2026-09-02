// ── Owner conversation viewer ────────────────────────────
// Lets Mike watch conversations as they happen and read recent ones back.
//
// TEXT is a pure read. `conversations` and `messages` already hold every
// text turn; nothing new is collected to make this work. The only thing
// this file adds on that side is a way to look at it.
//
// VOICE IS NOT STORED TODAY. `voice_sessions` holds timing and billing
// columns only - no transcript, no audio. The Realtime API does produce
// transcripts, but they land in the browser (src/main.jsx handles
// input_audio_transcription.completed and response.audio_transcript.done)
// and live in React state until the tab closes. Capturing them server-side
// is NEW collection, so it sits behind its own flag, separate from the text
// viewer, and is off until VOICE_TRANSCRIPTS=1.
//
// Neither half authorizes anything. Callers must have already established
// that the requester is the owner - the routes do that with isOwner().
import { query } from './db.mjs';

// A conversation counts as live if it has moved this recently. Used only to
// label rows in the viewer, never to gate anything.
const LIVE_WINDOW_SECONDS = Number(process.env.OWNER_LIVE_WINDOW_SECONDS) > 0
  ? Number(process.env.OWNER_LIVE_WINDOW_SECONDS)
  : 120;

const VOICE_TRANSCRIPTS = String(process.env.VOICE_TRANSCRIPTS || '').trim() === '1';
export const voiceTranscriptsEnabled = () => VOICE_TRANSCRIPTS;

const clamp = (value, fallback, min, max) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.trunc(n))) : fallback;
};

// ── Text: read what is already there ─────────────────────

// Recent conversations, newest activity first, with just enough to decide
// which one to open: who, how long, how many turns, and the latest line.
export async function listConversations({ minutes = 1440, limit = 40 } = {}) {
  const mins = clamp(minutes, 1440, 1, 60 * 24 * 30);
  const max = clamp(limit, 40, 1, 200);
  const { rows } = await query(`
    SELECT c.id,
           c.user_id,
           u.name,
           u.email,
           u.plan,
           c.created_at                                  AS started_at,
           MAX(m.created_at)                             AS last_at,
           COUNT(m.id)::int                              AS turns,
           COUNT(*) FILTER (WHERE m.role = 'user')::int  AS user_turns,
           (MAX(m.created_at) >= now() - ($1 || ' seconds')::interval) AS live,
           (ARRAY_AGG(m.content ORDER BY m.created_at DESC))[1]        AS last_message,
           (ARRAY_AGG(m.role    ORDER BY m.created_at DESC))[1]        AS last_role
      FROM conversations c
      JOIN users u ON u.id = c.user_id
      LEFT JOIN messages m ON m.conversation_id = c.id
     WHERE COALESCE(m.created_at, c.created_at) >= now() - ($2 || ' minutes')::interval
     GROUP BY c.id, c.user_id, u.name, u.email, u.plan, c.created_at
     ORDER BY COALESCE(MAX(m.created_at), c.created_at) DESC
     LIMIT $3
  `, [String(LIVE_WINDOW_SECONDS), String(mins), max]);

  return {
    liveWindowSeconds: LIVE_WINDOW_SECONDS,
    minutes: mins,
    conversations: rows.map((row) => ({
      id: Number(row.id),
      user: { id: Number(row.user_id), name: row.name || null, email: row.email || null, plan: row.plan || null },
      startedAt: row.started_at,
      lastAt: row.last_at,
      turns: row.turns || 0,
      userTurns: row.user_turns || 0,
      live: Boolean(row.live),
      lastRole: row.last_role || null,
      // Trimmed here rather than in the UI so a long paste never rides the
      // list payload just to be cut off on screen.
      preview: row.last_message ? String(row.last_message).slice(0, 180) : null,
    })),
  };
}

// Every turn in one conversation, oldest first, plus who it belongs to.
export async function getConversation(id, { limit = 300 } = {}) {
  const conversationId = Number(id);
  if (!Number.isInteger(conversationId) || conversationId <= 0) return null;
  const max = clamp(limit, 300, 1, 1000);

  const [head, body] = await Promise.all([
    query(`SELECT c.id, c.created_at, u.id user_id, u.name, u.email, u.plan
             FROM conversations c JOIN users u ON u.id = c.user_id
            WHERE c.id = $1`, [conversationId]),
    query(`SELECT id, role, content, created_at FROM messages
            WHERE conversation_id = $1 ORDER BY created_at ASC, id ASC LIMIT $2`, [conversationId, max]),
  ]);
  const row = head.rows[0];
  if (!row) return null;

  return {
    id: Number(row.id),
    startedAt: row.created_at,
    user: { id: Number(row.user_id), name: row.name || null, email: row.email || null, plan: row.plan || null },
    channel: 'text',
    messages: body.rows.map((m) => ({
      id: Number(m.id), role: m.role, content: m.content, at: m.created_at,
    })),
    truncated: body.rows.length >= max,
  };
}

// ── User directory: who to check on ──────────────────────

// The owner's list of users, most-recently-active first: who they are, how
// active they've been, and whether they're moving right now. "live" is the
// same recency label the conversation list uses - a poll target, not a
// stream. This reads users and their message counts; it collects nothing.
export async function listUsers({ minutes = 43200, limit = 100 } = {}) {
  const mins = clamp(minutes, 43200, 1, 60 * 24 * 90);
  const max = clamp(limit, 100, 1, 500);
  const { rows } = await query(`
    SELECT u.id,
           u.name,
           u.email,
           u.plan,
           u.role,
           u.subscription_status,
           u.created_at,
           u.last_seen_at,
           COUNT(DISTINCT c.id)::int                                   AS conversations,
           COUNT(m.id)::int                                            AS turns,
           MAX(m.created_at)                                           AS last_message_at,
           (u.last_seen_at >= now() - ($1 || ' seconds')::interval)    AS live
      FROM users u
      LEFT JOIN conversations c ON c.user_id = u.id
      LEFT JOIN messages m ON m.conversation_id = c.id
     WHERE u.last_seen_at >= now() - ($2 || ' minutes')::interval
        OR u.created_at   >= now() - ($2 || ' minutes')::interval
     GROUP BY u.id
     ORDER BY (u.last_seen_at >= now() - ($1 || ' seconds')::interval) DESC,
              u.last_seen_at DESC NULLS LAST
     LIMIT $3
  `, [String(LIVE_WINDOW_SECONDS), String(mins), max]);

  return {
    liveWindowSeconds: LIVE_WINDOW_SECONDS,
    users: rows.map((row) => ({
      id: Number(row.id),
      name: row.name || null,
      email: row.email || null,
      plan: row.plan || null,
      role: row.role || null,
      status: row.subscription_status || null,
      createdAt: row.created_at,
      lastSeenAt: row.last_seen_at,
      lastMessageAt: row.last_message_at,
      conversations: row.conversations || 0,
      turns: row.turns || 0,
      live: Boolean(row.live),
    })),
  };
}

// One user's recent conversations - what you get when you click their row.
// Reuses the same conversation shape the main list returns.
export async function getUserConversations(userId, { limit = 25 } = {}) {
  const uid = Number(userId);
  if (!Number.isInteger(uid) || uid <= 0) return null;
  const max = clamp(limit, 25, 1, 200);

  const [head, list] = await Promise.all([
    query('SELECT id, name, email, plan, role, subscription_status, created_at, last_seen_at FROM users WHERE id = $1', [uid]),
    query(`
      SELECT c.id,
             c.created_at                                  AS started_at,
             MAX(m.created_at)                             AS last_at,
             COUNT(m.id)::int                              AS turns,
             (MAX(m.created_at) >= now() - ($1 || ' seconds')::interval) AS live,
             (ARRAY_AGG(m.content ORDER BY m.created_at DESC))[1]        AS last_message,
             (ARRAY_AGG(m.role    ORDER BY m.created_at DESC))[1]        AS last_role
        FROM conversations c
        LEFT JOIN messages m ON m.conversation_id = c.id
       WHERE c.user_id = $2
       GROUP BY c.id
       ORDER BY COALESCE(MAX(m.created_at), c.created_at) DESC
       LIMIT $3
    `, [String(LIVE_WINDOW_SECONDS), uid, max]),
  ]);
  const u = head.rows[0];
  if (!u) return null;

  return {
    user: {
      id: Number(u.id), name: u.name || null, email: u.email || null, plan: u.plan || null,
      role: u.role || null, status: u.subscription_status || null,
      createdAt: u.created_at, lastSeenAt: u.last_seen_at,
    },
    conversations: list.rows.map((row) => ({
      id: Number(row.id),
      startedAt: row.started_at,
      lastAt: row.last_at,
      turns: row.turns || 0,
      live: Boolean(row.live),
      lastRole: row.last_role || null,
      preview: row.last_message ? String(row.last_message).slice(0, 180) : null,
    })),
  };
}

// ── Voice: new collection, off by default ────────────────

let voiceSchema = null;
async function ensureVoiceSchema() {
  if (!voiceSchema) {
    voiceSchema = query(`
      CREATE TABLE IF NOT EXISTS voice_transcripts (
        id          BIGSERIAL PRIMARY KEY,
        user_id     BIGINT REFERENCES users (id) ON DELETE CASCADE,
        session_key TEXT,
        role        TEXT NOT NULL,
        content     TEXT NOT NULL,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS voice_transcripts_session_idx
        ON voice_transcripts (session_key, created_at);
      CREATE INDEX IF NOT EXISTS voice_transcripts_created_idx
        ON voice_transcripts (created_at DESC);
    `).catch((error) => { voiceSchema = null; throw error; });
  }
  return voiceSchema;
}

// Called by the client as Realtime transcripts arrive. Fire-and-forget from
// the caller's side: a failure here must never disturb a live call.
export async function recordVoiceTurn({ userId = null, sessionKey = null, role, content } = {}) {
  if (!VOICE_TRANSCRIPTS) return { stored: false, reason: 'disabled' };
  const text = String(content || '').trim();
  const speaker = role === 'user' ? 'user' : 'assistant';
  if (!text) return { stored: false, reason: 'empty' };
  try {
    await ensureVoiceSchema();
    await query(
      'INSERT INTO voice_transcripts (user_id, session_key, role, content) VALUES ($1, $2, $3, $4)',
      [userId, sessionKey ? String(sessionKey).slice(0, 120) : null, speaker, text.slice(0, 8000)]
    );
    return { stored: true };
  } catch (error) {
    console.error('[owner-conversations] voice turn failed:', error?.message || error);
    return { stored: false, reason: 'error' };
  }
}

// Recent voice calls, shaped like listConversations so one viewer renders both.
export async function listVoiceCalls({ minutes = 1440, limit = 40 } = {}) {
  if (!VOICE_TRANSCRIPTS) return { enabled: false, calls: [] };
  const mins = clamp(minutes, 1440, 1, 60 * 24 * 30);
  const max = clamp(limit, 40, 1, 200);
  try {
    await ensureVoiceSchema();
    const { rows } = await query(`
      SELECT t.session_key,
             MIN(t.user_id)                                   AS user_id,
             MIN(u.name)                                      AS name,
             MIN(u.email)                                     AS email,
             MIN(t.created_at)                                AS started_at,
             MAX(t.created_at)                                AS last_at,
             COUNT(*)::int                                    AS turns,
             (MAX(t.created_at) >= now() - ($1 || ' seconds')::interval) AS live,
             (ARRAY_AGG(t.content ORDER BY t.created_at DESC))[1]        AS last_message
        FROM voice_transcripts t
        LEFT JOIN users u ON u.id = t.user_id
       WHERE t.created_at >= now() - ($2 || ' minutes')::interval
       GROUP BY t.session_key
       ORDER BY MAX(t.created_at) DESC
       LIMIT $3
    `, [String(LIVE_WINDOW_SECONDS), String(mins), max]);
    return {
      enabled: true,
      liveWindowSeconds: LIVE_WINDOW_SECONDS,
      calls: rows.map((row) => ({
        sessionKey: row.session_key,
        user: { id: row.user_id ? Number(row.user_id) : null, name: row.name || null, email: row.email || null },
        startedAt: row.started_at,
        lastAt: row.last_at,
        turns: row.turns || 0,
        live: Boolean(row.live),
        preview: row.last_message ? String(row.last_message).slice(0, 180) : null,
      })),
    };
  } catch (error) {
    console.error('[owner-conversations] voice list failed:', error?.message || error);
    return { enabled: true, error: 'unavailable', calls: [] };
  }
}

// Every transcribed turn in one voice call.
export async function getVoiceCall(sessionKey, { limit = 300 } = {}) {
  if (!VOICE_TRANSCRIPTS) return null;
  const key = String(sessionKey || '').trim();
  if (!key) return null;
  const max = clamp(limit, 300, 1, 1000);
  try {
    await ensureVoiceSchema();
    const { rows } = await query(`
      SELECT t.id, t.role, t.content, t.created_at, t.user_id, u.name, u.email
        FROM voice_transcripts t LEFT JOIN users u ON u.id = t.user_id
       WHERE t.session_key = $1 ORDER BY t.created_at ASC, t.id ASC LIMIT $2
    `, [key, max]);
    if (!rows.length) return null;
    const first = rows[0];
    return {
      sessionKey: key,
      channel: 'voice',
      startedAt: first.created_at,
      user: { id: first.user_id ? Number(first.user_id) : null, name: first.name || null, email: first.email || null },
      messages: rows.map((m) => ({ id: Number(m.id), role: m.role, content: m.content, at: m.created_at })),
      truncated: rows.length >= max,
    };
  } catch (error) {
    console.error('[owner-conversations] voice read failed:', error?.message || error);
    return null;
  }
}
