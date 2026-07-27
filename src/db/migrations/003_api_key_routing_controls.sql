-- Persist API-key routing controls for the management console.
ALTER TABLE api_keys
  ADD COLUMN IF NOT EXISTS priority INTEGER NOT NULL DEFAULT 0;

ALTER TABLE api_keys
  ADD COLUMN IF NOT EXISTS provider_ids UUID[] NOT NULL DEFAULT '{}';

ALTER TABLE api_keys
  ADD COLUMN IF NOT EXISTS allowed_models TEXT[] NOT NULL DEFAULT '{}';
