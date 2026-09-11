use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::io::{Read, Seek, SeekFrom};
use std::sync::LazyLock;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Command,
    Snippet,
    Denied,
    Block,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Item {
    pub kind: Kind,
    pub text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lang: Option<String>,
}

// JavaScript's dot excludes CR and Unicode line separators as well as LF.
static BANG: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^\s*`?!\s+([^\r\n\x{2028}\x{2029}]+?)`?\s*$").unwrap());
static OPEN: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^(\s*)(`{3,}|~{3,})\s*([^\r\n\x{2028}\x{2029}]*)$").unwrap());
static CLOSE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^\s*(`{3,}|~{3,})\s*$").unwrap());
static DENIED: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)denied|doesn.t want to proceed|rejected").unwrap());

fn bang(line: &str) -> Option<String> {
    BANG.captures(line).map(|m| m[1].to_owned())
}
fn item(kind: Kind, text: String, lang: Option<String>) -> Item {
    Item { kind, text, lang }
}
fn trimmed(lines: &[String]) -> String {
    let start = lines
        .iter()
        .position(|l| !l.trim().is_empty())
        .unwrap_or(lines.len());
    let end = lines
        .iter()
        .rposition(|l| !l.trim().is_empty())
        .map_or(start, |i| i + 1);
    lines[start..end].join("\n")
}

pub fn from_text(text: &str) -> (Vec<Item>, Vec<Item>) {
    let (mut primary, mut blocks) = (Vec::new(), Vec::new());
    let lines: Vec<_> = text.split('\n').collect();
    let mut i = 0;
    while i < lines.len() {
        let Some(open) = OPEN.captures(lines[i]) else {
            if let Some(text) = bang(lines[i]) {
                primary.push(item(Kind::Command, text, None));
            }
            i += 1;
            continue;
        };
        let (indent, fence) = (&open[1], &open[2]);
        let words: Vec<_> = open[3].split_whitespace().map(str::to_lowercase).collect();
        let lang = words.first().cloned().unwrap_or_default();
        let run = words.iter().any(|w| w == "run" || w == "runner");
        let mut body = Vec::new();
        i += 1;
        while i < lines.len() {
            if CLOSE
                .captures(lines[i])
                .is_some_and(|m| m[1].starts_with(&fence[..1]) && m[1].len() >= fence.len())
            {
                break;
            }
            let line = if indent.is_empty() {
                lines[i]
            } else {
                lines[i]
                    .strip_prefix(indent)
                    .unwrap_or_else(|| lines[i].trim_start())
            };
            body.push(line.to_owned());
            i += 1;
        }
        i += 1;
        if run {
            let text = trimmed(
                &body
                    .iter()
                    .map(|l| bang(l).unwrap_or_else(|| l.clone()))
                    .collect::<Vec<_>>(),
            );
            if !text.is_empty() {
                primary.push(item(
                    Kind::Snippet,
                    text,
                    Some(if lang == "run" || lang == "runner" {
                        String::new()
                    } else {
                        lang
                    }),
                ));
            }
        } else {
            let cmds: Vec<_> = body.iter().filter_map(|l| bang(l)).collect();
            if !cmds.is_empty() {
                primary.extend(cmds.into_iter().map(|t| item(Kind::Command, t, None)));
            } else {
                let text = trimmed(&body);
                if !text.is_empty() {
                    blocks.push(item(Kind::Block, text, Some(lang)));
                }
            }
        }
    }
    (primary, blocks)
}

fn text_of(message: &Value) -> String {
    let c = &message["content"];
    if let Some(s) = c.as_str() {
        return s.to_owned();
    }
    c.as_array()
        .map(|a| {
            a.iter()
                .filter(|b| b["type"] == "text")
                .map(|b| b["text"].as_str().unwrap_or(""))
                .collect::<Vec<_>>()
                .join("\n")
        })
        .unwrap_or_default()
}
pub fn final_text(value: &Value) -> String {
    if let Some(s) = value.as_str() {
        return s.to_owned();
    }
    if value["content"].is_array() {
        return text_of(value);
    }
    fn walk(v: &Value, texts: &mut Vec<String>) {
        match v {
            Value::Array(a) => a.iter().for_each(|v| walk(v, texts)),
            Value::Object(o) => {
                if let Some(s) = o.get("text").and_then(Value::as_str) {
                    texts.push(s.to_owned());
                }
                o.values().for_each(|v| walk(v, texts));
            }
            _ => {}
        }
    }
    let mut texts = Vec::new();
    walk(value, &mut texts);
    texts.join("\n")
}

fn read_tail(path: &str) -> std::io::Result<Vec<Value>> {
    let mut file = std::fs::File::open(path)?;
    let size = file.metadata()?.len();
    let start = size.saturating_sub(512 * 1024);
    file.seek(SeekFrom::Start(start))?;
    let mut bytes = Vec::new();
    file.take(size - start).read_to_end(&mut bytes)?;
    Ok(String::from_utf8_lossy(&bytes)
        .split('\n')
        .skip(usize::from(start > 0))
        .filter_map(|l| serde_json::from_str::<Value>(l).ok())
        .filter(|v| !truthy(&v["isSidechain"]))
        .collect())
}
fn truthy(v: &Value) -> bool {
    match v {
        Value::Null => false,
        Value::Bool(b) => *b,
        Value::String(s) => !s.is_empty(),
        Value::Number(n) => n.as_f64() != Some(0.0),
        _ => true,
    }
}
fn prompt(e: &Value) -> bool {
    e["type"] == "user"
        && (e["message"]["content"].is_string()
            || e["message"]["content"]
                .as_array()
                .is_some_and(|a| a.iter().all(|b| b["type"] != "tool_result")))
}
pub fn extract(assistant: &str, event: &Value) -> Vec<Item> {
    let (mut primary, mut blocks) = (Vec::new(), Vec::new());
    if assistant == "claude-code" {
        let entries = event["transcript_path"]
            .as_str()
            .and_then(|p| read_tail(p).ok())
            .unwrap_or_default();
        let turn = &entries[entries.iter().rposition(prompt).unwrap_or(0)..];
        let mut bash = HashMap::new();
        for e in turn.iter().filter(|e| e["type"] == "assistant") {
            if let Some(content) = e["message"]["content"].as_array() {
                for b in content {
                    if b["type"] == "tool_use" && b["name"] == "Bash" {
                        if let (Some(id), Some(cmd)) =
                            (b["id"].as_str(), b["input"]["command"].as_str())
                        {
                            bash.insert(id, cmd);
                        }
                    }
                }
            }
        }
        for e in turn {
            if e["type"] == "assistant" {
                let (p, b) = from_text(&text_of(&e["message"]));
                primary.extend(p);
                blocks.extend(b);
            } else if e["type"] == "user" {
                if let Some(content) = e["message"]["content"].as_array() {
                    for b in content {
                        let result = match &b["content"] {
                            Value::String(s) => s.clone(),
                            Value::Array(a) => a
                                .iter()
                                .map(|v| v["text"].as_str().unwrap_or(""))
                                .collect::<Vec<_>>()
                                .join(" "),
                            v => v.to_string(),
                        };
                        if b["type"] == "tool_result"
                            && truthy(&b["is_error"])
                            && DENIED.is_match(&result)
                        {
                            if let Some(cmd) = b["tool_use_id"]
                                .as_str()
                                .and_then(|id| bash.get(id))
                                .filter(|s| !s.is_empty())
                            {
                                primary.push(item(Kind::Denied, (*cmd).to_owned(), None));
                            }
                        }
                    }
                }
            }
        }
    } else if event["type"] != "agent-turn-complete" {
        return Vec::new();
    }
    let text = if assistant == "codex" {
        event["last-assistant-message"]
            .as_str()
            .unwrap_or("")
            .to_owned()
    } else {
        final_text(&event["last_assistant_message"])
    };
    let (p, b) = from_text(&text);
    primary.extend(p);
    blocks.extend(b);
    primary.extend(blocks);
    let mut seen = HashSet::new();
    primary.retain(|i| seen.insert(i.text.clone()));
    primary
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn shared_capture_fixtures() {
        let fixtures: Vec<Value> =
            serde_json::from_str(include_str!("../test/fixtures/capture.json")).unwrap();
        for f in fixtures {
            let mut transcript = tempfile::NamedTempFile::new().unwrap();
            if let Some(n) = f["padding"].as_u64() {
                writeln!(transcript, "{}", "x".repeat(n as usize)).unwrap();
            } else {
                write!(transcript, "{}", f["prefix"].as_str().unwrap_or("")).unwrap();
            }
            if let Some(entries) = f["entries"].as_array() {
                for e in entries {
                    writeln!(transcript, "{e}").unwrap();
                }
            }
            write!(transcript, "{}", f["suffix"].as_str().unwrap_or("")).unwrap();
            for assistant in ["claude-code", "codex"] {
                let mut event = f.get("event").cloned().unwrap_or(serde_json::json!({}));
                if assistant == "codex" {
                    event = serde_json::json!({"type":"agent-turn-complete", "last-assistant-message": f.get("text").unwrap_or(&f["event"]["last_assistant_message"])});
                } else {
                    event["transcript_path"] = serde_json::json!(transcript.path());
                    if let Some(text) = f.get("text") {
                        event["last_assistant_message"] = text.clone();
                    }
                }
                assert_eq!(
                    serde_json::to_value(extract(assistant, &event)).unwrap(),
                    f["expected"][assistant],
                    "{}: {assistant}",
                    f["name"]
                );
            }
        }
    }
}
