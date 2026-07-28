-- Each provider can expose models with different input/output prices.
CREATE TABLE IF NOT EXISTS provider_model_costs (
    provider_id                  UUID NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
    model                        TEXT NOT NULL,
    input_cost_per_1m_tokens     NUMERIC(20, 8) NOT NULL DEFAULT 0,
    output_cost_per_1m_tokens    NUMERIC(20, 8) NOT NULL DEFAULT 0,
    updated_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (provider_id, model)
);

ALTER TABLE request_logs
    ADD COLUMN IF NOT EXISTS input_cost_per_1m_tokens NUMERIC(20, 8),
    ADD COLUMN IF NOT EXISTS output_cost_per_1m_tokens NUMERIC(20, 8);
