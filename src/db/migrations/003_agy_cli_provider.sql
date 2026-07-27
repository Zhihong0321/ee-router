-- Add first-class Antigravity CLI support through the gemini-to-api OpenAI bridge.
ALTER TABLE providers
  DROP CONSTRAINT IF EXISTS providers_provider_type_check;

ALTER TABLE providers
  ADD CONSTRAINT providers_provider_type_check
  CHECK (provider_type IN ('openai-compatible', 'anthropic', 'gemini', 'agy-cli', 'custom'));
