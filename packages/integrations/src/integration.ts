export interface IntegrationSendInput {
  title: string;
  body: string;
  /** Optional structured blocks (e.g. Slack blocks, Notion rich content). */
  blocks?: unknown[];
  /** Optional link back to the shareable artifact. */
  url?: string;
  /** Free-form metadata used by some destinations. */
  meta?: Record<string, unknown>;
}

export interface IntegrationAdapter {
  readonly id: string; // "slack" | "notion" | "hubspot" | "webhook" | ...
  readonly label: string;
  /** Whether credentials are present and the adapter can send. */
  isConfigured(): boolean;
  send(input: IntegrationSendInput): Promise<{ ok: boolean; externalId?: string; error?: string }>;
}

/** Registry of configured integrations. */
export class IntegrationRegistry {
  private adapters = new Map<string, IntegrationAdapter>();

  register(a: IntegrationAdapter): void {
    this.adapters.set(a.id, a);
  }

  get(id: string): IntegrationAdapter | undefined {
    return this.adapters.get(id);
  }

  list(): Array<{ id: string; label: string; configured: boolean }> {
    return Array.from(this.adapters.values()).map((a) => ({ id: a.id, label: a.label, configured: a.isConfigured() }));
  }

  async send(id: string, input: IntegrationSendInput): Promise<{ ok: boolean; externalId?: string; error?: string }> {
    const a = this.adapters.get(id);
    if (!a) return { ok: false, error: `unknown integration ${id}` };
    if (!a.isConfigured()) return { ok: false, error: `integration ${id} not configured` };
    return a.send(input);
  }
}
