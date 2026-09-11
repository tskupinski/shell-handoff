mod doctor;
mod items;
mod store;
mod terminal;

use std::io::{IsTerminal, Read};
type Result<T> = std::result::Result<T, Box<dyn std::error::Error + Send + Sync>>;
const HELP: &str = "shell-handoff (Rust migration)\n\nusage:\n  shell-handoff capture [--assistant claude-code|codex] [event-json]\n  shell-handoff doctor [--assistant claude-code|codex]\n\nBoth accept --terminal auto|tmux|herdr. The picker still uses the JavaScript executable.";

fn run(args: &[String]) -> Result<()> {
    let cmd = args.first().map(String::as_str).unwrap_or("help");
    let (mut assistant, mut backend) = ("claude-code", "auto");
    let mut positional = Vec::new();
    let mut i = 1;
    while i < args.len() {
        let arg = &args[i];
        if arg == "--assistant" || arg == "--terminal" {
            i += 1;
            let value = args
                .get(i)
                .ok_or_else(|| format!("{arg} requires a value"))?;
            if arg == "--assistant" {
                assistant = value;
            } else {
                backend = value;
            }
        } else if let Some(value) = arg.strip_prefix("--assistant=") {
            assistant = value;
        } else if let Some(value) = arg.strip_prefix("--terminal=") {
            backend = value;
        } else {
            positional.push(arg.as_str());
        }
        i += 1;
    }
    let backend = terminal::select(backend)?;
    if matches!(cmd, "help" | "-h" | "--help") {
        println!("{HELP}");
        return Ok(());
    }
    if !matches!(assistant, "claude-code" | "codex") {
        return Err(
            format!("Unknown assistant \"{assistant}\"; choose claude-code or codex").into(),
        );
    }
    match cmd {
        "capture" => {
            if positional.len() > 1 {
                return Err("capture accepts one JSON argument".into());
            }
            let Some(pane) = terminal::target(backend) else {
                return Ok(());
            };
            let mut input = String::new();
            if let Some(arg) = positional.first() {
                input.push_str(arg);
            } else if !std::io::stdin().is_terminal() {
                std::io::stdin().read_to_string(&mut input)?;
            }
            let event: serde_json::Value = serde_json::from_str(&input)?;
            if assistant == "codex" && event["type"] != "agent-turn-complete" {
                return Ok(());
            }
            store::write_items(
                backend,
                assistant,
                &pane,
                &items::extract(assistant, &event),
            )
        }
        "doctor" => {
            if !positional.is_empty() {
                return Err("doctor accepts no positional arguments".into());
            }
            doctor::run(assistant, backend)
        }
        "pick" => Err(
            "Rust picker is not implemented yet; use the existing bin/shell-handoff launcher"
                .into(),
        ),
        _ => Err(format!("unknown command \"{cmd}\"").into()),
    }
}
fn main() {
    let args: Vec<_> = std::env::args().skip(1).collect();
    if let Err(error) = run(&args) {
        // Capture hooks must never disrupt the assistant session.
        if args.first().is_none_or(|s| s != "capture") {
            eprintln!("shell-handoff: {error}\n\n{HELP}");
            std::process::exit(1);
        }
    }
}
