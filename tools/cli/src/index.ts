#!/usr/bin/env tsx
/**
 * ai-suite CLI (spec #29)
 *
 *   ai-suite doctor
 *   ai-suite setup [--sandbox]
 *   ai-suite playground
 *   ai-suite demo
 *   ai-suite benchmark
 *   ai-suite providers
 *   ai-suite run
 */

import { createPlatform, Capability, mintPyAISandboxKey, PYAI_DEFAULT_BASE_URL } from "@pyai/core";
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const API = (process.env.API_BASE_URL ?? "http://localhost:4000").replace(/\/$/, "");

type Check = { name: string; ok: boolean; detail: string };

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return (await res.json()) as T;
}

function hasCmd(cmd: string): boolean {
  const r = spawnSync(cmd, ["--version"], { encoding: "utf8" });
  return r.status === 0;
}

async function doctor(): Promise<number> {
  const checks: Check[] = [];
  checks.push({ name: "Docker", ok: hasCmd("docker"), detail: hasCmd("docker") ? "available" : "not found" });
  checks.push({
    name: "Node",
    ok: Number(process.versions.node.split(".")[0]) >= 20,
    detail: `v${process.versions.node}`,
  });
  checks.push({
    name: ".env",
    ok: existsSync(resolve(process.cwd(), ".env")) || existsSync(resolve(process.cwd(), ".env.example")),
    detail: existsSync(resolve(process.cwd(), ".env")) ? "present" : "copy .env.example → .env",
  });

  try {
    const health = await fetchJson<{ status: string; providers: string[] }>("/health");
    checks.push({ name: "API", ok: health.status === "ok", detail: `${API} · ${health.providers.join(", ")}` });
  } catch (e) {
    checks.push({ name: "API", ok: false, detail: `unreachable (${String(e)})` });
  }

  const platform = createPlatform({
    includeMock: true,
    pyai: { apiKey: process.env.PYAI_API_KEY, baseUrl: process.env.PYAI_BASE_URL },
    openai: { apiKey: process.env.OPENAI_API_KEY },
    gemini: { apiKey: process.env.GEMINI_API_KEY },
  });
  for (const p of platform.registry.list()) {
    const configured = p.isConfigured() || p.id === "mock";
    checks.push({
      name: `Provider ${p.id}`,
      ok: configured,
      detail: configured ? p.capabilities.slice(0, 4).join(", ") : "missing credentials — try: ai-suite setup --sandbox",
    });
  }

  // Live PyAI whoami when a key is present (docs: GET /v1/me).
  if (process.env.PYAI_API_KEY) {
    try {
      const origin = (process.env.PYAI_BASE_URL ?? PYAI_DEFAULT_BASE_URL).replace(/\/v1$/, "").replace(/\/$/, "");
      const t0 = Date.now();
      const r = await fetch(`${origin}/v1/me`, {
        headers: { Authorization: `Bearer ${process.env.PYAI_API_KEY}` },
      });
      checks.push({
        name: "PyAI /v1/me",
        ok: r.ok,
        detail: r.ok ? `healthy ${Date.now() - t0}ms` : `HTTP ${r.status}`,
      });
    } catch (e) {
      checks.push({ name: "PyAI /v1/me", ok: false, detail: String(e) });
    }
  }

  let failed = 0;
  for (const c of checks) {
    const mark = c.ok ? "✓" : "✗";
    console.log(`${mark} ${c.name.padEnd(18)} ${c.detail}`);
    if (!c.ok) failed += 1;
  }
  console.log("Docs: https://docs.pyai.com/quickstart");
  return failed === 0 ? 0 : 1;
}

function upsertEnvKey(file: string, key: string, value: string): void {
  if (!existsSync(file)) {
    writeFileSync(file, `${key}=${value}\n`, "utf8");
    return;
  }
  const raw = readFileSync(file, "utf8");
  const re = new RegExp(`^${key}=.*$`, "m");
  if (re.test(raw)) {
    writeFileSync(file, raw.replace(re, `${key}=${value}`), "utf8");
  } else {
    appendFileSync(file, `\n${key}=${value}\n`, "utf8");
  }
}

async function setup(args: string[]): Promise<number> {
  if (!existsSync(".env") && existsSync(".env.example")) {
    spawnSync("cp", [".env.example", ".env"], { stdio: "inherit" });
    console.log("Created .env from .env.example");
  }

  if (args.includes("--sandbox")) {
    // Instant sandbox key — no signup/card. https://docs.pyai.com/quickstart
    const { apiKey, keyPrefix } = await mintPyAISandboxKey(process.env.PYAI_BASE_URL ?? PYAI_DEFAULT_BASE_URL);
    upsertEnvKey(".env", "PYAI_API_KEY", apiKey);
    upsertEnvKey(".env", "PYAI_BASE_URL", process.env.PYAI_BASE_URL ?? PYAI_DEFAULT_BASE_URL);
    console.log(`PyAI sandbox key written to .env (${keyPrefix})`);
    console.log("Verify: curl https://api.pyai.com/v1/me -H \"Authorization: Bearer $PYAI_API_KEY\"");
  }

  console.log("Install deps: pnpm install");
  console.log("Start stack:  docker compose up");
  console.log("Or locally:   pnpm --filter @pyai/api dev & pnpm --filter @pyai/web dev");
  console.log("Open:         http://localhost:3000");
  console.log("PyAI docs:    https://docs.pyai.com/quickstart");
  return 0;
}

async function providers(): Promise<number> {
  const data = await fetchJson<{ providers: Array<{ id: string; name: string; configured: boolean; capabilities: string[] }> }>("/api/providers");
  for (const p of data.providers) {
    console.log(`${p.configured || p.id === "mock" ? "✓" : "·"} ${p.id.padEnd(12)} ${p.name}  [${p.capabilities.join(", ")}]`);
  }
  return 0;
}

async function playground(args: string[]): Promise<number> {
  const capability = args[0] ?? "llm";
  const input = args.slice(1).join(" ") || "ping";
  const provider = process.env.PROVIDER ?? "mock";
  const out = await fetchJson<{ provider: string; output: string; latencyMs: number }>(
    "/api/playground/run",
    { method: "POST", body: JSON.stringify({ capability, provider, input }) },
  );
  console.log(`provider=${out.provider} latency=${out.latencyMs}ms`);
  console.log(out.output);
  return 0;
}

async function demo(): Promise<number> {
  const sample = await fetchJson<{ transcriptText: string }>("/api/sample/calliq");
  const out = await fetchJson<{ status: string; runId: string; durationMs: number; analysis: { dealHealthScore?: number; summary?: string } }>(
    "/api/calliq/analyze",
    {
      method: "POST",
      body: JSON.stringify({ transcriptText: sample.transcriptText, llmProvider: "mock", sttProvider: "mock" }),
    },
  );
  console.log(`status=${out.status} run=${out.runId} duration=${out.durationMs}ms`);
  console.log(`dealHealth=${out.analysis?.dealHealthScore ?? "n/a"}`);
  console.log(out.analysis?.summary ?? "");
  return out.status === "SUCCEEDED" || out.status === "PARTIAL" ? 0 : 1;
}

async function benchmark(): Promise<number> {
  const providersList = ["mock"];
  const capability = Capability.LLM;
  console.log(`Benchmark capability=${capability} providers=${providersList.join(",")}`);
  for (const provider of providersList) {
    const t0 = Date.now();
    const out = await fetchJson<{ latencyMs: number; output: string }>(
      "/api/playground/run",
      { method: "POST", body: JSON.stringify({ capability, provider, input: "Say OK" }) },
    );
    console.log(`${provider.padEnd(10)} latency=${out.latencyMs}ms wall=${Date.now() - t0}ms`);
  }
  return 0;
}

async function runCmd(args: string[]): Promise<number> {
  if (args[0] === "calliq") return demo();
  console.log("Usage: ai-suite run calliq");
  return 1;
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const handlers: Record<string, (a: string[]) => Promise<number>> = {
    doctor: async () => doctor(),
    setup: setup,
    providers: async () => providers(),
    playground: playground,
    demo: async () => demo(),
    benchmark: async () => benchmark(),
    run: runCmd,
  };
  if (!cmd || !(cmd in handlers)) {
    console.log(`ai-suite <doctor|setup [--sandbox]|providers|playground|demo|benchmark|run>`);
    process.exit(cmd ? 1 : 0);
  }
  const code = await handlers[cmd]!(rest);
  process.exit(code);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
