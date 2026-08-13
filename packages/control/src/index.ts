import type { Platform } from "@pyai/core";

/**
 * AI-native control plane (spec #125, #124, #123). An action-oriented command
 * interface that routes natural commands to platform tools. NOT a generic
 * chatbot — it parses intent and invokes concrete tool handlers.
 *
 * Example intents:
 *   "Summarize the last three meetings with Acme."  → Brief
 *   "Run my agent against 20 angry customers."       → Simulator
 *   "Find the call where pricing was objected to."   → CallIQ
 *   "Rewrite this email professionally."             → Scrib/cleanup
 */

export type CommandProduct = "calliq" | "scrib" | "brief" | "simulator" | "platform";

export interface ParsedCommand {
  product: CommandProduct;
  action: string;
  args: Record<string, string | number>;
  raw: string;
}

export interface CommandResult {
  product: CommandProduct;
  action: string;
  /** Human-readable confirmation / result summary. */
  summary: string;
  /** Structured tool call that will (or did) execute. */
  tool: string;
  params: Record<string, unknown>;
}

export type CommandHandler = (platform: Platform, cmd: ParsedCommand) => CommandResult;

/** Simple, deterministic intent matcher. Real NLU is pluggable later. */
export class ControlPlane {
  private handlers = new Map<string, CommandHandler>();

  register(product: CommandProduct, action: string, handler: CommandHandler): void {
    this.handlers.set(`${product}:${action}`, handler);
  }

  /** Parse a free-text command into a structured intent + matched handler. */
  parse(raw: string): { parsed: ParsedCommand; result: CommandResult } | { error: string } {
    const text = raw.toLowerCase();
    let parsed: ParsedCommand | null = null;

    if (/(meeting|meetings|brief)/.test(text) && /(summar|acme|last|three|3)/.test(text)) {
      const count = text.match(/(\d+)/)?.[1] ?? "3";
      const who = text.match(/with ([a-z0-9 ]+?)\.?$/)?.[1]?.trim() ?? text.match(/with ([a-z0-9 ]+)/)?.[1]?.trim() ?? "";
      parsed = { product: "brief", action: "summarize_meetings", args: { count: Number(count), account: who }, raw };
    } else if (/(agent|simulator|callers|angry|customers)/.test(text) && /(run|against|stress|test)/.test(text)) {
      const count = text.match(/(\d+)/)?.[1] ?? "20";
      const persona = /angry/.test(text) ? "angry_customer" : "default";
      parsed = { product: "simulator", action: "run_stress_test", args: { count: Number(count), persona }, raw };
    } else if (/(call|calls|pricing|objection|calliq)/.test(text)) {
      const topic = text.match(/where ([a-z ]+?) (was|mentioned)/)?.[1]?.trim() ?? "pricing";
      parsed = { product: "calliq", action: "search_calls", args: { topic }, raw };
    } else if (/(rewrite|email|professional|polish)/.test(text)) {
      parsed = { product: "scrib", action: "cleanup", args: { tone: "professional" }, raw };
    }

    if (!parsed) return { error: "could not resolve a product action from command" };
    const handler = this.handlers.get(`${parsed.product}:${parsed.action}`);
    if (!handler) return { error: `no handler for ${parsed.product}:${parsed.action}` };
    return { parsed, result: handler(/* platform injected at dispatch */ undefined as unknown as Platform, parsed) };
  }

  /** Register default handlers backed by the platform. */
  static withDefaults(platform: Platform): ControlPlane {
    const cp = new ControlPlane();
    cp.register("brief", "summarize_meetings", (p, cmd) => ({
      product: "brief",
      action: "summarize_meetings",
      tool: "search_meetings",
      params: { account: cmd.args.account, limit: cmd.args.count },
      summary: `Will summarize the last ${cmd.args.count} ${cmd.args.account ? cmd.args.account + " " : ""}meetings.`,
    }));
    cp.register("simulator", "run_stress_test", (p, cmd) => ({
      product: "simulator",
      action: "run_stress_test",
      tool: "run_benchmark",
      params: { count: cmd.args.count, persona: cmd.args.persona },
      summary: `Will run the voice-agent simulator against ${cmd.args.count} ${cmd.args.persona} callers.`,
    }));
    cp.register("calliq", "search_calls", (p, cmd) => ({
      product: "calliq",
      action: "search_calls",
      tool: "search_calls",
      params: { topic: cmd.args.topic },
      summary: `Will search calls for topic: ${cmd.args.topic}.`,
    }));
    cp.register("scrib", "cleanup", (p, cmd) => ({
      product: "scrib",
      action: "cleanup",
      tool: "cleanup_text",
      params: { tone: cmd.args.tone },
      summary: `Will rewrite the selected text in a ${cmd.args.tone} tone.`,
    }));
    void platform;
    return cp;
  }
}
