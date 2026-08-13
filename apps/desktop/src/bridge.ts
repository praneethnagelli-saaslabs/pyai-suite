/**
 * Desktop bridge contract (spec #70).
 * Rust/Tauri owns: global hotkeys, mic/system audio, clipboard, secure storage.
 * This TS module is the IPC surface the React UI talks to.
 */

export type DesktopCapability =
  | "global_hotkey"
  | "mic_capture"
  | "system_audio"
  | "clipboard"
  | "secure_storage"
  | "text_insert";

export interface DesktopBridge {
  isAvailable(): boolean;
  capabilities(): DesktopCapability[];
  /** Start push-to-talk / toggle recording. Audio stays local until a remote STT provider is chosen. */
  startCapture(opts?: { systemAudio?: boolean }): Promise<{ sessionId: string }>;
  stopCapture(sessionId: string): Promise<{ pcm: Uint8Array; sampleRate: number }>;
  insertText(text: string): Promise<void>;
  getActiveApp(): Promise<{ name: string; title: string }>;
  /** Secrets never leave secure storage into the webview. */
  hasProviderKey(providerId: string): Promise<boolean>;
}

type InvokeFn = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

function getInvoke(): InvokeFn | null {
  const w = globalThis as {
    __TAURI__?: { core?: { invoke?: InvokeFn }; invoke?: InvokeFn };
  };
  return w.__TAURI__?.core?.invoke ?? w.__TAURI__?.invoke ?? null;
}

/** Browser/dev stub — real impl lives in src-tauri. */
export class StubDesktopBridge implements DesktopBridge {
  isAvailable(): boolean {
    return false;
  }
  capabilities(): DesktopCapability[] {
    return [];
  }
  async startCapture(): Promise<{ sessionId: string }> {
    throw new Error("desktop bridge unavailable — use Tauri build");
  }
  async stopCapture(): Promise<{ pcm: Uint8Array; sampleRate: number }> {
    throw new Error("desktop bridge unavailable");
  }
  async insertText(): Promise<void> {
    throw new Error("desktop bridge unavailable");
  }
  async getActiveApp(): Promise<{ name: string; title: string }> {
    return { name: "browser", title: "dev" };
  }
  async hasProviderKey(): Promise<boolean> {
    return false;
  }
}

export class TauriDesktopBridge implements DesktopBridge {
  constructor(private invoke: InvokeFn) {}

  isAvailable(): boolean {
    return true;
  }
  capabilities(): DesktopCapability[] {
    return ["global_hotkey", "mic_capture", "system_audio", "clipboard", "secure_storage", "text_insert"];
  }
  async startCapture(opts?: { systemAudio?: boolean }): Promise<{ sessionId: string }> {
    const res = await this.invoke<{ session_id?: string; sessionId?: string }>("start_capture", {
      systemAudio: opts?.systemAudio ?? false,
    });
    return { sessionId: res.sessionId ?? res.session_id ?? "unknown" };
  }
  async stopCapture(sessionId: string): Promise<{ pcm: Uint8Array; sampleRate: number }> {
    const res = await this.invoke<{ pcm?: number[]; sampleRate?: number }>("stop_capture", { sessionId });
    return { pcm: Uint8Array.from(res.pcm ?? []), sampleRate: res.sampleRate ?? 16000 };
  }
  async insertText(text: string): Promise<void> {
    await this.invoke("insert_text", { text });
  }
  async getActiveApp(): Promise<{ name: string; title: string }> {
    return this.invoke("get_active_app");
  }
  async hasProviderKey(providerId: string): Promise<boolean> {
    // Boolean only — never fetch or display the secret material.
    return this.invoke("has_provider_key", { providerId });
  }
}

export function createDesktopBridge(): DesktopBridge {
  const invoke = getInvoke();
  if (invoke) return new TauriDesktopBridge(invoke);
  return new StubDesktopBridge();
}
