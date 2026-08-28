-- Migration: Clear stuck open voice sessions
-- Created: 2026-08-27
--
-- This migration may run before the idempotent baseline schema migration on
-- a fresh database because node-pg-migrate ordering is disabled. Treat the
-- cleanup as a no-op when voice_sessions does not exist yet; the baseline
-- migration creates it immediately afterward.

DO $$
BEGIN
  IF to_regclass('public.voice_sessions') IS NOT NULL THEN
    DELETE FROM public.voice_sessions
    WHERE ended_at IS NULL
      AND started_at < now() - interval '10 minutes';
  END IF;
END $$;
