# MCP + AI-Agent Interoperability

Expose product capabilities as tools for external agents (spec #78, #79). MCP is
added only where it provides real developer/agent value — not for marketing.

## MCP server (`tools/mcp`)
Exposes these tools, each backed by the same platform services the UI uses:

```
search_meetings      query meeting memory (embeddings + LLM answer)
get_meeting          fetch a meeting + notes + decisions + action items
search_calls         query calls (e.g. "pricing mentioned")
get_call             fetch a call + analysis
get_transcript       fetch a transcript (with evidence spans)
run_analysis         run a CallIQ analysis on a call/transcript
run_benchmark        run a provider/model benchmark
get_provider_status  provider health + latency + configured flags
get_run_trace        full provider-call trace for a run id
```

Example agent interaction:
```
Agent: "Find every customer call where pricing was mentioned."
→ search_calls({ query: "pricing" })
→ returns calls with evidence spans (source, start, end, speaker)
```

## Design
- Tools are thin wrappers over `@pyai/api` services — no duplicated logic.
- Every tool result is the same structured shape the UI renders, so the agent
  and the human see identical, evidence-linked output.
- Agent calls are recorded as normal Runs (observability, budgets, gates apply).
