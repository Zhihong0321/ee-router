-- AGY runs inside the EE Router service; no external HTTP bridge is used.
UPDATE providers
SET base_url = 'local://agy',
    key_prefix = 'local',
    updated_at = NOW()
WHERE provider_type = 'agy-cli'
  AND base_url <> 'local://agy';
