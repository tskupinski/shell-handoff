# tmux

[Back to README](../../README.md) · [Claude Code](../assistants/claude-code.md) · [Codex CLI](../assistants/codex.md)

The tmux terminal adapter uses panes for assistant sessions and shell runners.
It requires tmux 3.2 or later for popups. Configure capture for each assistant
using the guides above, then add the shared shortcut once.

## Setup

Add this to `~/.tmux.conf`:

```tmux
bind-key e display-popup -E -w 90% -h 70% "shell-handoff pick"
```

Use an absolute path to `bin/shell-handoff` if it is not on tmux's PATH. The
launcher finds Node through PATH, asdf, or common installation locations.
Reload the configuration:

```sh
tmux source-file ~/.tmux.conf
```

Run your assistant inside tmux. After a reply finishes, press prefix + `e` in
that pane. The same shortcut works for both assistants; no assistant flag is
needed. See [automatic detection](../../README.md#using-both-assistants).

## Runner panes and output

On the first send, choose another pane or create a split below the assistant.
The runner is remembered per window in `@shell_handoff`; `r` changes it.
The picker previews the runner's screen. See the [shared keys](../../README.md#keys)
for running, pasting, copying, and returning output.

Commands can be typed line by line with Enter or sent as one bracketed paste
without Enter. Copy uses a tmux buffer and the first available clipboard tool:
`pbcopy`, `wl-copy`, `xclip`, or `xsel`.

Each send records a scrollback boundary and a fingerprint of preceding rows.
If retained history no longer matches after clearing, resizing, or overflow,
the report labels a fallback to retained pane history. Discarded output cannot
be recovered, and long lines can retain terminal wrapping. An idle shell's
fresh prompt is dropped; output from a still-running command is labeled.

Cache entries are isolated by tmux server lifetime and assistant. Older unscoped
captures are ignored. The runner selection is shared within a window, so use
separate runners for different assistants to avoid mixing their output.

## Troubleshooting

Run `shell-handoff doctor` for Claude Code or
`shell-handoff doctor --assistant codex` for Codex. Both check for a tmux binding;
Codex's assistant check currently prints setup guidance only.

If the shortcut is missing, reload `~/.tmux.conf` and inspect `tmux list-keys`.
If the popup opens but is empty, check the assistant's capture setup and finish
a reply containing a command or code block. If the runner was closed, press `r`
to choose another. Capture depends on `TMUX_PANE` and does nothing outside tmux.
