-- Backfill all existing logs using the current per-provider, per-model rates.
-- This also fills the rate snapshot columns introduced after older logs existed.
UPDATE request_logs AS logs
SET input_cost_per_1m_tokens = costs.input_cost_per_1m_tokens,
    output_cost_per_1m_tokens = costs.output_cost_per_1m_tokens,
    cost_usd = (
      (COALESCE(logs.prompt_tokens, 0) * costs.input_cost_per_1m_tokens) +
      (COALESCE(logs.completion_tokens, 0) * costs.output_cost_per_1m_tokens)
    ) / 1000000.0
FROM provider_model_costs AS costs
WHERE logs.provider_id = costs.provider_id
  AND logs.model = costs.model
  AND (logs.prompt_tokens IS NOT NULL OR logs.completion_tokens IS NOT NULL);
