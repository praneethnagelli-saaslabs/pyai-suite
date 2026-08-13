const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, "") ?? "";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string; reason?: string; message?: string };
  if (!res.ok) {
    if (res.status === 504) {
      throw new Error(
        "Transcription timed out while waiting for Hear. Retry the same recording — longer calls are split into parts.",
      );
    }
    const msg = (data as { reason?: string; error?: string; message?: string }).reason
      ?? (data as { error?: string }).error
      ?? (data as { message?: string }).message
      ?? `Request failed (${res.status})`;
    // Fastify often sets error="Internal Server Error" and the real detail in message.
    const detail = (data as { message?: string }).message;
    const errLabel = (data as { error?: string }).error;
    throw new Error(
      detail && errLabel && errLabel !== detail && /internal server error/i.test(errLabel)
        ? detail
        : msg === "Internal Server Error" && detail
          ? detail
          : msg,
    );
  }
  return data;
}

export interface MeetingNotes {
  title: string;
  mode?: string;
  summary: string;
  decisions: Array<{ decision: string; evidence: { excerpt?: string; speaker?: string } }>;
  actionItems: Array<{ owner: string; task: string; deadline?: string }>;
  questions?: Array<{ question: string }>;
  importantMoments?: Array<{ moment: string; start?: number; end?: number }>;
  participants?: string[];
}

export interface ProviderInfo {
  id: string;
  name: string;
  capabilities: string[];
  configured: boolean;
}

export interface ProviderHealth {
  id: string;
  status: "healthy" | "degraded" | "down";
  latencyMs: number;
  detail?: string;
  checkedAt: number;
}

export interface RunSummary {
  runId: string;
  workflowId: string;
  product: string;
  status: string;
  startedAt: number;
  completedAt?: number;
  durationMs?: number;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    audioSeconds: number;
    costUsd: number;
    providerCalls: number;
  };
  error?: string;
}

export interface GateResult {
  gateId: string;
  name?: string;
  verdict: "PASS" | "WARN" | "BLOCK";
  reason?: string;
}

export const api = {
  apiBase: API_BASE,
  health: () => request<{ status: string; providers: string[] }>("/health"),
  providers: () => request<{ providers: ProviderInfo[] }>("/api/providers"),
  providerHealth: () => request<{ health: ProviderHealth[] }>("/api/providers/health"),
  capabilities: () => request<{ capabilities: string[] }>("/api/capabilities"),
  runs: (limit = 50) => request<{ runs: RunSummary[] }>(`/api/runs?limit=${limit}`),
  run: (id: string) =>
    request<{ run: RunSummary; calls: Array<Record<string, unknown>> }>(`/api/runs/${id}`),
  sampleCallIQ: () => request<{ transcriptText: string }>("/api/sample/calliq"),
  sampleRecording: (body: { product: "calliq" | "brief"; ttsProvider?: string }) =>
    request<{
      product: "calliq" | "brief";
      fileName: string;
      audioFormat: string;
      audioBase64: string;
      ttsProvider: string;
      durationHint: string;
      note: string;
    }>("/api/sample/recording", { method: "POST", body: JSON.stringify(body) }),
  sttTranscribe: (body: {
    audioBase64: string;
    format?: string;
    provider?: string;
    language?: string;
    prompt?: string;
    diarize?: boolean;
    speakerLabel?: string;
  }) =>
    request<{
      text: string;
      provider: string;
      latencyMs: number;
      diarized?: boolean;
      fallback?: boolean;
    }>("/api/stt/transcribe", { method: "POST", body: JSON.stringify(body) }),
  analyzeCallIQ: (body: {
    transcriptText?: string;
    audioBase64?: string;
    audioFormat?: string;
    sttProvider?: string;
    llmProvider?: string;
    verifyProvider?: string;
  }) =>
    request<{
      status: string;
      runId: string;
      durationMs: number;
      usage: RunSummary["usage"];
      gates: GateResult[];
      transcript: { text: string; segments: Array<{ id: string; speaker?: string; start: number; end: number; text: string }> };
      recap?: {
        talkRatio: Array<{ speaker: string; secs: number; pct: number }>;
        keywords: Array<{ term: string; count: number }>;
        speakers: number;
        durationSecs: number;
      };
      analysis: Record<string, unknown>;
      verification: { passed: boolean; checkedClaims: number; reason: string };
      stages?: Array<{ id: string; label: string; detail?: string; ms?: number }>;
      llmProvider?: string;
      sttProvider?: string;
      trace?: RunSummary;
    }>("/api/calliq/analyze", { method: "POST", body: JSON.stringify(body) }),
  calliqBotProviders: () =>
    request<{
      attendee: { configured: boolean; baseUrl: string | null; role: string };
      recall: { configured: boolean; region: string; role: string };
      simulated: { configured: boolean; role: string };
    }>("/api/calliq/bot/providers"),
  calliqBotJoin: (body: {
    meetingUrl?: string;
    botName?: string;
    prefer?: "auto" | "recall" | "attendee" | "simulated";
    demo?: boolean;
  }) =>
    request<{
      id: string;
      provider: string;
      status: string;
      meetingUrl: string;
      botName: string;
      detail?: string;
      externalId?: string;
    }>("/api/calliq/bot/join", { method: "POST", body: JSON.stringify(body) }),
  calliqBotStatus: (id: string) =>
    request<{
      id: string;
      provider: string;
      status: string;
      meetingUrl: string;
      botName: string;
      detail?: string;
      error?: string;
      transcriptText?: string;
      externalId?: string;
      updatedAt: number;
    }>(`/api/calliq/bot/${encodeURIComponent(id)}`),
  calliqBotCurrent: async () => {
    const res = await fetch(`${API_BASE}/api/calliq/bot/current`, { credentials: "include" });
    if (res.status === 204 || res.status === 404) return null;
    if (!res.ok) return null;
    return (await res.json()) as {
      id: string;
      provider: string;
      status: string;
      meetingUrl: string;
      botName: string;
      detail?: string;
      error?: string;
      transcriptText?: string;
      updatedAt: number;
    };
  },
  calliqBotLeave: (id: string) =>
    request<{
      id: string;
      provider: string;
      status: string;
      detail?: string;
      transcriptText?: string;
    }>(`/api/calliq/bot/${encodeURIComponent(id)}/leave`, { method: "POST", body: "{}" }),
  googleStatus: () =>
    request<{
      configured: boolean;
      connected: boolean;
      email: string | null;
      redirectUri: string | null;
    }>("/api/google/status"),
  googleDisconnect: () => request<{ ok: boolean }>("/api/google/disconnect", { method: "POST" }),
  calliqStartCall: () =>
    request<{
      meetingUrl: string;
      eventId: string;
      htmlLink?: string;
      bot: {
        id: string;
        provider: string;
        status: string;
        meetingUrl: string;
        botName: string;
        detail?: string;
        externalId?: string;
      };
    }>("/api/calliq/start-call", { method: "POST" }),
  calliqDemoSpeakTurn: (body: {
    speaker: "rep" | "customer";
    text: string;
    ttsProvider?: string;
  }) =>
    request<{
      demoMode: "live" | "simulated";
      ttsProvider: string;
      speakMs: number;
      speaker: "rep" | "customer";
      text: string;
      audioBase64?: string;
      audioFormat?: string;
      useBrowserSpeech?: boolean;
      fallbackNote?: string;
    }>("/api/calliq/demo/speak-turn", { method: "POST", body: JSON.stringify(body) }),
  calliqDemoSpeakScript: (body?: { ttsProvider?: string }) =>
    request<{
      demoMode: "live" | "simulated";
      ttsProvider: string;
      speakMs: number;
      useBrowserSpeech?: boolean;
      fallbackNote?: string;
      turns: Array<{
        speaker: "rep" | "customer";
        label: string;
        text: string;
        line: string;
        audioBase64?: string;
        audioFormat?: string;
      }>;
    }>("/api/calliq/demo/speak-script", { method: "POST", body: JSON.stringify(body ?? {}) }),
  playgroundRun: (body: {
    capability: string;
    provider?: string;
    input?: string;
    model?: string;
    audioBase64?: string;
    audioFormat?: string;
  }) =>
    request<{
      provider: string;
      capability?: string;
      output: string;
      usage: RunSummary["usage"];
      latencyMs: number;
      runId: string;
      result?: {
        kind: string;
        text?: string;
        note?: string;
        model?: string;
        parsed?: unknown;
        audioBase64?: string;
        audioFormat?: string;
        audioBytes?: number;
        tooLarge?: boolean;
        dimensions?: number;
        vectors?: number;
        preview?: number[];
        input?: string;
        segments?: Array<{ id?: string; speaker?: string; start?: number; end?: number; text?: string }>;
        language?: string;
      };
    }>("/api/playground/run", { method: "POST", body: JSON.stringify(body) }),
  connectPyAISandbox: () =>
    request<{
      status: "connected" | "already_configured";
      keyPrefix: string;
      docs: string;
      note?: string;
    }>("/api/providers/pyai/sandbox", { method: "POST" }),

  sampleScrib: () =>
    request<{
      rawText: string;
      spokenPhrase?: string;
      appName: string;
      dictionary: Array<{ term: string; replacement: string }>;
    }>("/api/sample/scrib"),
  scribDictate: (body: {
    rawText?: string;
    mode?: string;
    appName?: string;
    tabContext?: { host?: string; path?: string; title?: string; field?: string };
    sttProvider?: string;
    cleanupProvider?: string;
    dictionary?: Array<{ term: string; replacement: string }>;
  }) =>
    request<{
      status: string;
      runId: string;
      raw: string;
      cleaned: string;
      mode: string;
      appRuleId?: string;
      latency: { sttMs: number; cleanupMs: number; dictionaryMs: number; totalMs: number };
      sttProvider: string;
      cleanupProvider: string;
    }>("/api/scrib/dictate", { method: "POST", body: JSON.stringify(body) }),
  scribDemoSpeak: (body?: { ttsProvider?: string }) =>
    request<{
      demoMode: "live" | "simulated";
      spokenPhrase: string;
      audioBase64?: string;
      audioFormat?: string;
      ttsProvider: string;
      speakMs?: number;
      useBrowserSpeech?: boolean;
      fallbackNote?: string;
      stage: { id: string; label: string; detail?: string; ms?: number };
    }>("/api/scrib/demo/speak", { method: "POST", body: JSON.stringify(body ?? {}) }),
  scribDemoFinish: (body: {
    mode?: string;
    appName?: string;
    sttProvider?: string;
    cleanupProvider?: string;
    audioBase64?: string;
    audioFormat?: string;
    demoMode?: "live" | "simulated";
  }) =>
    request<{
      status: string;
      runId: string;
      demoMode: "live" | "simulated";
      spokenPhrase: string;
      stages: Array<{ id: string; label: string; detail?: string; ms?: number }>;
      raw: string;
      cleaned: string;
      mode: string;
      appRuleId?: string;
      latency: { sttMs: number; cleanupMs: number; dictionaryMs: number; totalMs: number };
      sttProvider: string;
      cleanupProvider: string;
      hearMs?: number;
    }>("/api/scrib/demo/finish", { method: "POST", body: JSON.stringify(body) }),
  scribDemo: (body?: {
    mode?: string;
    appName?: string;
    sttProvider?: string;
    ttsProvider?: string;
    cleanupProvider?: string;
  }) =>
    request<{
      status: string;
      runId: string;
      demoMode: "live" | "simulated";
      spokenPhrase: string;
      audioBase64?: string;
      audioFormat?: string;
      stages: Array<{ id: string; label: string; detail?: string; ms?: number }>;
      raw: string;
      cleaned: string;
      mode: string;
      appRuleId?: string;
      latency: { sttMs: number; cleanupMs: number; dictionaryMs: number; totalMs: number };
      sttProvider: string;
      cleanupProvider: string;
      speakMs?: number;
      hearMs?: number;
    }>("/api/scrib/demo", { method: "POST", body: JSON.stringify(body ?? {}) }),
  scribTranscribe: (body: {
    audioBase64: string;
    format?: string;
    appName?: string;
    lastText?: string;
    tabContext?: { host?: string; path?: string; title?: string; field?: string };
    mode?: string;
    sttProvider?: string;
    cleanupProvider?: string;
  }) =>
    request<{
      action?: "dictate" | "refine";
      status: string;
      runId: string;
      raw: string;
      cleaned: string;
      mode: string;
      appRuleId?: string;
      latency: { sttMs: number; cleanupMs: number; dictionaryMs: number; totalMs: number };
      sttProvider: string;
      cleanupProvider: string;
      transcript: string;
      stages?: Array<{ id: string; label: string; detail?: string; ms?: number }>;
    }>("/api/scrib/transcribe", { method: "POST", body: JSON.stringify(body) }),

  sampleBrief: () => request<{ transcriptText: string; mode: string }>("/api/sample/brief"),
  briefDemoSpeak: (body?: { ttsProvider?: string }) =>
    request<{
      demoMode: "live" | "simulated";
      spokenPhrase: string;
      sampleTranscript: string;
      mode: string;
      audioBase64?: string;
      audioFormat?: string;
      ttsProvider: string;
      speakMs?: number;
      useBrowserSpeech?: boolean;
      fallbackNote?: string;
      stage: { id: string; label: string; detail?: string; ms?: number };
    }>("/api/brief/demo/speak", { method: "POST", body: JSON.stringify(body ?? {}) }),
  briefDemoFinish: (body: {
    mode?: string;
    llmProvider?: string;
    sttProvider?: string;
    audioBase64?: string;
    audioFormat?: string;
    demoMode?: "live" | "simulated";
    title?: string;
  }) =>
    request<{
      status: string;
      runId: string;
      durationMs: number;
      usage: RunSummary["usage"];
      gates: GateResult[];
      llmProvider: string;
      demoMode: "live" | "simulated";
      spokenPhrase: string;
      transcriptText: string;
      hearMs?: number;
      stages: Array<{ id: string; label: string; detail?: string; ms?: number }>;
      transcript: { text: string; segments: Array<{ id: string; speaker?: string; start: number; end: number; text: string }> };
      notes: MeetingNotes;
      privacy: { microphone: string; uploadedTo: string; storage: string };
    }>("/api/brief/demo/finish", { method: "POST", body: JSON.stringify(body) }),
  briefAnalyze: (body: {
    transcriptText?: string;
    audioBase64?: string;
    audioFormat?: string;
    mode?: string;
    title?: string;
    sttProvider?: string;
    llmProvider?: string;
  }) =>
    request<{
      status: string;
      runId: string;
      llmProvider?: string;
      sttProvider?: string;
      stages?: Array<{ id: string; label: string; detail?: string; ms?: number }>;
      transcript?: string;
      notes: MeetingNotes;
      privacy: { microphone: string; uploadedTo: string; storage: string };
    }>("/api/brief/analyze", { method: "POST", body: JSON.stringify(body) }),
  briefSearch: (q: string) =>
    request<{
      query: string;
      results: Array<{ meetingId: string; date: string; answer: string; evidence: string }>;
      meetings: Array<{ id: string; date: string; title: string; mode: string }>;
    }>(`/api/brief/search?q=${encodeURIComponent(q)}`),

  simulatorRun: (body: {
    agentName?: string;
    count?: number;
    concurrency?: number;
    llmProvider?: string;
  }) =>
    request<{
      status: string;
      runId: string;
      llmProvider?: string;
      stages?: Array<{ id: string; label: string; detail?: string; ms?: number }>;
      card: {
        agent: string;
        tests: number;
        passed: number;
        failed: number;
        score: number;
        medianLatencyMs: number;
        worstFailure?: string;
        costUsd: number;
        calls: Array<{
          callId: string;
          persona: string;
          passed: boolean;
          score: number;
          failures: string[];
          latencyMs: number;
        }>;
      };
    }>("/api/simulator/run", { method: "POST", body: JSON.stringify(body) }),
  simulatorLive: () =>
    request<{
      voices: Array<{ id: string; label: string }>;
      providers: Array<{ id: string; name: string; configured: boolean; role: string }>;
      primary: string;
    }>("/api/simulator/live"),
  simulatorAgents: () => request<{ agents: SimulatorAgent[] }>("/api/simulator/agents"),
  simulatorCreateAgent: (body: Partial<SimulatorAgent>) =>
    request<{ agent: SimulatorAgent }>("/api/simulator/agents", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  simulatorUpdateAgent: (id: string, body: Partial<SimulatorAgent> & { note?: string }) =>
    request<{ agent: SimulatorAgent }>(`/api/simulator/agents/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  simulatorActivateVersion: (id: string, version: number) =>
    request<{ agent: SimulatorAgent }>(`/api/simulator/agents/${encodeURIComponent(id)}/activate`, {
      method: "POST",
      body: JSON.stringify({ version }),
    }),
  simulatorScenarios: () => request<{ scenarios: SimulatorScenario[] }>("/api/simulator/scenarios"),
  simulatorCreateScenario: (body: Partial<SimulatorScenario>) =>
    request<{ scenario: SimulatorScenario }>("/api/simulator/scenarios", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  simulatorUpdateScenario: (id: string, body: Partial<SimulatorScenario>) =>
    request<{ scenario: SimulatorScenario }>(`/api/simulator/scenarios/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
};

export interface SimulatorAgentVersion {
  version: number;
  name: string;
  prompt: string;
  voice: string;
  greeting: string;
  personality: string;
  personalityNotes: string;
  role: string;
  createdAt: number;
  note: string;
}

export interface SimulatorAgent {
  id: string;
  name: string;
  description: string;
  role: string;
  industry: string;
  language: string;
  personality: string;
  personalityNotes: string;
  voice: string;
  greeting: string;
  prompt: string;
  activeVersion: number;
  versions: SimulatorAgentVersion[];
  createdAt: number;
  updatedAt: number;
}

export interface SimulatorScenario {
  id: string;
  name: string;
  goal: string;
  customerPersona: string;
  personality: string;
  emotionalState: string;
  patience: "low" | "medium" | "high";
  openingLine: string;
  expected: string[];
  failures: string[];
  objections: string[];
  known: string[];
  unknown: string[];
  escalation: string;
  builtIn: boolean;
}
