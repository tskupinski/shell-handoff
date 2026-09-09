# Claude Code

[Back to README](../../README.md) · [tmux setup](../terminals/tmux.md) · [Herdr setup](../terminals/herdr.md)

## Setup

Run Claude Code inside tmux or Herdr. Merge this Stop hook into `~/.claude/settings.json`,
keeping any existing settings and hooks:

```json
{
  "hooks": {
    "Stop": [
      { "matcher": "", "hooks": [
        { "type": "command", "command": "shell-handoff capture", "timeout": 5 }
      ] }
    ]
  }
}
```

Open `/hooks` once (or restart) in running sessions so it loads.

Use an absolute path to `bin/shell-handoff` if it is not on the hook's PATH.
Configure the shortcut using the [tmux](../terminals/tmux.md) or [Herdr](../terminals/herdr.md) guide, then
run `shell-handoff doctor` (or `shell-handoff doctor --assistant claude-code`).
It checks the user settings file for the capture hook and checks tmux bindings.
See the [Claude Code hook reference](https://code.claude.com/docs/en/hooks).

## What it captures

The Stop hook sends JSON on stdin. The adapter reads the final reply from
`last_assistant_message` and earlier turn content from the transcript tail,
because the transcript can lag behind the final reply. It captures:

- `! ` command lines, one item per line.
- Fences tagged `run` or `runner`, as whole snippets.
- Denied Bash tool calls from the transcript, using the exact attempted command.
- Other fenced blocks, in the lower tier.

Capture replaces the pane's items every reply and is silent and best-effort.
Outside a supported terminal it does nothing. Output returns to Claude's input as a draft,
without pressing Enter.

## Command formatting

The hook works without custom instructions. For deliberate handoffs, append
this to `~/.claude/CLAUDE.md` for all projects, or the project's `CLAUDE.md`.
See [Claude Code memory](https://code.claude.com/docs/en/memory).

````markdown
# Shell command handoffs

The user uses shell-handoff in tmux or Herdr. When giving the user shell commands to
run, include them in the final reply in fenced blocks tagged `bash run`.
Put only runnable shell text in each block, without prompt prefixes or prose.
Use one block per independent command or alternative; keep dependent lines
and heredocs together. Include the working-directory change when needed.
Explain prerequisites and placeholder values outside the block.
Use ordinary language-tagged fences for source code, configuration, sample
output, and examples that are not intended for execution.
Continue doing authorized work yourself; this convention only formats commands
that actually need to be handed to the user.
````

Single commands written as `! ` lines also work. Formatting instructions guide
Claude's replies; they do not enforce the format mechanically.

## Verify

Ask Claude to give you a command to print `handoff ready` for you to run, in a
`bash run` block. After the reply finishes, press prefix + `e`. The picker
should show Claude Code and a runnable snippet. Select a runner pane and use
`p` to paste without executing, or Enter to run. Press `o` to return its output.

If no items appear, run `shell-handoff doctor`, check the hook in `/hooks`, and
confirm Claude is running in a tmux or Herdr pane. A reply with no supported items clears
the previous capture. See [using both assistants](../../README.md#using-both-assistants)
for automatic detection when switching between Claude and Codex.
