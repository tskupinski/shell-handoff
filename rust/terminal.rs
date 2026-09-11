use crate::Result;
use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Read, Write};
use std::os::unix::fs::MetadataExt;
use std::os::unix::net::UnixStream;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant, UNIX_EPOCH};

pub fn env(key: &str) -> Option<String> {
    std::env::var(key).ok().filter(|s| !s.is_empty())
}
pub fn select(id: &str) -> Result<&str> {
    match id {
        "auto" => Ok(
            if env("HERDR_SOCKET_PATH").is_some()
                && (env("HERDR_PANE_ID").is_some() || env("HERDR_ACTIVE_PANE_ID").is_some())
            {
                "herdr"
            } else {
                "tmux"
            },
        ),
        "tmux" | "herdr" => Ok(id),
        _ => Err(format!("Unknown terminal \"{id}\"; choose auto, tmux, or herdr").into()),
    }
}
pub fn key(terminal: &str, pane: &str) -> Result<String> {
    fn digits(s: &str) -> bool {
        !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit())
    }
    if terminal == "tmux" {
        if let Some(s) = pane.strip_prefix('%').filter(|s| digits(s)) {
            return Ok(s.to_owned());
        }
    } else if let Some((w, p)) = pane.split_once(":p") {
        if w.strip_prefix('w').is_some_and(digits) && digits(p) {
            return Ok(pane.replace(':', "_"));
        }
    }
    Err("Invalid pane ID".into())
}
pub fn target(terminal: &str) -> Option<String> {
    let pane = env(if terminal == "tmux" {
        "TMUX_PANE"
    } else {
        "HERDR_PANE_ID"
    })?;
    key(terminal, &pane).ok()?;
    Some(pane)
}
pub fn tmux(args: &[&str]) -> Result<String> {
    let executable = [
        "/opt/homebrew/bin/tmux",
        "/usr/local/bin/tmux",
        "/usr/bin/tmux",
    ]
    .into_iter()
    .find(|p| std::path::Path::new(p).exists())
    .unwrap_or("tmux");
    let mut command = Command::new(executable);
    command
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    if ["LANG", "LC_ALL", "LC_CTYPE"]
        .iter()
        .all(|k| env(k).is_none())
    {
        command.env("LC_CTYPE", "UTF-8");
    }
    let mut child = command.spawn()?;
    let stdout = child.stdout.take().ok_or("Missing subprocess stdout")?;
    let reader = std::thread::spawn(move || {
        let mut bytes = Vec::new();
        stdout
            .take(16 * 1024 * 1024 + 1)
            .read_to_end(&mut bytes)
            .map(|_| bytes)
    });
    let deadline = Instant::now() + Duration::from_secs(3);
    let status = loop {
        if let Some(status) = child.try_wait()? {
            break status;
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            return Err("tmux timed out".into());
        }
        std::thread::sleep(Duration::from_millis(5));
    };
    let bytes = reader.join().map_err(|_| "tmux reader failed")??;
    if !status.success() {
        return Err("tmux command failed".into());
    }
    if bytes.len() > 16 * 1024 * 1024 {
        return Err("tmux response is too large".into());
    }
    Ok(String::from_utf8_lossy(&bytes)
        .trim_end_matches('\n')
        .to_owned())
}
pub fn herdr(method: &str) -> Result<Value> {
    let path = env("HERDR_SOCKET_PATH").ok_or("HERDR_SOCKET_PATH is missing; run inside Herdr")?;
    let mut stream = UnixStream::connect(path)?;
    stream.set_read_timeout(Some(Duration::from_secs(3)))?;
    stream.set_write_timeout(Some(Duration::from_secs(3)))?;
    writeln!(
        stream,
        "{}",
        json!({"id":"shell-handoff-rust", "method":method, "params":{}})
    )?;
    let mut reader = BufReader::new(stream).take(4 * 1024 * 1024 + 1);
    let mut consumed = 0;
    loop {
        let mut line = String::new();
        let count = reader.read_line(&mut line)?;
        consumed += count;
        if consumed > 4 * 1024 * 1024 {
            return Err("Herdr response is too large".into());
        }
        if count == 0 {
            return Err("Herdr closed the connection".into());
        }
        let value: Value = serde_json::from_str(&line)?;
        if value["id"] != "shell-handoff-rust" {
            continue;
        }
        if !value["error"].is_null() {
            return Err(format!(
                "Herdr: {}",
                value["error"]["message"].as_str().unwrap_or("API error")
            )
            .into());
        }
        if value["result"].is_null() {
            return Err("Invalid Herdr response".into());
        }
        return Ok(value["result"].clone());
    }
}
pub fn scope(terminal: &str) -> Result<String> {
    if terminal == "tmux" {
        return tmux(&[
            "display-message",
            "-p",
            "#{socket_path}:#{pid}:#{start_time}",
        ]);
    }
    let path =
        std::fs::canonicalize(env("HERDR_SOCKET_PATH").ok_or("HERDR_SOCKET_PATH is missing")?)?;
    let info = std::fs::metadata(&path)?;
    // Node exposes birthtime in milliseconds; preserve its fractional precision.
    let birth = info.created()?.duration_since(UNIX_EPOCH)?;
    let millis = birth.as_secs() as f64 * 1000.0 + birth.subsec_nanos() as f64 / 1_000_000.0;
    let time = if millis.fract() == 0.0 {
        json!(millis as u64)
    } else {
        json!(millis)
    };
    Ok(serde_json::to_string(&json!([
        path,
        info.dev(),
        info.ino(),
        time
    ]))?)
}
