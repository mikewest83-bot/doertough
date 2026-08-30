/* Consolidate persistent user memory schema into the migration system. */
exports.shorthands = undefined;

exports.up = (pgm) => pgm.sql(`
CREATE TABLE IF NOT EXISTS user_memories (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN ('preference','goal','project','context','learned')),
  memory TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'conversation',
  importance SMALLINT NOT NULL DEFAULT 3 CHECK (importance BETWEEN 1 AND 5),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ,
  active BOOLEAN NOT NULL DEFAULT true
);
CREATE INDEX IF NOT EXISTS user_memories_user_active_idx
  ON user_memories (user_id, active, updated_at DESC);
CREATE INDEX IF NOT EXISTS user_memories_user_category_idx
  ON user_memories (user_id, category, active);
`);

exports.down = (pgm) => pgm.sql(`DROP TABLE IF EXISTS user_memories;`);
