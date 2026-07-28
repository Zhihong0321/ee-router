-- Add first-class Antigravity CLI support for the local EE Router runtime.
ALTER TABLE providers
  DROP CONSTRAINT IF EXISTS providers_provider_type_check;

ALTER TABLE providers
  ADD CONSTRAINT providers_provider_type_check
  CHECK (provider_type IN ('openai-compatible', 'anthropic', 'gemini', 'agy-cli', 'custom'));
