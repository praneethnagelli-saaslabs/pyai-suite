import { DEFAULT_AGENT, LIVE_VOICES, type AgentConfig } from "./agent.js";
import { BUILTIN_SCENARIOS, sanitizeScenario, type Scenario } from "./scenarios.js";

const MAX_AGENTS = 50;
const MAX_VERSIONS = 40;
const MAX_SCENARIOS = 50;

export const PERSONALITIES = [
  "professional",
  "friendly",
  "concise",
  "empathetic",
  "confident",
  "persuasive",
  "casual",
] as const;

export type Personality = (typeof PERSONALITIES)[number];

export interface AgentVersion {
  version: number;
  name: string;
  prompt: string;
  voice: string;
  greeting: string;
  personality: Personality;
  personalityNotes: string;
  role: string;
  createdAt: number;
  note: string;
}

export interface StoredAgent {
  id: string;
  name: string;
  description: string;
  role: string;
  industry: string;
  language: string;
  personality: Personality;
  personalityNotes: string;
  voice: string;
  greeting: string;
  prompt: string;
  activeVersion: number;
  versions: AgentVersion[];
  createdAt: number;
  updatedAt: number;
}

export interface AgentDraft {
  name?: string;
  description?: string;
  role?: string;
  industry?: string;
  language?: string;
  personality?: string;
  personalityNotes?: string;
  voice?: string;
  greeting?: string;
  prompt?: string;
  note?: string;
}

function clip(value: unknown, max: number, fallback = ""): string {
  return String(value ?? fallback).replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max);
}

function id(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function personalityOf(value: unknown): Personality {
  const v = clip(value, 32).toLowerCase();
  return (PERSONALITIES as readonly string[]).includes(v) ? (v as Personality) : "professional";
}

function voiceOf(value: unknown): string {
  const v = clip(value, 64, "ava");
  return LIVE_VOICES.some((x) => x.id === v) ? v : "ava";
}

function snapshot(agent: StoredAgent, note: string): AgentVersion {
  return {
    version: agent.activeVersion,
    name: agent.name,
    prompt: agent.prompt,
    voice: agent.voice,
    greeting: agent.greeting,
    personality: agent.personality,
    personalityNotes: agent.personalityNotes,
    role: agent.role,
    createdAt: Date.now(),
    note: clip(note, 120) || `Snapshot v${agent.activeVersion}`,
  };
}

function seedAgent(): StoredAgent {
  const now = Date.now();
  const agent: StoredAgent = {
    id: "agt_acme",
    name: DEFAULT_AGENT.name,
    description: "Front-desk voice agent for inbound support and routing.",
    role: "Receptionist",
    industry: "SaaS",
    language: "en",
    personality: "professional",
    personalityNotes: "Warm, brief, never invent account details.",
    voice: DEFAULT_AGENT.voice,
    greeting: DEFAULT_AGENT.greeting ?? "",
    prompt: DEFAULT_AGENT.prompt,
    activeVersion: 1,
    versions: [],
    createdAt: now,
    updatedAt: now,
  };
  agent.versions = [snapshot(agent, "Initial version")];
  return agent;
}

export function agentToLiveConfig(agent: StoredAgent, version?: number): AgentConfig {
  const snap = version
    ? agent.versions.find((v) => v.version === version)
    : agent.versions.find((v) => v.version === agent.activeVersion);
  const src = snap ?? agent;
  return {
    name: src.name,
    prompt: composePrompt(src),
    voice: src.voice,
    greeting: "greeting" in src ? src.greeting : agent.greeting,
    version: snap?.version ?? agent.activeVersion,
    agentId: agent.id,
  };
}

function composePrompt(src: {
  prompt: string;
  personality: string;
  personalityNotes?: string;
  role?: string;
}): string {
  const bits = [
    src.prompt,
    src.role ? `Role: ${src.role}.` : "",
    `Personality: ${src.personality}.`,
    src.personalityNotes ? `Voice notes: ${src.personalityNotes}` : "",
  ].filter(Boolean);
  return bits.join(" ").slice(0, 8_000);
}

export function createSimulatorCatalog() {
  const agents = new Map<string, StoredAgent>();
  const scenarios = new Map<string, Scenario>();

  const seeded = seedAgent();
  agents.set(seeded.id, seeded);
  for (const scn of BUILTIN_SCENARIOS) scenarios.set(scn.id, scn);

  return {
    listAgents(): StoredAgent[] {
      return [...agents.values()].sort((a, b) => b.updatedAt - a.updatedAt);
    },
    getAgent(agentId: string): StoredAgent | undefined {
      return agents.get(clip(agentId, 64));
    },
    createAgent(draft: AgentDraft): StoredAgent {
      if (agents.size >= MAX_AGENTS) throw new Error("Agent limit reached.");
      const now = Date.now();
      const agent: StoredAgent = {
        id: id("agt"),
        name: clip(draft.name, 80) || "Untitled agent",
        description: clip(draft.description, 240),
        role: clip(draft.role, 80) || "Voice agent",
        industry: clip(draft.industry, 80),
        language: clip(draft.language, 16, "en") || "en",
        personality: personalityOf(draft.personality),
        personalityNotes: clip(draft.personalityNotes, 500),
        voice: voiceOf(draft.voice),
        greeting: clip(draft.greeting, 500) || "Hi, how can I help you today?",
        prompt: clip(draft.prompt, 8_000) || DEFAULT_AGENT.prompt,
        activeVersion: 1,
        versions: [],
        createdAt: now,
        updatedAt: now,
      };
      agent.versions = [snapshot(agent, clip(draft.note, 120) || "v1")];
      agents.set(agent.id, agent);
      return agent;
    },
    updateAgent(agentId: string, draft: AgentDraft): StoredAgent {
      const agent = agents.get(clip(agentId, 64));
      if (!agent) throw new Error("Agent not found.");
      const nextName = clip(draft.name, 80) || agent.name;
      const nextPrompt = clip(draft.prompt, 8_000) || agent.prompt;
      const nextVoice = voiceOf(draft.voice ?? agent.voice);
      const nextGreeting = draft.greeting !== undefined ? clip(draft.greeting, 500) : agent.greeting;
      const nextPersonality = personalityOf(draft.personality ?? agent.personality);
      const nextNotes = draft.personalityNotes !== undefined ? clip(draft.personalityNotes, 500) : agent.personalityNotes;
      const nextRole = draft.role !== undefined ? clip(draft.role, 80) || agent.role : agent.role;
      const changed =
        nextName !== agent.name ||
        nextPrompt !== agent.prompt ||
        nextVoice !== agent.voice ||
        nextGreeting !== agent.greeting ||
        nextPersonality !== agent.personality ||
        nextNotes !== agent.personalityNotes ||
        nextRole !== agent.role;
      if (changed) {
        if (agent.versions.length >= MAX_VERSIONS) agent.versions.shift();
        agent.activeVersion += 1;
        agent.name = nextName;
        agent.prompt = nextPrompt;
        agent.voice = nextVoice;
        agent.greeting = nextGreeting;
        agent.personality = nextPersonality;
        agent.personalityNotes = nextNotes;
        agent.role = nextRole;
        agent.versions.push(snapshot(agent, clip(draft.note, 120) || `v${agent.activeVersion}`));
      }
      if (draft.description !== undefined) agent.description = clip(draft.description, 240);
      if (draft.industry !== undefined) agent.industry = clip(draft.industry, 80);
      if (draft.language !== undefined) agent.language = clip(draft.language, 16, "en") || "en";
      agent.updatedAt = Date.now();
      return agent;
    },
    activateVersion(agentId: string, version: number): StoredAgent {
      const agent = agents.get(clip(agentId, 64));
      if (!agent) throw new Error("Agent not found.");
      const snap = agent.versions.find((v) => v.version === version);
      if (!snap) throw new Error("Version not found.");
      agent.name = snap.name;
      agent.prompt = snap.prompt;
      agent.voice = snap.voice;
      agent.greeting = snap.greeting;
      agent.personality = snap.personality;
      agent.personalityNotes = snap.personalityNotes;
      agent.role = snap.role;
      agent.activeVersion = snap.version;
      agent.updatedAt = Date.now();
      return agent;
    },
    listScenarios(): Scenario[] {
      return [...scenarios.values()];
    },
    getScenario(scenarioId: string): Scenario | undefined {
      return scenarios.get(clip(scenarioId, 64));
    },
    createScenario(input: unknown): Scenario {
      if (scenarios.size >= MAX_SCENARIOS) throw new Error("Scenario limit reached.");
      const scn = sanitizeScenario({ ...(input as object), id: id("scn"), builtIn: false });
      scenarios.set(scn.id, scn);
      return scn;
    },
    updateScenario(scenarioId: string, input: unknown): Scenario {
      const current = scenarios.get(clip(scenarioId, 64));
      if (!current) throw new Error("Scenario not found.");
      if (current.builtIn) throw new Error("Built-in scenarios cannot be edited. Duplicate them instead.");
      const scn = sanitizeScenario({ ...(input as object), id: current.id, builtIn: false });
      scenarios.set(scn.id, scn);
      return scn;
    },
  };
}

export type SimulatorCatalog = ReturnType<typeof createSimulatorCatalog>;
