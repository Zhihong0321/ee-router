-- Add provider-key expiry and first-class Gemini support.
ALTER TABLE providers
  ADD COLUMN IF NOT EXISTS api_key_expires_at TIMESTAMPTZ;

ALTER TABLE providers
  ADD COLUMN IF NOT EXISTS key_prefix TEXT;

ALTER TABLE providers
  DROP CONSTRAINT IF EXISTS providers_provider_type_check;

ALTER TABLE providers
  ADD CONSTRAINT providers_provider_type_check
  CHECK (provider_type IN ('openai-compatible', 'anthropic', 'gemini', 'custom'));
