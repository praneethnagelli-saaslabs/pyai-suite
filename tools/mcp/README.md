# PyAI Suite MCP

Wraps the local suite API as agent-callable tools.

```bash
pnpm --filter @pyai/api dev
pnpm --filter @pyai/mcp start list
pnpm --filter @pyai/mcp start call get_provider_status
pnpm --filter @pyai/mcp start call run_benchmark '{"count":5}'
```

Tools: `get_provider_status`, `search_meetings`, `run_analysis`, `run_benchmark`, `get_run_trace`.

No provider secrets in this process — only `API_BASE_URL`.
