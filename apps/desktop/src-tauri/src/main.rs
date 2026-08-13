//! Desktop native entry (spec #70).
//! Planned Tauri commands (wired from `apps/desktop/src/bridge.ts`):
//!   start_capture | stop_capture | insert_text | get_active_app | has_provider_key
//! Secrets stay in OS secure storage — never returned to the webview.

fn main() {
    println!("pyai-desktop scaffold");
    println!("Install Rust + Tauri CLI, then: cargo tauri dev");
    println!("IPC: start_capture, stop_capture, insert_text, get_active_app, has_provider_key");
}
