import type { IntegrationAdapter, IntegrationSendInput } from "./integration.js";

/**
 * Slack integration (spec #81, priority). Posts product output as a message.
 * Credentials (bot token) come from env; never embedded in client code.
 */
export class SlackIntegration implements IntegrationAdapter {
  readonly id = "slack";
  readonly label = "Slack";
  private token: string | undefined;
  private channel: string | undefined;

  constructor(opts?: { token?: string; channel?: string }) {
    this.token = opts?.token ?? process.env.SLACK_BOT_TOKEN;
    this.channel = opts?.channel ?? process.env.SLACK_CHANNEL;
  }

  isConfigured(): boolean {
    return Boolean(this.token && this.channel);
  }

  async send(input: IntegrationSendInput): Promise<{ ok: boolean; externalId?: string; error?: string }> {
    if (!this.token || !this.channel) return { ok: false, error: "slack not configured" };
    try {
      const res = await fetch("https://slack.com/api/chat.postMessage", {
        method: "POST",
        headers: { "content-type": "application/json", Authorization: `Bearer ${this.token}` },
        body: JSON.stringify({
          channel: this.channel,
          text: `*${input.title}*\n${input.body}`,
          blocks: input.blocks,
          ...(input.url ? { attachments: [{ title: "Open", title_link: input.url }] } : {}),
        }),
      });
      const data = (await res.json()) as { ok: boolean; ts?: string; error?: string };
      return { ok: Boolean(data.ok), externalId: data.ts, error: data.error };
    } catch (e: unknown) {
      return { ok: false, error: String(e) };
    }
  }
}

/**
 * Notion integration (spec #81). Appends product output as a page block.
 * Shown as a reference; requires NOTION_TOKEN + a page id.
 */
export class NotionIntegration implements IntegrationAdapter {
  readonly id = "notion";
  readonly label = "Notion";
  private token: string | undefined;
  private pageId: string | undefined;

  constructor(opts?: { token?: string; pageId?: string }) {
    this.token = opts?.token ?? process.env.NOTION_TOKEN;
    this.pageId = opts?.pageId ?? process.env.NOTION_PAGE_ID;
  }

  isConfigured(): boolean {
    return Boolean(this.token && this.pageId);
  }

  async send(input: IntegrationSendInput): Promise<{ ok: boolean; externalId?: string; error?: string }> {
    if (!this.token || !this.pageId) return { ok: false, error: "notion not configured" };
    try {
      const res = await fetch(`https://api.notion.com/v1/blocks/${this.pageId}/children`, {
        method: "PATCH",
        headers: { "content-type": "application/json", Authorization: `Bearer ${this.token}`, "Notion-Version": "2022-06-28" },
        body: JSON.stringify({
          children: [
            { object: "block", type: "heading_2", heading_2: { rich_text: [{ text: { content: input.title } }] } },
            { object: "block", type: "paragraph", paragraph: { rich_text: [{ text: { content: input.body } }] } },
          ],
        }),
      });
      const data = (await res.json()) as { id?: string };
      return { ok: res.ok, externalId: data.id, error: res.ok ? undefined : "notion rejected" };
    } catch (e: unknown) {
      return { ok: false, error: String(e) };
    }
  }
}

/**
 * Generic webhook integration (spec #81, Zapier/webhooks). The lowest-friction
 * integration: point it at any URL and it POSTs the payload. HMAC optional.
 */
export class WebhookIntegration implements IntegrationAdapter {
  readonly id = "webhook";
  readonly label = "Webhook / Zapier";
  private url: string;
  private secret?: string;

  constructor(url: string, secret?: string) {
    this.url = url;
    this.secret = secret;
  }

  isConfigured(): boolean {
    return Boolean(this.url);
  }

  async send(input: IntegrationSendInput): Promise<{ ok: boolean; externalId?: string; error?: string }> {
    try {
      const body = JSON.stringify(input);
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (this.secret) {
        const sig = `sha256=${await hmac(this.secret, body)}`;
        headers["x-pyai-signature"] = sig;
      }
      const res = await fetch(this.url, { method: "POST", headers, body });
      return { ok: res.ok, error: res.ok ? undefined : `status ${res.status}` };
    } catch (e: unknown) {
      return { ok: false, error: String(e) };
    }
  }
}

async function hmac(secret: string, body: string): Promise<string> {
  const { createHmac } = await import("node:crypto");
  return createHmac("sha256", secret).update(body).digest("hex");
}
