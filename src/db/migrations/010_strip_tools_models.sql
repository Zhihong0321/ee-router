-- Add strip_tools_models column to providers table
-- Models listed here will have tools/tool_choice/parallel_tool_calls stripped from upstream requests
ALTER TABLE providers
ADD COLUMN IF NOT EXISTS strip_tools_models TEXT[] DEFAULT '{}';

COMMENT ON COLUMN providers.strip_tools_models IS 'Models that should not receive tools in upstream requests (e.g. deepseek-v4-flash mishandles tool calls)';
