# Herdr

[Back to README](../../README.md) · [Claude Code](../assistants/claude-code.md) · [Codex CLI](../assistants/codex.md)

The Herdr adapter supports local Unix sockets on macOS and Linux. Tested with
Herdr 0.9.0. It uses Herdr's [socket API](https://herdr.dev/docs/socket-api/)
directly, so tmux is not required. Install Herdr using its
[installation guide](https://herdr.dev/docs/install/).

## Setup

Configure capture using the assistant guides above. The same Claude Stop hook
and Codex notify command work in both tmux and Herdr: shell-handoff detects
Herdr from `HERDR_SOCKET_PATH` and the pane environment. Keep any existing
Herdr agent-state hooks. If Codex already has a notify program, use a wrapper
that forwards the JSON argument to both programs instead of replacing it.

Add this to `~/.config/herdr/config.toml` (or your `HERDR_CONFIG_PATH`):

```toml
[[keys.command]]
key = "prefix+e"
type = "popup"
command = "shell-handoff pick"
description = "pick assistant commands"
width = "90%"
height = "70%"
```

Use an absolute path to `bin/shell-handoff` if it is not on Herdr's PATH.
Reload with `herdr server reload-config` or restart Herdr. This uses Herdr's
[custom popup binding](https://herdr.dev/docs/configuration/#custom-command-keybindings).
A popup receives `HERDR_ACTIVE_PANE_ID`, identifying the underlying assistant
pane, while normal pane processes and capture hooks receive `HERDR_PANE_ID`.

Run Claude Code or Codex inside Herdr, finish a reply containing a command or
code block, then press prefix + `e`. The picker detects the assistant and offers
other panes in the same workspace or a new split below as runners.

## Behavior and limits

- Runner selection is remembered per Herdr tab in the shell-handoff cache.
- Enter sends each line with Enter. `p` sends text through `pane.send_input`
  without an Enter key; Herdr honors the target application's bracketed-paste
  mode. Multiline paste requires a shell or application supporting that mode
  to remain an unsubmitted draft.
- `y` uses the system clipboard (`pbcopy`, `wl-copy`, `xclip`, or `xsel`). Herdr
  has no tmux-style paste-buffer fallback in this adapter.
- `o` returns output to the source assistant as a draft. Output capture reads
  up to 2,000 recent terminal rows and matches a retained boundary. If that
  boundary is missing or ambiguous, the report explicitly labels a fallback
  to recent history, which may contain older output. Shared formatting then
  limits the report to 400 lines.
- Replaced runner terminal IDs are rejected. Cache identity includes the local
  socket's identity and creation time, preventing reuse after socket recreation.
- Remote machine routing and Windows named pipes are not supported. Run
  shell-handoff on the same machine as the Herdr server.

When multiplexers are nested, Herdr takes precedence if its pane environment
is present. Use `--terminal tmux` or `--terminal herdr` on capture and picker
commands to explicitly select the intended backend.

## Verify and troubleshoot

Inside Herdr, run `shell-handoff doctor --terminal herdr` for Claude or
`shell-handoff doctor --terminal herdr --assistant codex` for Codex. The terminal
check probes the socket; it does not inspect the configured popup binding.

Ask the assistant for `printf 'handoff ready\n'` in a `bash run` block. After
its final reply, open the picker, select a runner, and run it. Reopen the picker
and press `o` to bring the output back as a draft.

If capture is empty, confirm the assistant is inside a normal Herdr pane and
its capture hook is configured. Popup processes are deliberately not capture
targets. If the socket is unavailable, check `HERDR_SOCKET_PATH` and whether
the Herdr server is running. Use a separate runner for each assistant when
working with both, so their outputs do not mix.

For development, set `HERDR_TEST_SOCKET` to an isolated test server's API socket
when running `npm test` to enable the live Herdr integration test. It creates
and closes its own workspace; do not point it at a production session.
