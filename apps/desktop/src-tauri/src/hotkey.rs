//! Control+Shift+1 push-to-talk via Carbon RegisterEventHotKey.
//! Press/release are delivered by the system hotkey API (no event tap, no AX).

use std::ffi::c_void;
use std::fs::OpenOptions;
use std::io::Write;
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

struct Cbs {
    down: Box<dyn Fn() + Send + Sync>,
    up: Box<dyn Fn() + Send + Sync>,
}

static CBS: OnceLock<Mutex<Option<Cbs>>> = OnceLock::new();

fn cbs() -> &'static Mutex<Option<Cbs>> {
    CBS.get_or_init(|| Mutex::new(None))
}

fn note(msg: &str) {
    if let Ok(mut f) = OpenOptions::new()
        .create(true)
        .append(true)
        .open("/tmp/pyai-scrib.log")
    {
        let ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0);
        let _ = writeln!(f, "{ms} {msg}");
    }
}

#[repr(C)]
struct EventTypeSpec {
    event_class: u32,
    event_kind: u32,
}

#[repr(C)]
#[derive(Clone, Copy)]
struct EventHotKeyID {
    signature: u32,
    id: u32,
}

type EventHandlerRef = *mut c_void;
type EventHotKeyRef = *mut c_void;
type EventTargetRef = *mut c_void;
type EventHandlerCallRef = *mut c_void;
type EventRef = *mut c_void;

const NO_ERR: i32 = 0;
const EVENT_CLASS_KEYBOARD: u32 = u32::from_be_bytes(*b"keyb");
const HOTKEY_PRESSED: u32 = 5;
const HOTKEY_RELEASED: u32 = 6;
const SHIFT_KEY: u32 = 1 << 9;
const CONTROL_KEY: u32 = 1 << 12;
const KEY_ANSI_1: u32 = 0x12;
const SIGNATURE: u32 = u32::from_be_bytes(*b"srib");

#[link(name = "Carbon", kind = "framework")]
extern "C" {
    fn GetApplicationEventTarget() -> EventTargetRef;
    fn GetEventDispatcherTarget() -> EventTargetRef;
    fn InstallEventHandler(
        target: EventTargetRef,
        handler: unsafe extern "C" fn(EventHandlerCallRef, EventRef, *mut c_void) -> i32,
        num_types: u64,
        list: *const EventTypeSpec,
        user_data: *mut c_void,
        out_handler: *mut EventHandlerRef,
    ) -> i32;
    fn RegisterEventHotKey(
        hot_key_code: u32,
        hot_key_modifiers: u32,
        hot_key_id: EventHotKeyID,
        target: EventTargetRef,
        options: u32,
        out_ref: *mut EventHotKeyRef,
    ) -> i32;
    fn GetEventKind(event: EventRef) -> u32;
}

unsafe extern "C" fn hotkey_handler(
    _next: EventHandlerCallRef,
    event: EventRef,
    _user: *mut c_void,
) -> i32 {
    let kind = unsafe { GetEventKind(event) };
    if let Ok(guard) = cbs().lock() {
        if let Some(cb) = guard.as_ref() {
            if kind == HOTKEY_PRESSED {
                note("carbon hotkey pressed");
                (cb.down)();
            } else if kind == HOTKEY_RELEASED {
                note("carbon hotkey released");
                (cb.up)();
            }
        }
    }
    NO_ERR
}

/// Must run on the AppKit/Carbon main thread (Tauri setup is fine).
pub fn install(on_down: impl Fn() + Send + Sync + 'static, on_up: impl Fn() + Send + Sync + 'static) -> Result<(), String> {
    note("carbon install() entered");
    {
        let mut slot = cbs().lock().map_err(|e| e.to_string())?;
        *slot = Some(Cbs {
            down: Box::new(on_down),
            up: Box::new(on_up),
        });
    }

    unsafe {
        let app_target = GetApplicationEventTarget();
        let dispatch_target = GetEventDispatcherTarget();
        note(&format!(
            "targets app={app_target:?} dispatch={dispatch_target:?}"
        ));
        let target = if !app_target.is_null() {
            app_target
        } else {
            dispatch_target
        };
        if target.is_null() {
            return Err("no Carbon event target".into());
        }
        let specs = [
            EventTypeSpec {
                event_class: EVENT_CLASS_KEYBOARD,
                event_kind: HOTKEY_PRESSED,
            },
            EventTypeSpec {
                event_class: EVENT_CLASS_KEYBOARD,
                event_kind: HOTKEY_RELEASED,
            },
        ];
        for t in [app_target, dispatch_target] {
            if t.is_null() {
                continue;
            }
            let mut handler_ref: EventHandlerRef = std::ptr::null_mut();
            let st = InstallEventHandler(
                t,
                hotkey_handler,
                specs.len() as u64,
                specs.as_ptr(),
                std::ptr::null_mut(),
                &mut handler_ref,
            );
            note(&format!("InstallEventHandler {t:?} => {st}"));
            if st != NO_ERR {
                return Err(format!("InstallEventHandler failed ({st})"));
            }
        }
        let id = EventHotKeyID {
            signature: SIGNATURE,
            id: 1,
        };
        let mut hk: EventHotKeyRef = std::ptr::null_mut();
        let st = RegisterEventHotKey(
            KEY_ANSI_1,
            CONTROL_KEY | SHIFT_KEY,
            id,
            target,
            0,
            &mut hk,
        );
        note(&format!("RegisterEventHotKey => {st} ref={hk:?}"));
        if st != NO_ERR {
            return Err(format!("RegisterEventHotKey failed ({st})"));
        }
    }
    note("carbon hotkey registered ctrl+shift+1");
    Ok(())
}
