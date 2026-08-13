import { z } from "zod";
import { shortId } from "./util/ids.js";
import { logger } from "./util/logger.js";

/**
 * Versioned prompt registry (spec #83). Prompts are NEVER hardcoded randomly
 * across the codebase. Each prompt has id + version + input/output schema +
 * template + model policy. Every run records the prompt version so historical
 * runs are reproducible (spec #85).
 */

export const PromptDefSchema = z.object({
  id: z.string(),
  version: z.string(),
  description: z.string(),
  inputSchema: z.record(z.unknown()).optional(),
  outputSchema: z.record(z.unknown()).optional(),
  template: z.string(),
  modelPolicy: z.string().optional(), // e.g. "cheapest", "best_quality", or a provider id
});

export type PromptDef = z.infer<typeof PromptDefSchema>;

export class PromptRegistry {
  private prompts = new Map<string, PromptDef>(); // key: `${id}@${version}`

  register(def: PromptDef): void {
    this.prompts.set(`${def.id}@${def.version}`, def);
    logger.debug("prompt: registered", { id: def.id, version: def.version });
  }

  get(id: string, version?: string): PromptDef | undefined {
    if (version) return this.prompts.get(`${id}@${version}`);
    // latest version (lexicographic; use semver-friendly versions like v1,v2,v3)
    const versions = Array.from(this.prompts.keys()).filter((k) => k.startsWith(`${id}@`)).sort();
    return versions.length ? this.prompts.get(versions[versions.length - 1]!) : undefined;
  }

  /** Render a prompt template with variables. Variables use {{name}} syntax. */
  render(id: string, variables: Record<string, string>, version?: string): { text: string; version: string } {
    const def = this.get(id, version);
    if (!def) throw new Error(`prompt ${id}@${version ?? "latest"} not found`);
    const text = def.template.replace(/\{\{(\w+)\}\}/g, (_, k: string) => variables[k] ?? "");
    return { text, version: def.version };
  }

  list(): PromptDef[] {
    return Array.from(this.prompts.values());
  }
}

export function makePrompt(def: Omit<PromptDef, "id" | "version"> & { id: string; version: string }): PromptDef {
  // Validate shape at registration time (cheap, fails early — spec #112).
  return PromptDefSchema.parse(def);
}

void shortId;
