-- Add stable property_key for cross-run identity.
-- Format: "{province}:{pid}" e.g. "NS:00558857" or "NB:PID-12345"
-- Fallback: "{province}:{sha256(address)}" when pid unavailable.

ALTER TABLE hunter_properties ADD COLUMN property_key TEXT;

CREATE INDEX IF NOT EXISTS idx_hunter_properties_key
  ON hunter_properties(property_key, created_at DESC) WHERE is_deleted = 0;
