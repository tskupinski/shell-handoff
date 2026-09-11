use crate::{store::home, terminal, Result};
use serde_json::Value;

pub fn run(assistant: &str, backend: &str) -> Result<()> {
    if assistant == "codex" {
        let root = terminal::env("CODEX_HOME")
            .map(std::path::PathBuf::from)
            .unwrap_or(home()?.join(".codex"));
        println!("· Codex: set top-level notify = [\"shell-handoff\", \"capture\", \"--assistant\", \"codex\"] in {}; use \"shell-handoff pick\" in your tmux binding. Effective Codex configuration is not checked.", root.join("config.toml").display());
    } else {
        let path = home()?.join(".claude/settings.json");
        match std::fs::read_to_string(&path)
            .ok()
            .and_then(|s| serde_json::from_str::<Value>(&s).ok())
        {
            None => println!(
                "✗ no readable {} - add a Stop hook running \"shell-handoff capture\"",
                path.display()
            ),
            Some(v) => {
                let wired = v["hooks"]["Stop"].as_array().is_some_and(|groups| {
                    groups.iter().any(|g| {
                        g["hooks"].as_array().is_some_and(|hooks| {
                            hooks.iter().any(|h| {
                                h["command"]
                                    .as_str()
                                    .is_some_and(|s| s.contains("shell-handoff capture"))
                            })
                        })
                    })
                });
                if wired {
                    println!("✓ Stop hook runs \"shell-handoff capture\"");
                } else {
                    println!("✗ no Stop hook found - add one running \"shell-handoff capture\" to ~/.claude/settings.json");
                }
            }
        }
    }
    if backend == "herdr" {
        match terminal::herdr("ping") {
            Ok(v) => println!("✓ Herdr {}: socket reachable. Configure a popup running \"shell-handoff pick\"; key binding is not checked.", v["version"].as_str().unwrap_or("unknown")),
            Err(e) => println!("✗ {e}"),
        }
    } else {
        match terminal::tmux(&["list-keys"]) {
            Err(_) => println!("· tmux is not running - cannot check the key binding"),
            Ok(keys) => match keys.lines().find(|l| l.contains("shell-handoff pick")) {
                Some(line) => println!("✓ tmux binding: {}", line.split_whitespace().collect::<Vec<_>>().join(" ").chars().take(80).collect::<String>()),
                None => println!("✗ no tmux binding - add e.g. bind-key e display-popup -E \"shell-handoff pick\""),
            },
        }
    }
    Ok(())
}
