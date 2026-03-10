-- Migration 003 — add due_at_has_time flag to tasks
-- Distinguishes date-only deadlines from time-specific ones.
-- Date-only tasks display as just the date regardless of viewer timezone.
-- Time-specific tasks display with localized time.

ALTER TABLE tasks ADD COLUMN due_at_has_time INTEGER NOT NULL DEFAULT 0;
