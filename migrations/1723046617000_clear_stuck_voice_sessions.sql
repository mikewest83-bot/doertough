-- Migration: Clear stuck open voice sessions
-- Created: 2026-08-27
-- 
-- Removes all open voice sessions that were created before this migration.
-- This is safe because:
-- 1. These sessions are already "stuck" and consuming budget forever
-- 2. The new code properly times them out after MAX_SESSION_SECONDS
-- 3. This just accelerates the cleanup for existing stuck sessions

DELETE FROM voice_sessions 
WHERE ended_at IS NULL 
AND started_at < now() - interval '10 minutes';
