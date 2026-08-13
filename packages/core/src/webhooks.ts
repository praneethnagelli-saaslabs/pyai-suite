import { createHmac, timingSafeEqual } from "node:crypto";
import type { WebhookEvent, WebhookSubscription, WebhookDelivery } from "./types.js";
import { shortId } from "./util/ids.js";
import { logger } from "./util/logger.js";

/**
 * Webhook dispatcher (spec #80). External systems subscribe to platform events.
 * Deliveries are signed with HMAC-SHA256 (secret never returned to clients).
 * Delivery is best-effort and fire-and-forget; failures are logged, never thrown
 * into the workflow path (webhooks must not block a run — spec #156).
 */
export class WebhookBus {
  private subs: WebhookSubscription[] = [];
  private deliveries: WebhookDelivery[] = [];

  subscribe(url: string, events: WebhookEvent[], secret?: string): WebhookSubscription {
    const sub: WebhookSubscription = { id: shortId("wh"), url, events, secret, active: true };
    this.subs.push(sub);
    return sub;
  }

  unsubscribe(id: string): boolean {
    const before = this.subs.length;
    this.subs = this.subs.filter((s) => s.id !== id);
    return this.subs.length < before;
  }

  list(includeSecret = false): WebhookSubscription[] {
    return this.subs.map((s) => (includeSecret ? s : { ...s, secret: undefined }));
  }

  /** Emit an event to all matching active subscribers. */
  async emit(event: WebhookEvent, product: string, payload: Record<string, unknown>, runId?: string): Promise<void> {
    const delivery: WebhookDelivery = { event, product, payload, runId, at: Date.now() };
    this.deliveries.push(delivery);
    const targets = this.subs.filter((s) => s.active && s.events.includes(event));
    await Promise.all(
      targets.map(async (s) => {
        try {
          const body = JSON.stringify({ event, product, runId, at: delivery.at, payload });
          const sig = s.secret ? `sha256=${createHmac("sha256", s.secret).update(body).digest("hex")}` : undefined;
          const res = await fetch(s.url, {
            method: "POST",
            headers: { "content-type": "application/json", ...(sig ? { "x-pyai-signature": sig } : {}) },
            body,
          });
          if (!res.ok) logger.warn("webhook: non-ok response", { url: s.url, status: res.status });
        } catch (e: unknown) {
          logger.warn("webhook: delivery failed", { url: s.url, err: String(e) });
        }
      }),
    );
  }

  /** Verify an incoming webhook signature (for inbound webhooks from providers). */
  static verify(secret: string, body: string, signature: string): boolean {
    const expected = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
    const a = Buffer.from(expected);
    const b = Buffer.from(signature);
    return a.length === b.length && timingSafeEqual(a, b);
  }
}
