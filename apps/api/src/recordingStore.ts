import { randomUUID } from "node:crypto";
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import postgres from "postgres";

export type RecordingProduct = "brief" | "calliq";

export type RecordingMeta = {
  product: RecordingProduct;
  entityId: string;
  objectKey: string;
  contentType: string;
  byteLength: number;
  createdAt: string;
};

export type RecordingPayload = RecordingMeta & {
  bytes: Uint8Array;
};

const ALLOWED_TYPES = new Set([
  "audio/wav",
  "audio/x-wav",
  "audio/mpeg",
  "audio/mp3",
  "audio/webm",
  "audio/ogg",
  "audio/opus",
  "audio/mp4",
  "audio/m4a",
  "audio/x-m4a",
  "audio/flac",
  "application/octet-stream",
]);

/** Max raw audio bytes (~15MB). */
export const MAX_RECORDING_BYTES = 15 * 1024 * 1024;

export function sanitizeEntityId(raw: string): string | null {
  const id = raw.trim().slice(0, 120);
  if (!id || !/^[a-zA-Z0-9_.:-]+$/.test(id)) return null;
  return id;
}

export function normalizeContentType(raw: string | undefined, format?: string): string | null {
  const t = (raw ?? "").trim().toLowerCase();
  if (t && ALLOWED_TYPES.has(t)) {
    if (t === "audio/x-wav") return "audio/wav";
    if (t === "audio/mp3") return "audio/mpeg";
    if (t === "audio/m4a" || t === "audio/x-m4a") return "audio/mp4";
    return t === "application/octet-stream" ? mimeFromFormat(format) : t;
  }
  return mimeFromFormat(format);
}

function mimeFromFormat(format?: string): string | null {
  switch ((format ?? "").toLowerCase()) {
    case "wav":
    case "pcm":
      return "audio/wav";
    case "mp3":
    case "mpeg":
      return "audio/mpeg";
    case "webm":
      return "audio/webm";
    case "ogg":
    case "opus":
      return "audio/ogg";
    case "m4a":
    case "mp4":
      return "audio/mp4";
    case "flac":
      return "audio/flac";
    default:
      return null;
  }
}

function extForMime(mime: string): string {
  if (mime.includes("wav")) return "wav";
  if (mime.includes("mpeg") || mime.includes("mp3")) return "mp3";
  if (mime.includes("webm")) return "webm";
  if (mime.includes("ogg") || mime.includes("opus")) return "ogg";
  if (mime.includes("mp4") || mime.includes("m4a")) return "m4a";
  if (mime.includes("flac")) return "flac";
  return "bin";
}

type Sql = ReturnType<typeof postgres>;

export interface RecordingStore {
  readonly backend: "memory" | "s3";
  put(input: {
    product: RecordingProduct;
    entityId: string;
    bytes: Uint8Array;
    contentType: string;
  }): Promise<RecordingMeta>;
  get(product: RecordingProduct, entityId: string): Promise<RecordingPayload | null>;
  has(product: RecordingProduct, entityId: string): Promise<boolean>;
  hasMany(product: RecordingProduct, entityIds: string[]): Promise<Record<string, boolean>>;
}

export class MemoryRecordingStore implements RecordingStore {
  readonly backend = "memory" as const;
  private rows = new Map<string, RecordingPayload>();

  private key(product: RecordingProduct, entityId: string) {
    return `${product}:${entityId}`;
  }

  async put(input: {
    product: RecordingProduct;
    entityId: string;
    bytes: Uint8Array;
    contentType: string;
  }): Promise<RecordingMeta> {
    const meta: RecordingMeta = {
      product: input.product,
      entityId: input.entityId,
      objectKey: `memory/${input.product}/${input.entityId}`,
      contentType: input.contentType,
      byteLength: input.bytes.byteLength,
      createdAt: new Date().toISOString(),
    };
    this.rows.set(this.key(input.product, input.entityId), { ...meta, bytes: input.bytes.slice() });
    return meta;
  }

  async get(product: RecordingProduct, entityId: string): Promise<RecordingPayload | null> {
    const row = this.rows.get(this.key(product, entityId));
    return row ? { ...row, bytes: row.bytes.slice() } : null;
  }

  async has(product: RecordingProduct, entityId: string): Promise<boolean> {
    return this.rows.has(this.key(product, entityId));
  }

  async hasMany(product: RecordingProduct, entityIds: string[]): Promise<Record<string, boolean>> {
    const out: Record<string, boolean> = {};
    for (const id of entityIds) out[id] = this.rows.has(this.key(product, id));
    return out;
  }
}

export class S3RecordingStore implements RecordingStore {
  readonly backend = "s3" as const;

  private constructor(
    private sql: Sql,
    private s3: S3Client,
    private bucket: string,
  ) {}

  static async connect(opts: {
    databaseUrl: string;
    endpoint: string;
    accessKeyId: string;
    secretAccessKey: string;
    bucket: string;
    region?: string;
    forcePathStyle?: boolean;
  }): Promise<S3RecordingStore> {
    const sql = postgres(opts.databaseUrl, { max: 5, idle_timeout: 20, connect_timeout: 5 });
    await sql`
      CREATE TABLE IF NOT EXISTS recordings (
        product TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        object_key TEXT NOT NULL,
        content_type TEXT NOT NULL,
        byte_length INT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (product, entity_id)
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS recordings_product_created_idx ON recordings (product, created_at DESC)`;

    const endpoint = opts.endpoint.startsWith("http") ? opts.endpoint : `http://${opts.endpoint}`;
    const s3 = new S3Client({
      region: opts.region ?? "us-east-1",
      endpoint,
      forcePathStyle: opts.forcePathStyle !== false,
      credentials: {
        accessKeyId: opts.accessKeyId,
        secretAccessKey: opts.secretAccessKey,
      },
    });
    return new S3RecordingStore(sql, s3, opts.bucket);
  }

  async put(input: {
    product: RecordingProduct;
    entityId: string;
    bytes: Uint8Array;
    contentType: string;
  }): Promise<RecordingMeta> {
    const ext = extForMime(input.contentType);
    const objectKey = `recordings/${input.product}/${input.entityId}/${randomUUID()}.${ext}`;

    const prev = await this.sql<{ object_key: string }[]>`
      SELECT object_key FROM recordings
      WHERE product = ${input.product} AND entity_id = ${input.entityId}
      LIMIT 1
    `;

    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: objectKey,
        Body: Buffer.from(input.bytes),
        ContentType: input.contentType,
        ContentLength: input.bytes.byteLength,
      }),
    );

    const createdAt = new Date().toISOString();
    await this.sql`
      INSERT INTO recordings (product, entity_id, object_key, content_type, byte_length, created_at)
      VALUES (
        ${input.product},
        ${input.entityId},
        ${objectKey},
        ${input.contentType},
        ${input.bytes.byteLength},
        ${createdAt}
      )
      ON CONFLICT (product, entity_id) DO UPDATE SET
        object_key = EXCLUDED.object_key,
        content_type = EXCLUDED.content_type,
        byte_length = EXCLUDED.byte_length,
        created_at = EXCLUDED.created_at
    `;

    for (const row of prev) {
      if (row.object_key === objectKey) continue;
      try {
        await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: row.object_key }));
      } catch {
        /* best-effort cleanup */
      }
    }

    return {
      product: input.product,
      entityId: input.entityId,
      objectKey,
      contentType: input.contentType,
      byteLength: input.bytes.byteLength,
      createdAt,
    };
  }

  async get(product: RecordingProduct, entityId: string): Promise<RecordingPayload | null> {
    const rows = await this.sql<
      {
        object_key: string;
        content_type: string;
        byte_length: number;
        created_at: Date | string;
      }[]
    >`
      SELECT object_key, content_type, byte_length, created_at
      FROM recordings
      WHERE product = ${product} AND entity_id = ${entityId}
      LIMIT 1
    `;
    const row = rows[0];
    if (!row) return null;

    const obj = await this.s3.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: row.object_key }),
    );
    const bytes = obj.Body ? new Uint8Array(await obj.Body.transformToByteArray()) : new Uint8Array();
    if (!bytes.length) return null;

    return {
      product,
      entityId,
      objectKey: row.object_key,
      contentType: row.content_type,
      byteLength: row.byte_length,
      createdAt: typeof row.created_at === "string" ? row.created_at : row.created_at.toISOString(),
      bytes,
    };
  }

  async has(product: RecordingProduct, entityId: string): Promise<boolean> {
    const rows = await this.sql<{ ok: number }[]>`
      SELECT 1 AS ok FROM recordings
      WHERE product = ${product} AND entity_id = ${entityId}
      LIMIT 1
    `;
    return rows.length > 0;
  }

  async hasMany(product: RecordingProduct, entityIds: string[]): Promise<Record<string, boolean>> {
    const out: Record<string, boolean> = {};
    for (const id of entityIds) out[id] = false;
    const ids = [...new Set(entityIds.filter(Boolean))].slice(0, 200);
    if (!ids.length) return out;
    const rows = await this.sql<{ entity_id: string }[]>`
      SELECT entity_id FROM recordings
      WHERE product = ${product} AND entity_id IN ${this.sql(ids)}
    `;
    for (const r of rows) out[r.entity_id] = true;
    return out;
  }
}

/** Prefer MinIO + Postgres; otherwise in-process (tests / no Docker). */
export async function createRecordingStore(): Promise<RecordingStore> {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  const endpoint = (process.env.MINIO_ENDPOINT ?? process.env.AWS_ENDPOINT_URL ?? "").trim();
  const accessKeyId = (process.env.MINIO_ACCESS_KEY ?? process.env.AWS_ACCESS_KEY_ID ?? "").trim();
  const secretAccessKey = (process.env.MINIO_SECRET_KEY ?? process.env.AWS_SECRET_ACCESS_KEY ?? "").trim();
  const bucket = (process.env.MINIO_BUCKET ?? "pyai-suite").trim();

  if (!databaseUrl || !endpoint || !accessKeyId || !secretAccessKey || !bucket) {
    return new MemoryRecordingStore();
  }
  try {
    return await S3RecordingStore.connect({
      databaseUrl,
      endpoint,
      accessKeyId,
      secretAccessKey,
      bucket,
      region: process.env.AWS_DEFAULT_REGION?.trim() || "us-east-1",
    });
  } catch {
    return new MemoryRecordingStore();
  }
}
