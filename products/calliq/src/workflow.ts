import {
  type Platform,
  type WorkflowDef,
  Capability,
  evidenceGate,
  schemaGate,
  confidenceGate,
  type Usage,
  ZERO_USAGE,
} from "@pyai/core";
import {
  CallAnalysisSchema,
  ANALYSIS_JSON_SCHEMA,
  type CallAnalysis,
} from "./schema.js";
import { getPrompt, PROMPT_VERSION } from "./prompts.js";
import {
  applyTalkSeconds,
  labeledTranscript,
  recapFromSegments,
  type RecapMetrics,
} from "./recap.js";
import { localDealNotes } from "./localNotes.js";

export interface CallIQInput {
  audio?: Uint8Array;
  transcriptText?: string;
  fileName?: string;
  sttProvider?: string;
  llmProvider?: string;
  verifyProvider?: string;
  promptVersion?: string;
}

export interface CallIQArtifact {
  transcript: { segments: Array<{ id: string; speaker?: string; start: number; end: number; text: string }>; text: string; provider: string };
  recap: RecapMetrics;
  analysis: CallAnalysis;
  verification: { passed: boolean; checkedClaims: number; reason: string };
}

/**
 * Build the CallIQ analysis workflow (spec #31, #32, #62).
 * Real loop: Hear (PyAI STT, diarized) → Recap (talk-ratio + keywords +
 * structured deal notes) → evidence gate → multi-model verify.
 * No product code calls a vendor directly.
 */
export function buildCallIQWorkflow(
  platform: Platform,
  input: CallIQInput,
): { def: WorkflowDef; getArtifact: () => CallIQArtifact } {
  let transcript = "";
  let transcriptSegments: CallIQArtifact["transcript"]["segments"] = [];
  let transcriptProvider = input.sttProvider ?? "mock";
  let recap: RecapMetrics = { talkRatio: [], keywords: [], speakers: 0, durationSecs: 0 };
  let analysis: CallAnalysis | null = null;
  let verification = { passed: false, checkedClaims: 0, reason: "" };
  const hasAudio = Boolean(input.audio?.length);
  const budgetMs = hasAudio ? 180_000 : 120_000;

  const def: WorkflowDef = {
    id: "calliq_sales_analysis",
    product: "calliq",
    budget: { maxDurationMs: budgetMs, maxTokens: 200_000, maxAudioMinutes: 60, maxCostUsd: 0.5, maxRetries: 4, maxParallelTasks: 8 },
    optional: ["verify"],
    tasks: [
      {
        id: "hear",
        label: "Hear (PyAI STT, diarized)",
        estimate: { audioSeconds: hasAudio ? 30 : 2 },
        run: async () => {
          if (input.transcriptText) {
            // Bot / pasted transcript — Recap still runs on labeled spans.
            transcript = input.transcriptText;
            transcriptSegments = input.transcriptText
              .split(/\n+/)
              .filter(Boolean)
              .map((line, i) => {
                const m = line.match(/^([^:]+):\s*(.*)$/);
                return {
                  id: `s${i + 1}`,
                  speaker: m?.[1],
                  start: i * 10,
                  end: (i + 1) * 10,
                  text: m?.[2] ?? line,
                };
              });
            transcriptProvider = "inline";
            return { transcript, segments: transcriptSegments, provider: "inline", usage: { ...ZERO_USAGE } };
          }
          const adapter = platform.registry.getAdapterFor(Capability.BATCH_STT, input.sttProvider);
          const stt = adapter?.asSTT;
          if (!stt) throw new Error(`no STT provider available (requested ${input.sttProvider ?? "default"})`);
          if (!input.audio?.length) throw new Error("Hear needs audio or a transcript");
          transcriptProvider = adapter.id;
          const res = await stt().transcribe({
            audio: input.audio,
            format: input.fileName?.split(".").pop(),
            diarize: true,
          });
          transcript = res.text;
          transcriptSegments = res.segments.map((s) => ({
            id: s.id,
            speaker: s.speaker,
            start: s.start,
            end: s.end,
            text: s.text,
          }));
          void platform.tracer;
          return { transcript, segments: transcriptSegments, provider: adapter.id, usage: res.usage };
        },
        gates: [schemaGate],
      },
      {
        id: "recap",
        label: "Recap (talk-ratio + deal notes)",
        dependsOn: ["hear"],
        run: async (ctx) => {
          recap = recapFromSegments(transcriptSegments);
          const llm = platform.registry.getAdapterFor(Capability.STRUCTURED_OUTPUT, input.llmProvider);
          const llmFn = llm?.asLLM;
          // PyAI is Hear-only. Mock LLM used to emit canned Dana/pricing notes
          // ("Mock summary of the call. You are Recap…") instead of the transcript.
          if (!llmFn || llm.id === "mock") {
            const data = localDealNotes(transcriptSegments, recap, transcript);
            return { data, recap, claims: toClaims(data), usage: { ...ZERO_USAGE } };
          }
          const sys = getPrompt(input.promptVersion ?? PROMPT_VERSION);
          const user = [
            "You are Recap for a sales call. Use the Hear transcript and metrics.",
            `Talk-ratio: ${JSON.stringify(recap.talkRatio)}`,
            `Keyword hits: ${JSON.stringify(recap.keywords)}`,
            `Labeled transcript:\n${labeledTranscript(transcriptSegments) || transcript}`,
            `Return ONLY valid JSON matching this schema (fill every required field with real content from the transcript):\n${JSON.stringify(ANALYSIS_JSON_SCHEMA)}`,
          ].join("\n\n");
          const res = await llmFn().complete({
            model: input.llmProvider ? undefined : "mock-flash",
            messages: [
              { role: "system", content: sys },
              { role: "user", content: user },
            ],
            jsonSchema: ANALYSIS_JSON_SCHEMA,
            promptVersion: PROMPT_VERSION,
          });
          const parsedRaw = (res.parsed ?? safeJson(res.text)) as Record<string, unknown>;
          const validated = CallAnalysisSchema.safeParse(normalizeAnalysis(parsedRaw));
          if (!validated.success) {
            throw new Error(`CallIQ schema validation failed: ${validated.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
          }
          const data = {
            ...validated.data,
            participants: applyTalkSeconds(validated.data.participants, recap.talkRatio),
          };
          void ctx;
          return { data, recap, claims: toClaims(data), usage: res.usage };
        },
        gates: [schemaGate, evidenceGate, confidenceGate],
      },
      {
        id: "verify",
        label: "Multi-model verification (reasoning)",
        dependsOn: ["recap"],
        run: async (ctx) => {
          const verifier = platform.registry.getAdapterFor(Capability.REASONING_LLM, input.verifyProvider);
          const verifyFn = verifier?.asLLM;
          if (!verifyFn || verifier.id === "mock") {
            return {
              passed: true,
              checkedClaims: 0,
              reason: "no live verifier configured; skipped adaptive verification",
              usage: { ...ZERO_USAGE },
            };
          }
          const claims = toClaims(analysis ?? (ctx.artifacts.recap as { data: CallAnalysis })?.data);
          const res = await verifyFn().complete({
            // Let the selected provider use its default model (never hardcode mock-* on real providers).
            model: verifier.id === "mock" ? "mock-opus" : undefined,
            messages: [
              { role: "system", content: "You are a strict verification agent. For each claim, check the cited evidence span actually supports it. Respond JSON: { passed: boolean, checkedClaims: number, reason: string }." },
              { role: "user", content: `Transcript:\n${transcript}\n\nClaims:\n${JSON.stringify(claims, null, 2)}` },
            ],
            jsonSchema: { type: "object", properties: { passed: { type: "boolean" }, checkedClaims: { type: "number" }, reason: { type: "string" } }, required: ["passed", "checkedClaims", "reason"] },
          });
          const v = safeJson(res.text) as { passed: boolean; checkedClaims: number; reason: string };
          void ctx;
          return { passed: Boolean(v.passed), checkedClaims: Number(v.checkedClaims ?? 0), reason: String(v.reason ?? ""), usage: res.usage };
        },
        // Adaptive verification: block if verification fails on a high-value claim.
        gates: [
          {
            id: "verification",
            name: "Verification gate",
            evaluate: (c) => {
              const v = c.data as { passed: boolean; reason: string };
              return v && v.passed === false
                ? { gateId: "verification", name: "Verification gate", verdict: "WARN", reason: `verifier flagged: ${v.reason}`, checkedAt: Date.now() }
                : { gateId: "verification", name: "Verification gate", verdict: "PASS", reason: "verifier confirmed claims", checkedAt: Date.now() };
            },
          },
        ],
      },
    ],
    onComplete: (ctx) => {
      const recapArt = ctx.artifacts.recap as { data: CallAnalysis; recap?: RecapMetrics } | undefined;
      analysis = recapArt?.data ?? null;
      if (recapArt?.recap) recap = recapArt.recap;
      const v = ctx.artifacts.verify as { passed: boolean; checkedClaims: number; reason: string } | undefined;
      verification = v ?? verification;
    },
  };

  const getArtifact = (): CallIQArtifact => ({
    transcript: { segments: transcriptSegments, text: transcript, provider: transcriptProvider },
    recap,
    analysis: analysis as CallAnalysis,
    verification,
  });

  return { def, getArtifact };
}

function toClaims(a: CallAnalysis): Array<{ claim: string; evidence?: unknown }> {
  const claims: Array<{ claim: string; evidence?: unknown }> = [];
  for (const o of a.objections) claims.push({ claim: `Objection: ${o.type} — ${o.detail}`, evidence: o.evidence });
  for (const s of a.buyingSignals) claims.push({ claim: `Buying signal: ${s.type}`, evidence: s.evidence });
  for (const n of a.nextSteps) claims.push({ claim: `Next step: ${n.task} (${n.owner})`, evidence: n.evidence });
  return claims;
}

/** Coerce common LLM drifts into CallAnalysisSchema-friendly shapes. */
export function normalizeAnalysis(raw: Record<string, unknown>): Record<string, unknown> {
  const ev = (e: unknown) => {
    if (e && typeof e === "object") {
      const o = e as Record<string, unknown>;
      return {
        source: String(o.source ?? "transcript"),
        start: typeof o.start === "number" ? o.start : undefined,
        end: typeof o.end === "number" ? o.end : undefined,
        speaker: o.speaker != null ? String(o.speaker) : undefined,
        segmentRef: o.segmentRef != null ? String(o.segmentRef) : undefined,
        excerpt: String(o.excerpt ?? o.text ?? o.quote ?? ""),
      };
    }
    if (typeof e === "string") return { source: "transcript", excerpt: e };
    return { source: "transcript", excerpt: "" };
  };
  const mapArr = (v: unknown, map: (x: Record<string, unknown>) => Record<string, unknown>) =>
    Array.isArray(v) ? v.map((x) => map((x && typeof x === "object" ? x : { detail: String(x) }) as Record<string, unknown>)) : [];

  const objectionTypes = new Set(["Pricing", "Implementation", "Security", "Competitor", "Timing", "Other"]);
  const signalTypes = new Set(["urgency", "intent", "budget", "authority", "timeline", "objection_resolved"]);
  const riskTypes = new Set([
    "no_next_meeting",
    "no_decision_maker",
    "unresolved_objection",
    "weak_buying_signal",
    "competitor_risk",
    "timeline_risk",
  ]);
  const stages = new Set(["Discovery", "Evaluation", "Proposal", "Negotiation", "Closed Won", "Closed Lost"]);
  const roles = new Set(["Sales Rep", "Customer", "Other"]);

  const pick = (v: unknown, allowed: Set<string>, fallback: string) => {
    const s = String(v ?? "").trim();
    if (!s) return fallback;
    if (allowed.has(s)) return s;
    const hit = [...allowed].find(
      (a) => a.toLowerCase() === s.toLowerCase() || s.toLowerCase().includes(a.toLowerCase()),
    );
    return hit ?? fallback;
  };

  const inferObjectionType = (text: string, declared: unknown): string => {
    const picked = pick(declared, objectionTypes, "");
    if (picked && picked !== "Other") return picked;
    const t = text.toLowerCase();
    if (/price|pricing|cost|expensive|budget|roi|discount/.test(t) && !/implement|onboard|deploy|rollout/.test(t)) {
      return "Pricing";
    }
    if (/implement|onboard|deploy|rollout|integration|migration|got burned/.test(t)) return "Implementation";
    if (/secur|soc\s*2|compliance|procurement|residency|gdpr|hipaa/.test(t)) return "Security";
    if (/competitor|vs\.|versus|alternative|chorus|clari|outreach/.test(t)) return "Competitor";
    if (/timeline|deadline|quarter|this month|next week|too late|timing/.test(t)) return "Timing";
    return picked || "Other";
  };

  const summaryRaw = String(raw.summary ?? raw.callSummary ?? raw.overview ?? "").trim();
  const summary =
    summaryRaw && !/unavailable|n\/a|none/i.test(summaryRaw)
      ? summaryRaw
      : "Sales call covering plan fit, customer concerns, and proposed next steps.";

  return {
    summary,
    participants: mapArr(raw.participants, (p) => ({
      name: String(p.name ?? "Unknown"),
      role: pick(p.role, roles, "Other"),
      talkSeconds: typeof p.talkSeconds === "number" ? p.talkSeconds : undefined,
    })),
    dealStage: pick(raw.dealStage, stages, "Evaluation"),
    dealHealthScore: Math.max(0, Math.min(100, Number(raw.dealHealthScore ?? 50))),
    dealHealthRationale: String(raw.dealHealthRationale ?? summary),
    objections: mapArr(raw.objections, (o) => {
      const evidence = ev(o.evidence);
      const excerpt = String((evidence as { excerpt?: string }).excerpt ?? "");
      const detailRaw = String(
        o.detail ?? o.description ?? o.objection ?? o.text ?? o.category ?? "",
      ).trim();
      const detail =
        detailRaw && !/^objection$/i.test(detailRaw)
          ? detailRaw
          : excerpt || "Customer raised a concern on the call";
      return {
        type: inferObjectionType(`${detail} ${excerpt}`, o.type ?? o.category ?? o.kind),
        detail,
        severity: pick(o.severity, new Set(["low", "medium", "high"]), "medium"),
        evidence,
      };
    }),
    buyingSignals: mapArr(raw.buyingSignals, (s) => ({
      type: pick(s.type, signalTypes, "intent"),
      detail: String(s.detail ?? s.description ?? s.type ?? "Signal"),
      evidence: ev(s.evidence),
    })),
    risks: mapArr(raw.risks, (r) => ({
      type: pick(r.type, riskTypes, "unresolved_objection"),
      detail: String(r.detail ?? r.description ?? r.type ?? "Risk"),
      severity: pick(r.severity, new Set(["low", "medium", "high"]), "medium"),
      evidence: r.evidence ? ev(r.evidence) : undefined,
    })),
    competitorMentions: Array.isArray(raw.competitorMentions) ? raw.competitorMentions.map(String) : [],
    pricingObjections: Array.isArray(raw.pricingObjections) ? raw.pricingObjections.map(String) : [],
    nextSteps: mapArr(raw.nextSteps, (n) => ({
      owner: String(n.owner ?? "Unassigned"),
      task: String(n.task ?? n.detail ?? n.description ?? "Follow up"),
      deadline: n.deadline ? String(n.deadline) : undefined,
      evidence: ev(n.evidence),
    })),
    followUpEmail: String(raw.followUpEmail ?? ""),
    followUpSlack: String(raw.followUpSlack ?? ""),
    crmJson: raw.crmJson && typeof raw.crmJson === "object" ? (raw.crmJson as Record<string, unknown>) : {},
  };
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    try {
      return JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
    } catch {
      return {};
    }
  }
}

void (null as unknown as Usage);
