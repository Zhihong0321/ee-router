-- Provider pricing is configured in USD per one million tokens.
ALTER TABLE providers
  ADD COLUMN IF NOT EXISTS input_cost_per_1m_tokens NUMERIC(20, 8) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS output_cost_per_1m_tokens NUMERIC(20, 8) NOT NULL DEFAULT 0;

-- Request logs retain the normalized usage and the calculated cost at request time.
ALTER TABLE request_logs
  ADD COLUMN IF NOT EXISTS cost_usd NUMERIC(20, 10);

CREATE INDEX IF NOT EXISTS idx_request_logs_cost ON request_logs (created_at DESC, cost_usd)
  WHERE cost_usd IS NOT NULL;
