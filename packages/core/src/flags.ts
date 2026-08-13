/**
 * Feature flags (spec #82). Flags gate experimental providers/models, automatic
 * routing, new workflow versions, and beta UI. Evaluated centrally; defaults can
 * be overridden by env or config without code changes.
 */
export type FlagName =
  | "experimental_providers"
  | "experimental_models"
  | "automatic_routing"
  | "new_workflow_versions"
  | "beta_ui";

const DEFAULTS: Record<FlagName, boolean> = {
  experimental_providers: false,
  experimental_models: false,
  automatic_routing: true,
  new_workflow_versions: true,
  beta_ui: false,
};

export class FeatureFlags {
  private overrides = new Map<FlagName, boolean>();

  constructor(env: Record<string, string | undefined> = process.env) {
    for (const key of Object.keys(DEFAULTS) as FlagName[]) {
      const envKey = `FLAG_${key.toUpperCase()}`;
      if (env[envKey] != null) this.overrides.set(key, env[envKey] === "1" || env[envKey] === "true");
    }
  }

  isOn(flag: FlagName): boolean {
    const o = this.overrides.get(flag);
    return o ?? DEFAULTS[flag];
  }

  set(flag: FlagName, value: boolean): void {
    this.overrides.set(flag, value);
  }

  all(): Record<FlagName, boolean> {
    return { ...DEFAULTS, ...Object.fromEntries(this.overrides) } as Record<FlagName, boolean>;
  }
}
