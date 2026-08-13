import { z } from "zod";

export const LIVE_VOICES = [
  { id: "ava", label: "Ava", pyai: "stock_ava_en_us", openai: "shimmer" },
  { id: "emma", label: "Emma", pyai: "stock_emma_en_gb", openai: "nova" },
  { id: "dorit", label: "Dorit", pyai: "stock_dorit_en_us", openai: "alloy" },
] as const;

export const AgentConfigSchema = z.object({
  name: z.string().trim().min(1).max(80),
  prompt: z.string().trim().min(1).max(8_000),
  voice: z.string().trim().max(64).default("ava"),
  greeting: z.string().trim().max(500).optional(),
  version: z.preprocess((value) => {
    if (value === undefined || value === null || value === "") return 1;
    if (typeof value === "string" && /^v?\d+$/i.test(value)) return Number(value.replace(/^v/i, ""));
    return value;
  }, z.number().int().min(1).max(999)).default(1),
  agentId: z.string().trim().max(64).optional(),
});

export type AgentConfig = z.infer<typeof AgentConfigSchema>;

export const DEFAULT_AGENT: AgentConfig = {
  name: "Acme Receptionist",
  prompt: [
    "You are Acme's front-desk voice agent.",
    "Be brief, warm, and professional.",
    "Never invent account details or promise refunds you cannot verify.",
    "If you do not know, say so and offer to transfer to a human.",
  ].join(" "),
  voice: "ava",
  greeting: "Hi, you've reached Acme. How can I help you today?",
  version: 1,
};

export function sanitizeAgentConfig(input: unknown): AgentConfig {
  const parsed = AgentConfigSchema.safeParse(input);
  if (!parsed.success) {
    const msg = parsed.error.issues[0]?.message ?? "invalid agent";
    throw new Error(msg);
  }
  const voice = LIVE_VOICES.some((v) => v.id === parsed.data.voice) ? parsed.data.voice : "ava";
  return { ...parsed.data, voice };
}
