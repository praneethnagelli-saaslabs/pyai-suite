//! Mic capture, frontmost-app context, local transcribe, caret paste.
//! Secrets never leave the API. Transcripts are not logged.

use std::io::Cursor;
use std::sync::mpsc::{self, Sender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use arboard::Clipboard;
use base64::Engine;
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{SampleFormat, Stream, StreamConfig};
use enigo::{Direction, Enigo, Key, Keyboard, Settings};
use serde::Deserialize;

const DEFAULT_API: &str = "http://127.0.0.1:4000";

#[derive(Clone, Debug)]
pub struct ActiveApp {
    pub name: String,
    pub title: String,
    pub bundle_id: String,
}

#[derive(Default)]
struct RecInner {
    samples: Vec<f32>,
    sample_rate: u32,
    channels: u16,
}

pub struct Recorder {
    inner: Arc<Mutex<RecInner>>,
    stream: Option<Stream>,
}

pub enum RecCmd {
    Start { reply: Sender<Result<(), String>> },
    Stop { reply: Sender<Result<Vec<u8>, String>> },
}

/// Mic lives on one thread — cpal's Stream is not Send on macOS.
pub fn spawn_mic() -> Sender<RecCmd> {
    let (tx, rx) = mpsc::channel::<RecCmd>();
    thread::Builder::new()
        .name("scrib-mic".into())
        .spawn(move || {
            let mut rec = Recorder::new();
            while let Ok(cmd) = rx.recv() {
                match cmd {
                    RecCmd::Start { reply } => {
                        let _ = reply.send(rec.start());
                    }
                    RecCmd::Stop { reply } => {
                        let _ = reply.send(rec.stop_wav());
                    }
                }
            }
        })
        .expect("mic thread");
    tx
}

pub fn mic_start(tx: &Sender<RecCmd>) -> Result<(), String> {
    let (reply, rx) = mpsc::channel();
    tx.send(RecCmd::Start { reply })
        .map_err(|_| "mic thread stopped".to_string())?;
    rx.recv().map_err(|_| "mic thread stopped".to_string())?
}

pub fn mic_stop(tx: &Sender<RecCmd>) -> Result<Vec<u8>, String> {
    let (reply, rx) = mpsc::channel();
    tx.send(RecCmd::Stop { reply })
        .map_err(|_| "mic thread stopped".to_string())?;
    rx.recv().map_err(|_| "mic thread stopped".to_string())?
}

impl Recorder {
    fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(RecInner::default())),
            stream: None,
        }
    }

    fn start(&mut self) -> Result<(), String> {
        if self.stream.is_some() {
            return Ok(());
        }
        let host = cpal::default_host();
        let device = host
            .default_input_device()
            .ok_or_else(|| "No microphone. Allow PyAI Scrib in System Settings → Privacy → Microphone.".to_string())?;
        let supported = device
            .default_input_config()
            .map_err(|e| format!("mic config: {e}"))?;
        let sample_format = supported.sample_format();
        let config: StreamConfig = supported.clone().into();
        let sample_rate = config.sample_rate.0;
        let channels = config.channels;
        {
            let mut g = self.inner.lock().map_err(|e| e.to_string())?;
            g.samples.clear();
            g.sample_rate = sample_rate;
            g.channels = channels;
        }
        let buf = Arc::clone(&self.inner);
        let err_fn = |e| eprintln!("mic stream: {e}");
        let stream = match sample_format {
            SampleFormat::F32 => device
                .build_input_stream(
                    &config,
                    move |data: &[f32], _| append_samples(&buf, data),
                    err_fn,
                    None,
                )
                .map_err(|e| format!("mic start: {e}"))?,
            SampleFormat::I16 => device
                .build_input_stream(
                    &config,
                    move |data: &[i16], _| {
                        let f: Vec<f32> = data.iter().map(|s| *s as f32 / 32768.0).collect();
                        append_samples(&buf, &f);
                    },
                    err_fn,
                    None,
                )
                .map_err(|e| format!("mic start: {e}"))?,
            SampleFormat::U16 => device
                .build_input_stream(
                    &config,
                    move |data: &[u16], _| {
                        let f: Vec<f32> = data.iter().map(|s| (*s as f32 / 32768.0) - 1.0).collect();
                        append_samples(&buf, &f);
                    },
                    err_fn,
                    None,
                )
                .map_err(|e| format!("mic start: {e}"))?,
            other => return Err(format!("unsupported mic format: {other}")),
        };
        stream.play().map_err(|e| format!("mic play: {e}"))?;
        self.stream = Some(stream);
        Ok(())
    }

    fn stop_wav(&mut self) -> Result<Vec<u8>, String> {
        self.stream.take();
        thread::sleep(Duration::from_millis(40));
        let (samples, rate, channels) = {
            let mut g = self.inner.lock().map_err(|e| e.to_string())?;
            let samples = std::mem::take(&mut g.samples);
            (samples, g.sample_rate.max(1), g.channels.max(1))
        };
        if samples.is_empty() {
            return Err("No speech captured".into());
        }
        let mono = to_mono(&samples, channels);
        write_wav(&mono, rate)
    }
}

fn append_samples(buf: &Arc<Mutex<RecInner>>, data: &[f32]) {
    if let Ok(mut g) = buf.lock() {
        g.samples.extend_from_slice(data);
        const MAX: usize = 16_000 * 60 * 2;
        if g.samples.len() > MAX {
            let extra = g.samples.len() - MAX;
            g.samples.drain(..extra);
        }
    }
}

fn to_mono(samples: &[f32], channels: u16) -> Vec<f32> {
    if channels <= 1 {
        return samples.to_vec();
    }
    let ch = channels as usize;
    samples
        .chunks(ch)
        .map(|frame| frame.iter().sum::<f32>() / ch as f32)
        .collect()
}

fn write_wav(samples: &[f32], sample_rate: u32) -> Result<Vec<u8>, String> {
    let spec = hound::WavSpec {
        channels: 1,
        sample_rate,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    let mut cursor = Cursor::new(Vec::new());
    {
        let mut writer = hound::WavWriter::new(&mut cursor, spec).map_err(|e| e.to_string())?;
        for s in samples {
            let v = (s.clamp(-1.0, 1.0) * 32767.0) as i16;
            writer.write_sample(v).map_err(|e| e.to_string())?;
        }
        writer.finalize().map_err(|e| e.to_string())?;
    }
    Ok(cursor.into_inner())
}

pub fn api_base() -> Result<String, String> {
    let explicit = std::env::var("PYAI_API_BASE").ok();
    let raw = explicit
        .clone()
        .unwrap_or_else(|| DEFAULT_API.to_string());
    let url = raw.trim().trim_end_matches('/').to_string();
    let parsed = reqwest::Url::parse(&url).map_err(|_| "invalid PYAI_API_BASE".to_string())?;
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return Err("PYAI_API_BASE must be http or https".into());
    }
    let host = parsed.host_str().unwrap_or("");
    let loopback = host == "127.0.0.1" || host == "localhost" || host == "::1";
    if explicit.is_none() && !loopback {
        return Err("refusing non-localhost API".into());
    }
    Ok(url)
}

#[derive(Deserialize)]
struct TranscribeOut {
    cleaned: Option<String>,
    transcript: Option<String>,
    raw: Option<String>,
    error: Option<String>,
}

pub fn transcribe(wav: &[u8], app: &ActiveApp) -> Result<String, String> {
    let base = api_base()?;
    let b64 = base64::engine::general_purpose::STANDARD.encode(wav);
    let app_name: String = app
        .name
        .chars()
        .filter(|c| !c.is_control())
        .take(200)
        .collect();
    let body = serde_json::json!({
        "audioBase64": b64,
        "format": "wav",
        "appName": if app_name.is_empty() { "macOS" } else { app_name.as_str() },
    });
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(120))
        .build()
        .map_err(|e| e.to_string())?;
    let res = client
        .post(format!("{base}/api/scrib/transcribe"))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .map_err(|_| format!("API unreachable at {base}. Is the suite API running?"))?;
    let status = res.status();
    let out: TranscribeOut = res.json().map_err(|_| format!("transcribe failed: {status}"))?;
    if !status.is_success() {
        return Err(out.error.unwrap_or_else(|| format!("transcribe failed: {status}")));
    }
    out.cleaned
        .or(out.transcript)
        .or(out.raw)
        .filter(|s| !s.trim().is_empty())
        .ok_or_else(|| "No speech.".to_string())
}

/// Silent check only. Never call `application_is_trusted_with_prompt` —
/// that dialog pops on every launch/paste when the debug binary's code
/// signature does not match the copy already enabled in System Settings.
pub const NEED_ACCESSIBILITY: &str =
    "Wrong PyAI Scrib in Accessibility. Remove every PyAI Scrib / pyai-desktop row, click +, add the app Finder highlighted. Then Cmd+V.";

pub fn accessibility_ready() -> bool {
    macos_accessibility_client::accessibility::application_is_trusted()
}

pub fn running_app_bundle() -> Option<std::path::PathBuf> {
    let exe = std::env::current_exe().ok()?;
    exe.ancestors()
        .find(|p| p.extension().is_some_and(|e| e == "app"))
        .map(|p| p.to_path_buf())
}

pub fn open_accessibility_settings() {
    if let Some(app) = running_app_bundle() {
        let _ = std::process::Command::new("open")
            .arg("-R")
            .arg(&app)
            .spawn();
    }
    let _ = std::process::Command::new("open")
        .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")
        .spawn();
    let _ = std::process::Command::new("open")
        .arg("x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_Accessibility")
        .spawn();
}

/// Paste at the OS caret: clipboard + Cmd+V, then restore the previous clipboard.
/// If Accessibility is off, leave text on the clipboard and return a hint.
pub fn insert_text(text: &str) -> Result<(), String> {
    if text.is_empty() {
        return Err("empty insert".into());
    }
    let mut clip = Clipboard::new().map_err(|e| e.to_string())?;
    let previous = clip.get_text().ok();
    clip.set_text(text).map_err(|e| e.to_string())?;
    if !accessibility_ready() {
        open_accessibility_settings();
        return Err(NEED_ACCESSIBILITY.into());
    }
    thread::sleep(Duration::from_millis(40));
    let mut enigo = Enigo::new(&Settings::default()).map_err(|e| e.to_string())?;
    enigo
        .key(Key::Meta, Direction::Press)
        .map_err(|e| e.to_string())?;
    enigo
        .key(Key::Unicode('v'), Direction::Click)
        .map_err(|e| e.to_string())?;
    enigo
        .key(Key::Meta, Direction::Release)
        .map_err(|e| e.to_string())?;
    thread::sleep(Duration::from_millis(80));
    if let Some(prev) = previous {
        let _ = clip.set_text(prev);
    }
    Ok(())
}

#[cfg(target_os = "macos")]
pub fn frontmost_app() -> ActiveApp {
    use objc2::rc::Retained;
    use objc2_app_kit::NSWorkspace;
    use objc2_foundation::NSString;

    let workspace = NSWorkspace::sharedWorkspace();
    let app = workspace.frontmostApplication();
    let name = app
        .as_ref()
        .and_then(|a| a.localizedName())
        .map(|s: Retained<NSString>| s.to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "macOS".into());
    let bundle = app
        .as_ref()
        .and_then(|a| a.bundleIdentifier())
        .map(|s: Retained<NSString>| s.to_string())
        .unwrap_or_default();
    ActiveApp {
        title: name.clone(),
        name,
        bundle_id: bundle,
    }
}

#[cfg(not(target_os = "macos"))]
pub fn frontmost_app() -> ActiveApp {
    ActiveApp {
        name: "unknown".into(),
        title: "unknown".into(),
        bundle_id: String::new(),
    }
}
