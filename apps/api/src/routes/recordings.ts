import type { FastifyInstance, FastifyReply } from "fastify";
import type { AppServices } from "../services.js";
import {
  MAX_RECORDING_BYTES,
  normalizeContentType,
  sanitizeEntityId,
  type RecordingProduct,
} from "../recordingStore.js";

function decodeAudioBase64(b64: string): Uint8Array | null {
  if (!b64 || b64.length > 28_000_000) return null;
  try {
    const bytes = Uint8Array.from(Buffer.from(b64, "base64"));
    if (!bytes.length || bytes.byteLength > MAX_RECORDING_BYTES) return null;
    return bytes;
  } catch {
    return null;
  }
}

async function putRecording(
  svc: AppServices,
  product: RecordingProduct,
  entityIdRaw: string,
  body: { audioBase64?: string; contentType?: string; format?: string },
  reply: FastifyReply,
) {
  const entityId = sanitizeEntityId(entityIdRaw);
  if (!entityId) return reply.code(400).send({ error: "invalid id" });

  if (product === "brief") {
    const meeting = await svc.meetingMemory.get(entityId);
    if (!meeting) return reply.code(404).send({ error: "meeting not found" });
  }

  const bytes = decodeAudioBase64(body.audioBase64?.trim() ?? "");
  if (!bytes) {
    return reply.code(400).send({
      error: `audioBase64 required (max ~${Math.floor(MAX_RECORDING_BYTES / (1024 * 1024))}MB)`,
    });
  }
  const contentType = normalizeContentType(body.contentType, body.format);
  if (!contentType) return reply.code(400).send({ error: "unsupported audio type" });

  const meta = await svc.recordings.put({ product, entityId, bytes, contentType });
  return {
    ok: true,
    product: meta.product,
    entityId: meta.entityId,
    contentType: meta.contentType,
    byteLength: meta.byteLength,
    backend: svc.recordings.backend,
    playPath: `/api/${product === "brief" ? "brief/meetings" : "calliq/calls"}/${encodeURIComponent(entityId)}/recording`,
  };
}

async function playRecording(
  svc: AppServices,
  product: RecordingProduct,
  entityIdRaw: string,
  reply: FastifyReply,
) {
  const entityId = sanitizeEntityId(entityIdRaw);
  if (!entityId) return reply.code(400).send({ error: "invalid id" });
  const row = await svc.recordings.get(product, entityId);
  if (!row) return reply.code(404).send({ error: "recording not found" });
  reply.header("Content-Type", row.contentType);
  reply.header("Content-Length", String(row.bytes.byteLength));
  reply.header("Cache-Control", "private, max-age=120");
  return reply.send(Buffer.from(row.bytes));
}

/** Save + stream playable recordings for Brief meetings and CallIQ calls. */
export async function recordingRoutes(app: FastifyInstance, svc: AppServices): Promise<void> {
  app.post<{
    Params: { id: string };
    Body: { audioBase64?: string; contentType?: string; format?: string };
  }>("/api/brief/meetings/:id/recording", async (req, reply) =>
    putRecording(svc, "brief", req.params.id, req.body ?? {}, reply),
  );

  app.get<{ Params: { id: string } }>("/api/brief/meetings/:id/recording", async (req, reply) =>
    playRecording(svc, "brief", req.params.id, reply),
  );

  app.post<{
    Params: { id: string };
    Body: { audioBase64?: string; contentType?: string; format?: string };
  }>("/api/calliq/calls/:id/recording", async (req, reply) =>
    putRecording(svc, "calliq", req.params.id, req.body ?? {}, reply),
  );

  app.get<{ Params: { id: string } }>("/api/calliq/calls/:id/recording", async (req, reply) =>
    playRecording(svc, "calliq", req.params.id, reply),
  );
}
