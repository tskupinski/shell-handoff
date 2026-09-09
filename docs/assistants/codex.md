# Codex CLI

[Back to README](../../README.md) · [tmux setup](../terminals/tmux.md) · [Herdr setup](../terminals/herdr.md)

## Setup

For Codex running locally in tmux or Herdr, add this **top-level** setting to
`~/.codex/config.toml` (or `$CODEX_HOME/config.toml`), before any `[table]`:

```toml
notify = ["shell-handoff", "capture", "--assistant", "codex"]
```

Use an absolute path to `bin/shell-handoff` if it is not on Codex's PATH.
If you already use `notify`, keep your existing notification program and use a
wrapper that forwards the same JSON argument to both programs. Restart Codex.

Configure the shared shortcut using the [tmux](../terminals/tmux.md) or [Herdr](../terminals/herdr.md) guide.
Then run `shell-handoff doctor --assistant codex`.
Codex diagnostics show configuration instructions; they do not validate the
effective TOML configuration or command-line overrides.

## What it captures

The [Codex notify interface](https://learn.chatgpt.com/docs/config-file/config-advanced#notifications)
supplies the final assistant message as a JSON argument. The adapter captures
`! ` lines, whole `run` fences, and other code blocks from that message.
It does not capture earlier commentary or denied tool calls.
After the reply, press prefix + `e`; use the same run, paste, copy, and output
[keys in the README](../../README.md#keys). Output returns to Codex as a draft with no Enter.
See [using both assistants](../../README.md#using-both-assistants) for automatic
detection and runner sharing.

## Command formatting

Add the following to `~/.codex/AGENTS.md` (or `$CODEX_HOME/AGENTS.md`) to
apply it across projects. Append it to existing instructions. For one project,
use that project's `AGENTS.md` instead. If you use a global `AGENTS.override.md`,
add it there: Codex reads that file instead of the global `AGENTS.md`.
See [Codex instruction discovery](https://learn.chatgpt.com/docs/agent-configuration/agents-md).

````markdown
# Shell command handoffs

The user uses shell-handoff in tmux or Herdr with both Codex and Claude Code.
Whenever you give the user shell commands to run, include them in your final
reply inside fenced code blocks whose opening line is exactly ```bash run.
Put only runnable shell text inside these blocks, without shell prompt prefixes,
Markdown bullets, or explanatory prose. Use a separate block for each independent
command or alternative; keep dependent lines and heredocs together in one block.
Include any required working-directory change in the block when relevant.
Explain prerequisites and any values the user must replace outside the block.

Repeat commands that still need user action in the final reply even if they
already appeared in commentary: shell-handoff captures only the final reply.
Use ordinary language-tagged fences for source code, configuration, sample
output, and illustrative commands that you are not asking the user to execute;
reserve the run tag for commands actually intended for the user to run.
Continue doing authorized work yourself; this formatting convention does not
mean that routine commands should be handed back to the user.
````

## Verify

Restart Codex after changing the notification configuration and instructions.
To check the setup, ask it: "Give me a command to print handoff ready for me
to run, using the shell-handoff format." The final reply should contain:

````markdown
```bash run
printf 'handoff ready\n'
```
````

After that reply finishes, press prefix + `e`. The picker should show Codex
and the command as one runnable snippet. These instructions guide formatting;
project instructions or explicit prompts can override them.
