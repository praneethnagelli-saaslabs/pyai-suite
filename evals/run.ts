#!/usr/bin/env tsx
/**
 * Golden eval runner — `pnpm eval`
 * Runs offline against MockProvider. No real credentials required.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createPlatform } from "@pyai/core";
import { buildCallIQWorkflow } from "@pyai/calliq";
import { buildScribWorkflow, localCleanup } from "@pyai/scrib";
import { buildBriefWorkflow } from "@pyai/brief";
import { buildSimulatorWorkflow } from "@pyai/simulator";

interface CaseFile {
  name: string;
  input: Record<string, unknown>;
  expected: Record<string, unknown>;
}

function loadCases(dir: string): CaseFile[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")) as CaseFile);
}

async function main() {
  // When run via `pnpm --filter @pyai/evals`, cwd is the evals package root.
  const root = process.cwd().endsWith("evals") ? process.cwd() : join(process.cwd(), "evals");
  const platform = createPlatform({ includeMock: true });
  let passed = 0;
  let failed = 0;

  // CallIQ
  for (const c of loadCases(join(root, "calliq"))) {
    const { def, getArtifact } = buildCallIQWorkflow(platform, {
      transcriptText: String(c.input.transcriptText ?? ""),
      llmProvider: "mock",
    });
    await platform.engine.execute(def);
    const art = getArtifact();
    const text = JSON.stringify(art.analysis).toLowerCase();
    const must = (c.expected.mustMention as string[]) ?? [];
    const ok = must.every((m) => text.includes(m.toLowerCase()));
    report("calliq", c.name, ok);
    ok ? passed++ : failed++;
  }

  // Scrib
  for (const c of loadCases(join(root, "scrib"))) {
    const raw = String(c.input.rawText ?? "");
    const cleaned = localCleanup(raw, (c.input.mode as never) ?? "light");
    const mustNot = (c.expected.mustNotContain as string[]) ?? [];
    const must = (c.expected.mustContain as string[]) ?? [];
    const ok =
      mustNot.every((m) => !cleaned.toLowerCase().includes(` ${m} `) && !cleaned.toLowerCase().startsWith(`${m} `)) &&
      must.every((m) => cleaned.toLowerCase().includes(m.toLowerCase()));
    // Also exercise full workflow
    const { def } = buildScribWorkflow(platform, {
      rawText: raw,
      mode: c.input.mode as never,
      appName: String(c.input.appName ?? ""),
      cleanupProvider: "mock",
    });
    await platform.engine.execute(def);
    report("scrib", c.name, ok);
    ok ? passed++ : failed++;
  }

  // Brief
  for (const c of loadCases(join(root, "brief"))) {
    const { def, getArtifact } = buildBriefWorkflow(platform, {
      transcriptText: String(c.input.transcriptText ?? ""),
      mode: c.input.mode as never,
      llmProvider: "mock",
    });
    await platform.engine.execute(def);
    const notes = getArtifact().notes;
    const blob = JSON.stringify(notes).toLowerCase();
    const needDec = (c.expected.decisionContains as string[] | undefined) ?? [];
    const needOwn = (c.expected.actionOwnerContains as string[] | undefined) ?? [];
    const ok = needDec.every((x) => blob.includes(x.toLowerCase())) && needOwn.every((x) => blob.includes(x.toLowerCase()));
    report("brief", c.name, ok);
    ok ? passed++ : failed++;
  }

  // Simulator
  for (const c of loadCases(join(root, "simulator"))) {
    const { def, getArtifact } = buildSimulatorWorkflow(platform, {
      personaId: String(c.input.personaId ?? "angry_customer"),
      count: Number(c.input.count ?? 5),
      concurrency: Number(c.input.concurrency ?? 5),
      llmProvider: "mock",
    });
    await platform.engine.execute(def);
    const card = getArtifact();
    const passRate = card.tests ? card.passed / card.tests : 0;
    const ok = Boolean(c.expected.mustProduceCard) && passRate >= Number(c.expected.minPassRate ?? 0);
    report("simulator", c.name, ok);
    ok ? passed++ : failed++;
  }

  console.log(`\nEvals: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

function report(product: string, name: string, ok: boolean) {
  console.log(`${ok ? "✓" : "✗"} ${product.padEnd(12)} ${name}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
