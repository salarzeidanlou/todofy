//! Loopback half of the Google Calendar OAuth flow. Google's desktop-app
//! guidance is a redirect to `http://127.0.0.1:{port}` plus PKCE, so the app
//! opens the system browser and catches the single redirect on an ephemeral
//! local port. Everything after the redirect (token exchange, calendar API)
//! lives in the frontend (`src/lib/googleCalendar.ts`) — this module only
//! runs the listener and hands the authorization code back.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};
use std::time::{Duration, Instant};
use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;

/// How long to wait for the browser redirect before giving up.
const TIMEOUT: Duration = Duration::from_secs(300);

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OAuthResult {
    /// Authorization code to exchange for tokens in the frontend.
    code: String,
    /// The `127.0.0.1` redirect the code was issued for; the token exchange
    /// must echo it back verbatim.
    redirect_uri: String,
}

/// Open Google's consent screen and wait for the loopback redirect. Binds an
/// ephemeral port first so the redirect URI is known before the browser opens.
#[tauri::command]
pub async fn google_oauth_flow(
    app: AppHandle,
    client_id: String,
    scope: String,
    code_challenge: String,
    state: String,
) -> Result<OAuthResult, String> {
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let redirect_uri = format!("http://127.0.0.1:{port}");

    let auth_url = format!(
        "https://accounts.google.com/o/oauth2/v2/auth\
         ?client_id={}&redirect_uri={}&response_type=code&scope={}\
         &code_challenge={}&code_challenge_method=S256&state={}\
         &access_type=offline&prompt=consent",
        encode(&client_id),
        encode(&redirect_uri),
        encode(&scope),
        encode(&code_challenge),
        encode(&state),
    );

    app.opener()
        .open_url(auth_url, None::<&str>)
        .map_err(|e| e.to_string())?;

    let code = tauri::async_runtime::spawn_blocking(move || await_code(listener, &state))
        .await
        .map_err(|e| e.to_string())??;

    Ok(OAuthResult { code, redirect_uri })
}

/// Block on the listener until the callback request arrives (or we time out),
/// ignoring unrelated hits like the browser's favicon probe.
fn await_code(listener: TcpListener, expected_state: &str) -> Result<String, String> {
    listener.set_nonblocking(true).ok();
    let deadline = Instant::now() + TIMEOUT;
    loop {
        if Instant::now() > deadline {
            return Err("Timed out waiting for Google to redirect back.".into());
        }
        match listener.accept() {
            Ok((stream, _)) => {
                if let Some(result) = handle_conn(stream, expected_state) {
                    return result;
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(100));
            }
            Err(e) => return Err(e.to_string()),
        }
    }
}

/// Parse one connection. Returns `None` for requests that aren't the OAuth
/// callback (e.g. `/favicon.ico`) so the caller keeps listening.
fn handle_conn(mut stream: TcpStream, expected_state: &str) -> Option<Result<String, String>> {
    let mut request_line = String::new();
    BufReader::new(&stream).read_line(&mut request_line).ok()?;
    let target = request_line.split_whitespace().nth(1)?;
    let query = target.split_once('?').map(|(_, q)| q).unwrap_or("");
    let params = parse_query(query);

    if !params.contains_key("code") && !params.contains_key("error") {
        let _ = stream.write_all(b"HTTP/1.1 204 No Content\r\nConnection: close\r\n\r\n");
        return None;
    }

    let result = if let Some(err) = params.get("error") {
        Err(format!("Google sign-in failed: {err}"))
    } else if params.get("state").map(String::as_str) != Some(expected_state) {
        Err("OAuth state did not match — aborting for safety.".into())
    } else {
        Ok(params.get("code").cloned().unwrap_or_default())
    };

    let ok = result.is_ok();
    let message = if ok {
        "todofy is connected to Google Calendar. You can close this tab and return to the app."
    } else {
        "Couldn't connect to Google Calendar. You can close this tab and return to the app."
    };
    respond(&mut stream, ok, message);
    Some(result)
}

/// The browser tab the redirect lands in. This is the last thing the user sees
/// before returning to the app, so it's a themed todofy card rather than bare
/// text. Tokens (`%ACCENT%`, etc.) are filled in per success/failure.
const RESULT_PAGE: &str = r#"<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>todofy</title>
<style>
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; display: grid; place-items: center;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, system-ui, sans-serif;
    background: radial-gradient(1100px 560px at 50% -12%, #1b1b2b 0%, #0b0b0f 62%);
    color: #e5e7eb;
  }
  .card {
    width: min(92vw, 400px); padding: 44px 34px; text-align: center;
    background: rgba(23, 23, 32, 0.72);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 22px;
    box-shadow: 0 24px 70px rgba(0, 0, 0, 0.5);
    backdrop-filter: blur(14px);
    animation: rise .5s cubic-bezier(.2, .8, .2, 1) both;
  }
  @keyframes rise { from { opacity: 0; transform: translateY(14px) scale(.98); } to { opacity: 1; transform: none; } }
  .badge {
    width: 66px; height: 66px; margin: 0 auto 22px; display: grid; place-items: center;
    border-radius: 20px; background: %BADGE%; color: %ACCENT%;
  }
  .badge svg { animation: pop .5s .12s cubic-bezier(.2, 1.5, .3, 1) both; }
  @keyframes pop { from { transform: scale(.4); opacity: 0; } to { transform: none; opacity: 1; } }
  h1 { margin: 0 0 9px; font-size: 20px; font-weight: 650; letter-spacing: -.01em; color: #f3f4f6; }
  p { margin: 0 auto; max-width: 25ch; font-size: 14px; line-height: 1.55; color: #9ca3af; }
  .btn {
    display: inline-block; margin-top: 24px; padding: 11px 24px; border-radius: 12px;
    background: %ACCENT%; color: #fff; font-size: 14px; font-weight: 600;
    text-decoration: none; transition: opacity .15s, transform .15s;
  }
  .btn:hover { opacity: .92; transform: translateY(-1px); }
  .brand { margin-top: 26px; font-size: 12px; font-weight: 600; letter-spacing: .04em; color: #6b7280; }
  .brand b { color: %ACCENT%; font-weight: 700; }
</style>
</head>
<body>
  <div class="card">
    <div class="badge">%ICON%</div>
    <h1>%TITLE%</h1>
    <p>%MESSAGE%</p>
    <a class="btn" href="todofy://calendar-connected">Back to todofy</a>
    <div class="brand"><b>todofy</b></div>
  </div>
</body>
</html>"#;

const CHECK_SVG: &str = r#"<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>"#;
const CROSS_SVG: &str = r#"<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>"#;

/// Write the themed result page back to the browser tab.
fn respond(stream: &mut TcpStream, ok: bool, message: &str) {
    let (accent, badge, title, icon) = if ok {
        (
            "#6c7cff",
            "rgba(108,124,255,0.12)",
            "You're all set",
            CHECK_SVG,
        )
    } else {
        (
            "#fb7185",
            "rgba(244,63,94,0.12)",
            "Something went wrong",
            CROSS_SVG,
        )
    };
    let body = RESULT_PAGE
        .replace("%ACCENT%", accent)
        .replace("%BADGE%", badge)
        .replace("%TITLE%", title)
        .replace("%ICON%", icon)
        .replace("%MESSAGE%", message);
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\n\
         Content-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.len(),
        body
    );
    let _ = stream.write_all(response.as_bytes());
    let _ = stream.flush();
}

/// Split a `key=value&key=value` query string into a map, percent-decoding
/// each value (Google's `code` arrives with `/` encoded as `%2F`).
fn parse_query(query: &str) -> HashMap<String, String> {
    query
        .split('&')
        .filter_map(|pair| {
            let (k, v) = pair.split_once('=')?;
            Some((k.to_string(), percent_decode(v)))
        })
        .collect()
}

fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'%' if i + 2 < bytes.len() => {
                let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).ok();
                match hex.and_then(|h| u8::from_str_radix(h, 16).ok()) {
                    Some(byte) => {
                        out.push(byte);
                        i += 3;
                    }
                    None => {
                        out.push(bytes[i]);
                        i += 1;
                    }
                }
            }
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            b => {
                out.push(b);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Percent-encode a query-parameter value, leaving only the RFC 3986
/// unreserved set intact.
fn encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}
