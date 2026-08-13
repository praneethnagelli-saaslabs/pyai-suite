import type { RealtimeEvent } from "./adapter.js";

export const OMNI_KIND = { AUDIO: 0x01, TRANSCRIPT: 0x02, CONTROL: 0x03 } as const;
export const PCM_RATE = 24_000;

export function taggedFrame(kind: number, payload: Uint8Array | string): Uint8Array {
  const body = typeof payload === "string" ? new TextEncoder().encode(payload) : payload;
  const frame = new Uint8Array(body.byteLength + 1);
  frame[0] = kind;
  frame.set(body, 1);
  return frame;
}

export function classifyRealtimeFailure(err: unknown): {
  reason: import("./adapter.js").RealtimeFallbackReason;
  message: string;
} {
  const raw = err instanceof Error ? err.message : String(err);
  const msg = raw.replace(/[A-Za-z0-9_\-]{20,}/g, "…").slice(0, 180);
  const lower = raw.toLowerCase();
  if (/timeout|timed out|etimedout/.test(lower)) return { reason: "TIMEOUT", message: msg };
  if (/429|rate limit/.test(lower)) return { reason: "RATE_LIMIT", message: msg };
  if (
    /401|403|unavailable|not configured|missing|no longer supported|beta_api|realtime beta/.test(
      lower,
    )
  ) {
    return { reason: "UNAVAILABLE", message: msg };
  }
  if (/econn|socket|handshake|enotfound|connect/.test(lower)) return { reason: "CONNECTION", message: msg };
  if (/malformed|invalid json|unexpected/.test(lower)) return { reason: "MALFORMED", message: msg };
  if (/stream|ws/.test(lower)) return { reason: "STREAM", message: msg };
  return { reason: "ERROR", message: msg };
}

export function tonePcm(freq = 440, seconds = 0.35, rate = PCM_RATE, gain = 0.18): Uint8Array {
  const n = Math.max(1, Math.floor(rate * seconds));
  const out = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    const s = Math.sin((2 * Math.PI * freq * i) / rate) * gain;
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return new Uint8Array(out.buffer);
}

/** RFC 6455 token — keys with `/` `=` etc. cannot go in Sec-WebSocket-Protocol. */
export function isWsSubprotocol(value: string): boolean {
  if (!value.length) return false;
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c < 0x21 || c > 0x7e) return false;
    if (
      c === 0x22 ||
      c === 0x28 ||
      c === 0x29 ||
      c === 0x2c ||
      c === 0x2f ||
      c === 0x3a ||
      c === 0x3b ||
      c === 0x3c ||
      c === 0x3d ||
      c === 0x3e ||
      c === 0x3f ||
      c === 0x40 ||
      c === 0x5b ||
      c === 0x5c ||
      c === 0x5d ||
      c === 0x7b ||
      c === 0x7d
    ) {
      return false;
    }
  }
  return true;
}

export function connectWebSocket(
  url: string,
  protocols: string[],
  timeoutMs: number,
  headers?: Record<string, string>,
  onMessage?: (data: unknown) => void,
): Promise<WebSocket> {
  const safeProtocols = protocols.filter(isWsSubprotocol);
  return new Promise((resolve, reject) => {
    let settled = false;
    let ws: WebSocket;
    const init =
      headers && Object.keys(headers).length > 0
        ? ({ protocols: safeProtocols, headers } as unknown as string[])
        : safeProtocols;
    try {
      ws = new WebSocket(url, init);
    } catch {
      try {
        ws = new WebSocket(url, safeProtocols);
      } catch (err) {
        reject(err instanceof Error ? err : new Error("connection failed"));
        return;
      }
    }
    ws.binaryType = "arraybuffer";
    if (onMessage) {
      ws.addEventListener("message", (ev) => onMessage(ev.data));
    }
    const done = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };
    const timer = setTimeout(() => {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      done(() => reject(new Error("timeout")));
    }, timeoutMs);
    ws.addEventListener("open", () => {
      clearTimeout(timer);
      done(() => resolve(ws));
    });
    ws.addEventListener("error", () => {
      clearTimeout(timer);
      done(() => reject(new Error("connection failed")));
    });
    ws.addEventListener("close", (ev) => {
      clearTimeout(timer);
      const code = typeof (ev as CloseEvent).code === "number" ? (ev as CloseEvent).code : 0;
      done(() => reject(new Error(code ? `connection failed (${code})` : "connection failed")));
    });
  });
}

export function frameBytes(data: unknown): Uint8Array | null {
  if (!data) return null;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(data)) return new Uint8Array(data);
  return null;
}

export class EventBus {
  private queue: RealtimeEvent[] = [];
  private waiters: Array<(value: IteratorResult<RealtimeEvent>) => void> = [];
  private closed = false;

  push(event: RealtimeEvent): void {
    if (this.closed) return;
    const wait = this.waiters.shift();
    if (wait) wait({ value: event, done: false });
    else this.queue.push(event);
  }

  end(): void {
    if (this.closed) return;
    this.closed = true;
    for (const wait of this.waiters) wait({ value: undefined, done: true });
    this.waiters = [];
  }

  async *events(): AsyncIterable<RealtimeEvent> {
    while (true) {
      if (this.queue.length) {
        yield this.queue.shift()!;
        continue;
      }
      if (this.closed) return;
      const next = await new Promise<IteratorResult<RealtimeEvent>>((resolve) => {
        this.waiters.push(resolve);
      });
      if (next.done) return;
      yield next.value;
    }
  }
}
