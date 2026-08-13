#!/usr/bin/env tsx
/**
 * MCP server wrapping PyAI Suite API tools (spec #78, #79).
 * Stdio JSON-RPC subset so Cursor / agents can call:
 *   search_meetings, get_run_trace, run_analysis, run_benchmark, get_provider_status
 *
 * Secrets never leave the API — this process only holds API_BASE_URL.
 */

const API = (process.env.API_BASE_URL ?? "http://127.0.0.1:4000").replace(/\/$/, "");

export const TOOLS = [
  {
    name: "get_provider_status",
    description: "List configured AI providers and health",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "search_meetings",
    description: "Search Brief meeting memory",
    inputSchema: { type: "object", properties: { q: { type: "string" } }, required: ["q"] },
  },
  {
    name: "run_analysis",
    description: "Run CallIQ sales-call analysis on a transcript",
    inputSchema: {
      type: "object",
      properties: { transcriptText: { type: "string" } },
      required: ["transcriptText"],
    },
  },
  {
    name: "run_benchmark",
    description: "Run Simulator stress test",
    inputSchema: {
      type: "object",
      properties: { count: { type: "number" }, agentName: { type: "string" } },
    },
  },
  {
    name: "get_run_trace",
    description: "Fetch a workflow run + provider calls",
    inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  },
] as const;

export type ToolName = (typeof TOOLS)[number]["name"];

export async function callTool(name: ToolName, args: Record<string, unknown>): Promise<unknown> {
  if (name === "get_provider_status") {
    const [providers, health] = await Promise.all([
      fetchJson("/api/providers"),
      fetchJson("/api/providers/health"),
    ]);
    return { providers, health };
  }
  if (name === "search_meetings") {
    return fetchJson(`/api/brief/search?q=${encodeURIComponent(String(args.q ?? ""))}`);
  }
  if (name === "run_analysis") {
    return fetchJson("/api/calliq/analyze", {
      method: "POST",
      body: JSON.stringify({ transcriptText: args.transcriptText, llmProvider: "mock" }),
    });
  }
  if (name === "run_benchmark") {
    return fetchJson("/api/simulator/run", {
      method: "POST",
      body: JSON.stringify({
        count: Number(args.count ?? 5),
        agentName: String(args.agentName ?? "MCP Agent"),
        llmProvider: "mock",
      }),
    });
  }
  if (name === "get_run_trace") {
    return fetchJson(`/api/runs/${encodeURIComponent(String(args.id))}`);
  }
  throw new Error(`unknown tool: ${name}`);
}

async function fetchJson(path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return res.json();
}

/** Minimal stdio loop for MCP-style tool listing / calling. */
async function main(): Promise<void> {
  const mode = process.argv[2];
  if (mode === "list") {
    console.log(JSON.stringify({ tools: TOOLS }, null, 2));
    return;
  }
  if (mode === "call") {
    const name = process.argv[3] as ToolName;
    const args = process.argv[4] ? (JSON.parse(process.argv[4]) as Record<string, unknown>) : {};
    const result = await callTool(name, args);
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(`pyai-suite-mcp <list|call <tool> [jsonArgs]>`);
  console.log(`API_BASE_URL=${API}`);
  console.log(`Tools: ${TOOLS.map((t) => t.name).join(", ")}`);
}

const isMain = process.argv[1]?.includes("mcp");
if (isMain) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
