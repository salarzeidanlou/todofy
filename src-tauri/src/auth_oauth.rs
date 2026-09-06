//! Supabase account OAuth over a fixed loopback callback.
//!
//! Supabase owns the Google provider exchange and redirects the browser to
//! `http://127.0.0.1:3369/auth-callback?code=...`. The frontend then performs
//! the PKCE code exchange. We keep the browser connection open until that
//! exchange finishes so the page never claims success prematurely.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_opener::OpenerExt;

const CALLBACK_ADDRESS: &str = "127.0.0.1:3369";
const CALLBACK_PATH: &str = "/auth-callback";
const TIMEOUT: Duration = Duration::from_secs(300);

#[derive(Default)]
pub struct SupabaseOAuthState(Mutex<OAuthStateInner>);

#[derive(Default)]
struct OAuthStateInner {
    active: bool,
    pending: Option<PendingCallback>,
}

struct PendingCallback {
    attempt_id: String,
    stream: TcpStream,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SupabaseOAuthResult {
    code: String,
    attempt_id: String,
}

struct BrowserCallback {
    code: String,
    stream: TcpStream,
}

enum CallbackTarget {
    Ignore,
    Code(String),
    Error(String),
}

/// Open the Supabase-generated provider URL and wait for its loopback redirect.
#[tauri::command]
pub async fn supabase_oauth_flow(
    app: AppHandle,
    state: State<'_, SupabaseOAuthState>,
    auth_url: String,
) -> Result<SupabaseOAuthResult, String> {
    if !auth_url.starts_with("https://") || !auth_url.contains("/auth/v1/authorize") {
        return Err("Supabase returned an invalid Google authorization URL.".into());
    }

    {
        let mut inner = state.0.lock().map_err(|e| e.to_string())?;
        if inner.active {
            return Err("A Google sign-in is already in progress.".into());
        }
        inner.active = true;
    }

    let listener = match TcpListener::bind(CALLBACK_ADDRESS) {
        Ok(listener) => listener,
        Err(error) => {
            reset(&state);
            return Err(format!(
                "Could not start the Google sign-in callback on {CALLBACK_ADDRESS}: {error}"
            ));
        }
    };

    if let Err(error) = app.opener().open_url(auth_url, None::<&str>) {
        reset(&state);
        return Err(error.to_string());
    }

    let callback =
        match tauri::async_runtime::spawn_blocking(move || await_callback(listener)).await {
            Ok(Ok(callback)) => callback,
            Ok(Err(error)) => {
                reset(&state);
                return Err(error);
            }
            Err(error) => {
                reset(&state);
                return Err(error.to_string());
            }
        };

    let attempt_id = uuid::Uuid::new_v4().to_string();
    {
        let mut inner = state.0.lock().map_err(|e| e.to_string())?;
        inner.pending = Some(PendingCallback {
            attempt_id: attempt_id.clone(),
            stream: callback.stream,
        });
    }

    Ok(SupabaseOAuthResult {
        code: callback.code,
        attempt_id,
    })
}

/// Complete the waiting browser response after the frontend's PKCE exchange.
#[tauri::command]
pub fn supabase_oauth_finish(
    app: AppHandle,
    state: State<'_, SupabaseOAuthState>,
    attempt_id: String,
    error: Option<String>,
) -> Result<(), String> {
    let pending = {
        let mut inner = state.0.lock().map_err(|e| e.to_string())?;
        let matches = inner
            .pending
            .as_ref()
            .is_some_and(|pending| pending.attempt_id == attempt_id);
        if !matches {
            return Err("The Google sign-in attempt is no longer active.".into());
        }
        inner.active = false;
        inner.pending.take().expect("pending callback was checked")
    };

    let mut stream = pending.stream;
    match error {
        Some(message) => respond(&mut stream, false, &message),
        None => respond(
            &mut stream,
            true,
            "Google sign-in completed. You can return to Todofy.",
        ),
    }

    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
    Ok(())
}

fn reset(state: &SupabaseOAuthState) {
    if let Ok(mut inner) = state.0.lock() {
        inner.active = false;
        inner.pending = None;
    }
}

fn await_callback(listener: TcpListener) -> Result<BrowserCallback, String> {
    listener.set_nonblocking(true).ok();
    let deadline = Instant::now() + TIMEOUT;
    loop {
        if Instant::now() > deadline {
            return Err("Timed out waiting for Google to redirect back to Todofy.".into());
        }

        match listener.accept() {
            Ok((mut stream, _)) => {
                let mut request_line = String::new();
                if BufReader::new(&stream)
                    .read_line(&mut request_line)
                    .is_err()
                {
                    continue;
                }
                let Some(target) = request_line.split_whitespace().nth(1) else {
                    continue;
                };
                match parse_callback_target(target) {
                    CallbackTarget::Ignore => {
                        let _ = stream
                            .write_all(b"HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
                    }
                    CallbackTarget::Error(message) => {
                        respond(&mut stream, false, &message);
                        return Err(message);
                    }
                    CallbackTarget::Code(code) => return Ok(BrowserCallback { code, stream }),
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(100));
            }
            Err(error) => return Err(error.to_string()),
        }
    }
}

fn parse_callback_target(target: &str) -> CallbackTarget {
    let (path, query) = target.split_once('?').unwrap_or((target, ""));
    if path != CALLBACK_PATH {
        return CallbackTarget::Ignore;
    }

    let params = parse_query(query);
    if let Some(error) = params
        .get("error_description")
        .or_else(|| params.get("error"))
    {
        return CallbackTarget::Error(format!("Google sign-in failed: {error}"));
    }
    match params.get("code") {
        Some(code) if !code.is_empty() => CallbackTarget::Code(code.clone()),
        _ => CallbackTarget::Error("Google sign-in returned without an authorization code.".into()),
    }
}

fn parse_query(query: &str) -> HashMap<String, String> {
    query
        .split('&')
        .filter_map(|pair| {
            let (key, value) = pair.split_once('=')?;
            Some((key.to_string(), percent_decode(value)))
        })
        .collect()
}

fn percent_decode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut output = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        match bytes[index] {
            b'%' if index + 2 < bytes.len() => {
                let decoded = std::str::from_utf8(&bytes[index + 1..index + 3])
                    .ok()
                    .and_then(|hex| u8::from_str_radix(hex, 16).ok());
                if let Some(byte) = decoded {
                    output.push(byte);
                    index += 3;
                } else {
                    output.push(bytes[index]);
                    index += 1;
                }
            }
            b'+' => {
                output.push(b' ');
                index += 1;
            }
            byte => {
                output.push(byte);
                index += 1;
            }
        }
    }
    String::from_utf8_lossy(&output).into_owned()
}

const RESULT_PAGE: &str = r#"<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Todofy sign-in</title><style>
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:radial-gradient(900px 500px at 50% -10%,#1b1b2b,#0b0b0f 65%);color:#e5e7eb}.card{width:min(92vw,410px);padding:42px 32px;text-align:center;background:rgba(23,23,32,.76);border:1px solid rgba(255,255,255,.08);border-radius:22px;box-shadow:0 24px 70px rgba(0,0,0,.5)}.badge{width:64px;height:64px;margin:0 auto 20px;display:grid;place-items:center;border-radius:20px;background:%BADGE%;color:%ACCENT%;font-size:30px;font-weight:700}h1{margin:0 0 10px;font-size:21px;color:#f3f4f6}p{margin:0 auto;max-width:31ch;font-size:14px;line-height:1.55;color:#9ca3af}.btn{display:inline-block;margin-top:24px;padding:11px 24px;border-radius:12px;background:%ACCENT%;color:white;font-size:14px;font-weight:600;text-decoration:none}.brand{margin-top:25px;color:#6b7280;font-size:12px;font-weight:700;letter-spacing:.04em}
</style></head><body><main class="card"><div class="badge">%ICON%</div><h1>%TITLE%</h1><p>%MESSAGE%</p><a class="btn" href="todofy://auth-return">Back to Todofy</a><div class="brand">TODOFY</div></main></body></html>"#;

fn respond(stream: &mut TcpStream, ok: bool, message: &str) {
    let (accent, badge, icon, title) = if ok {
        ("#6c7cff", "rgba(108,124,255,.12)", "✓", "You're signed in")
    } else {
        ("#fb7185", "rgba(244,63,94,.12)", "×", "Sign-in failed")
    };
    let body = RESULT_PAGE
        .replace("%ACCENT%", accent)
        .replace("%BADGE%", badge)
        .replace("%ICON%", icon)
        .replace("%TITLE%", title)
        .replace("%MESSAGE%", &escape_html(message));
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\n\
         Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'\r\n\
         X-Content-Type-Options: nosniff\r\nContent-Length: {}\r\n\
         Connection: close\r\n\r\n{}",
        body.len(),
        body
    );
    let _ = stream.write_all(response.as_bytes());
    let _ = stream.flush();
}

fn escape_html(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_only_the_exact_callback_path() {
        assert!(matches!(
            parse_callback_target("/auth-callback?code=abc%2F123"),
            CallbackTarget::Code(code) if code == "abc/123"
        ));
        assert!(matches!(
            parse_callback_target("/favicon.ico"),
            CallbackTarget::Ignore
        ));
        assert!(matches!(
            parse_callback_target("/auth-callback-evil?code=abc"),
            CallbackTarget::Ignore
        ));
    }

    #[test]
    fn surfaces_provider_errors_and_escapes_html() {
        assert!(matches!(
            parse_callback_target("/auth-callback?error=access_denied&error_description=User+cancelled"),
            CallbackTarget::Error(message) if message == "Google sign-in failed: User cancelled"
        ));
        assert_eq!(
            escape_html("<bad & \"unsafe\">"),
            "&lt;bad &amp; &quot;unsafe&quot;&gt;"
        );
    }
}
