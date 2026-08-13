//! Menu-bar Scrib (spec #70). Tray + on-screen bezel — no main UI window.
//! Keys stay in the local API. This process never prints transcripts or secrets.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod hotkey;
mod scrib;

use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::Sender;
use std::sync::Mutex;
use std::thread;
use std::time::Duration;

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, LogicalPosition, Manager, WebviewWindow};

use crate::scrib::{ActiveApp, RecCmd};

struct AppState {
    mic: Sender<RecCmd>,
    status_item: Mutex<Option<MenuItem<tauri::Wry>>>,
    listening: AtomicBool,
    transcribing: AtomicBool,
    target_app: Mutex<Option<ActiveApp>>,
}

fn set_tray(app: &AppHandle, text: &str) {
    let app = app.clone();
    let text = text.to_string();
    let _ = app.run_on_main_thread({
        let app = app.clone();
        move || {
            if let Some(state) = app.try_state::<AppState>() {
                if let Ok(guard) = state.status_item.lock() {
                    if let Some(item) = guard.as_ref() {
                        let _ = item.set_text(&text);
                    }
                }
            }
            if let Some(tray) = app.tray_by_id("scrib") {
                let _ = tray.set_tooltip(Some(&text));
            }
        }
    });
}

/// Points from the bottom of the screen that are covered by the Dock (0 if Dock is on a side).
#[cfg(target_os = "macos")]
fn dock_bottom_inset() -> f64 {
    use objc2::MainThreadMarker;
    use objc2_app_kit::NSScreen;
    let Some(mtm) = MainThreadMarker::new() else {
        return 80.0;
    };
    NSScreen::mainScreen(mtm)
        .map(|screen| {
            let frame = screen.frame();
            let visible = screen.visibleFrame();
            (visible.origin.y - frame.origin.y).max(0.0)
        })
        .unwrap_or(80.0)
}

fn place_bezel(w: &WebviewWindow) {
    let _ = w.set_always_on_top(true);
    let _ = w.unminimize();
    if let Ok(Some(monitor)) = w.primary_monitor() {
        let scale = monitor.scale_factor();
        let origin = monitor.position().to_logical::<f64>(scale);
        let screen = monitor.size().to_logical::<f64>(scale);
        let width = 448.0;
        let height = 88.0;
        let gap = 20.0;
        #[cfg(target_os = "macos")]
        let inset = dock_bottom_inset();
        #[cfg(not(target_os = "macos"))]
        let inset = 0.0;
        let x = origin.x + (screen.width - width) / 2.0;
        let y = origin.y + screen.height - height - inset - gap;
        let _ = w.set_size(tauri::LogicalSize::new(width, height));
        let _ = w.set_position(LogicalPosition::new(x, y));
    } else {
        let _ = w.center();
    }
}

fn push_bezel_now(app: &AppHandle, phase: &str, detail: &str) {
    let Some(w) = app.get_webview_window("main") else {
        return;
    };
    let phase_js = serde_json::to_string(phase).unwrap_or_else(|_| "\"idle\"".into());
    let detail_js = serde_json::to_string(detail).unwrap_or_else(|_| "\"\"".into());
    let _ = w.eval(&format!(
        "window.__scribBezel && window.__scribBezel({phase_js},{detail_js})"
    ));
    if phase == "idle" {
        let _ = w.hide();
        return;
    }
    place_bezel(&w);
    let _ = w.show();
}

fn push_bezel(app: &AppHandle, phase: &str, detail: &str) {
    let app = app.clone();
    let phase = phase.to_string();
    let detail = detail.to_string();
    let _ = app.run_on_main_thread({
        let app = app.clone();
        move || push_bezel_now(&app, &phase, &detail)
    });
}

fn hide_bezel_for_paste(app: &AppHandle) {
    let app = app.clone();
    let _ = app.run_on_main_thread({
        let app = app.clone();
        move || {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.hide();
            }
        }
    });
}

fn flash_then_idle(app: AppHandle, phase: &'static str, detail: String, tray: String) {
    set_tray(&app, &tray);
    push_bezel(&app, phase, &detail);
    thread::spawn(move || {
        thread::sleep(Duration::from_millis(1800));
        set_tray(&app, "Idle — hold Control+Shift+1");
        push_bezel(&app, "idle", "");
    });
}

fn on_ptt_down(app: AppHandle) {
    push_bezel(&app, "listening", "");
    let Some(state) = app.try_state::<AppState>() else {
        return;
    };
    if state.listening.load(Ordering::SeqCst) || state.transcribing.load(Ordering::SeqCst) {
        return;
    }
    start_listening(app);
}

fn on_ptt_up(app: AppHandle) {
    let Some(state) = app.try_state::<AppState>() else {
        return;
    };
    if !state.listening.load(Ordering::SeqCst) || state.transcribing.load(Ordering::SeqCst) {
        return;
    }
    stop_and_paste(app);
}

fn start_listening(app: AppHandle) {
    let Some(state) = app.try_state::<AppState>() else {
        return;
    };
    let target = scrib::frontmost_app();
    if let Ok(mut slot) = state.target_app.lock() {
        *slot = Some(target.clone());
    }
    match scrib::mic_start(&state.mic) {
        Ok(()) => {
            state.listening.store(true, Ordering::SeqCst);
            set_tray(&app, "Listening… release to paste");
            push_bezel(&app, "listening", &target.name);
        }
        Err(e) => {
            state.listening.store(false, Ordering::SeqCst);
            flash_then_idle(app, "error", e.clone(), e);
        }
    }
}

fn stop_and_paste(app: AppHandle) {
    let Some(state) = app.try_state::<AppState>() else {
        return;
    };
    state.listening.store(false, Ordering::SeqCst);
    state.transcribing.store(true, Ordering::SeqCst);
    set_tray(&app, "Transcribing…");
    let for_app = state
        .target_app
        .lock()
        .ok()
        .and_then(|g| g.as_ref().map(|a| a.name.clone()))
        .unwrap_or_default();
    push_bezel(&app, "transcribing", &for_app);

    let wav = match scrib::mic_stop(&state.mic) {
        Ok(w) => w,
        Err(e) => {
            state.transcribing.store(false, Ordering::SeqCst);
            flash_then_idle(app, "error", e.clone(), e);
            return;
        }
    };
    let target = state
        .target_app
        .lock()
        .ok()
        .and_then(|g| g.clone())
        .unwrap_or_else(scrib::frontmost_app);

    thread::Builder::new()
        .name("scrib-transcribe".into())
        .spawn(move || {
            let result = scrib::transcribe(&wav, &target);
            if let Some(state) = app.try_state::<AppState>() {
                state.transcribing.store(false, Ordering::SeqCst);
            }
            match result {
                Ok(text) => {
                    hide_bezel_for_paste(&app);
                    thread::sleep(Duration::from_millis(80));
                    match scrib::insert_text(&text) {
                        Ok(()) => flash_then_idle(
                            app,
                            "pasted",
                            "".into(),
                            "Pasted — hold Control+Shift+1".into(),
                        ),
                        Err(e) if e == scrib::NEED_ACCESSIBILITY => {
                            set_tray(&app, &e);
                            push_bezel(&app, "needax", "");
                            thread::spawn(move || {
                                thread::sleep(Duration::from_millis(8000));
                                set_tray(&app, "Idle — hold Control+Shift+1");
                                push_bezel(&app, "idle", "");
                            });
                        }
                        Err(e) => flash_then_idle(app, "error", e.clone(), e),
                    }
                }
                Err(e) => flash_then_idle(app, "error", e.clone(), e),
            }
        })
        .ok();
}

#[tauri::command]
fn start_capture(
    app: AppHandle,
    _system_audio: Option<bool>,
) -> Result<serde_json::Value, String> {
    let state = app.state::<AppState>();
    scrib::mic_start(&state.mic)?;
    Ok(serde_json::json!({ "sessionId": "mic" }))
}

#[tauri::command]
fn stop_capture(app: AppHandle, _session_id: Option<String>) -> Result<serde_json::Value, String> {
    let state = app.state::<AppState>();
    let wav = scrib::mic_stop(&state.mic)?;
    Ok(serde_json::json!({
        "pcm": Vec::<u8>::new(),
        "sampleRate": 16000,
        "wavBytes": wav.len(),
    }))
}

#[tauri::command]
fn insert_text(text: String) -> Result<(), String> {
    scrib::insert_text(&text)
}

#[tauri::command]
fn get_active_app() -> serde_json::Value {
    let a = scrib::frontmost_app();
    serde_json::json!({ "name": a.name, "title": a.title })
}

#[tauri::command]
fn has_provider_key(_provider_id: String) -> bool {
    false
}

fn open_web_ui() {
    let _ = Command::new("open").arg("http://localhost:3000").spawn();
}

fn main() {
    let mic = scrib::spawn_mic();

    tauri::Builder::default()
        .manage(AppState {
            mic,
            status_item: Mutex::new(None),
            listening: AtomicBool::new(false),
            transcribing: AtomicBool::new(false),
            target_app: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            start_capture,
            stop_capture,
            insert_text,
            get_active_app,
            has_provider_key
        ])
        .setup(move |app| {
            let status = MenuItem::with_id(
                app,
                "status",
                "Idle — hold Control+Shift+1",
                false,
                None::<&str>,
            )?;
            let test = MenuItem::with_id(app, "test", "Test bezel", true, None::<&str>)?;
            let listen = MenuItem::with_id(app, "listen", "Start listening", true, None::<&str>)?;
            let stop = MenuItem::with_id(app, "stop", "Stop and paste", true, None::<&str>)?;
            let open = MenuItem::with_id(app, "open", "Open web UI", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit Scrib", true, None::<&str>)?;
            let menu = Menu::with_items(
                app,
                &[
                    &status,
                    &PredefinedMenuItem::separator(app)?,
                    &listen,
                    &stop,
                    &test,
                    &open,
                    &quit,
                ],
            )?;

            let icon = tauri::image::Image::from_bytes(include_bytes!("../icons/tray.png"))
                .map_err(|e| e.to_string())?;

            TrayIconBuilder::with_id("scrib")
                .icon(icon)
                .icon_as_template(true)
                .menu(&menu)
                .show_menu_on_left_click(true)
                .tooltip("PyAI Scrib")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => open_web_ui(),
                    "listen" => on_ptt_down(app.clone()),
                    "stop" => on_ptt_up(app.clone()),
                    "test" => {
                        push_bezel(app, "listening", "");
                        let app = app.clone();
                        thread::spawn(move || {
                            thread::sleep(Duration::from_millis(2000));
                            push_bezel(&app, "idle", "");
                        });
                    }
                    "quit" => std::process::exit(0),
                    _ => {}
                })
                .build(app)?;

            if let Some(win) = app.get_webview_window("main") {
                let _ = win.set_shadow(false);
                let _ = win.set_background_color(Some(tauri::window::Color(0, 0, 0, 0)));
                place_bezel(&win);
            }

            if let Some(state) = app.try_state::<AppState>() {
                if let Ok(mut slot) = state.status_item.lock() {
                    *slot = Some(status);
                }
            }

            push_bezel_now(app.handle(), "listening", "");
            let ready = app.handle().clone();
            thread::spawn(move || {
                thread::sleep(Duration::from_millis(2500));
                push_bezel(&ready, "idle", "");
            });

            let handle = app.handle().clone();
            let handle_up = handle.clone();
            match crate::hotkey::install(
                move || on_ptt_down(handle.clone()),
                move || on_ptt_up(handle_up.clone()),
            ) {
                Ok(()) => set_tray(app.handle(), "Idle — hold Control+Shift+1"),
                Err(e) => {
                    set_tray(app.handle(), &e);
                    push_bezel(app.handle(), "error", &e);
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("PyAI Scrib failed to start");
}
