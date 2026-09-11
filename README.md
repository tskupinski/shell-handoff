# shell-handoff

Run assistant commands in your terminal. Bring the output back.

When your assistant gives you a shell command to run yourself, shell-handoff
opens a picker, sends your selection to a runner pane, and brings the output
back as a draft. It supports Claude Code and Codex CLI in tmux or Herdr, with one shortcut
for both.

It is a companion to [Towerman](https://github.com/tskupinski/towerman), with the
same colors but no dependency on it. Requires Node 18+ and a supported terminal adapter.
No runtime dependencies or build step.

## Install and setup

```sh
git clone https://github.com/tskupinski/shell-handoff
cd shell-handoff
npm link            # exposes the `shell-handoff` CLI (runs from src/, no build)
```

Or skip `npm link` and symlink `bin/shell-handoff` somewhere on your `PATH`.
The launcher resolves its own location through the symlink.

Configure each assistant you use, then your terminal adapter:

| Type | Guide | Setup |
| --- | --- | --- |
| Assistant | [Claude Code](docs/assistants/claude-code.md) | Stop hook and optional command-formatting instructions |
| Assistant | [Codex CLI](docs/assistants/codex.md) | Capture notification and command-formatting instructions |
| Terminal / multiplexer | [tmux](docs/terminals/tmux.md) | tmux 3.2+, shared popup shortcut and runner panes |
| Terminal / multiplexer | [Herdr](docs/terminals/herdr.md) | Herdr 0.9.0, local socket API and popup shortcut |

Installing the CLI alone does not enable capture. Both assistants need their
own capture configuration; the terminal shortcut is configured once.

## Use

After a reply where your assistant hands you something, press your prefix + `e` in the
assistant pane. The highlighted item has a short preview under the list. Press `v` for the
full command, with wrapped lines and scrolling using arrows or `j`/`k`. Mark items with
space (or `a` for all), then:

- **⏎ runs** them in the runner pane: typed line by line, Enter after each.
  Right for shells, heredocs, REPLs.
- **`p` pastes** them as one bracketed paste with no Enter. The shell shows the
  whole thing and waits, so you can read or edit before running. Also the mode
  for an editor pane.
- **`y` copies** them to a tmux paste buffer and the system clipboard (pbcopy,
  wl-copy, xclip or xsel, whichever exists), then closes.

The first time in a window it asks which pane is the runner; after that it goes
straight to the list. `r` changes the runner pane.

## Using both assistants

`shell-handoff pick` automatically selects the assistant with the most recent
capture in the current pane, including replies with no commands. Its title
shows the selected assistant. After switching assistants in the same pane,
finish one reply before opening the picker.

If the current pane has no items, the source chooser can list captures from
both assistants. Use `--assistant claude-code` or `--assistant codex` to override
detection. Captures and run records are isolated by assistant. The runner
selection is shared per tmux window or Herdr tab; use separate runner panes for different
assistants to keep output from mixing.

Terminal detection uses the Herdr pane environment when present, otherwise tmux.
Use `--terminal tmux` or `--terminal herdr` to override it.

## What it captures

- **Commands:** `! ` lines, one command per item.
- **Snippets:** fences tagged `run` or `runner`, such as `bash run`. Each block
  stays together, including dependent commands and heredocs.
- **Denied commands:** rejected Bash tool calls, supported by Claude Code.
- **Other code:** all other fenced blocks, shown below the primary items with
  their language and line count.

The assistant guides describe capture limits and provide copyable formatting
instructions. Codex captures only its final reply; Claude Code also reads
previous content from the completed turn's transcript.

## Returning output

After running a command, open the picker again and press **`o`**. The runner's
output since the last send is pasted into the source assistant as a draft,
with the command and fenced output. Nothing is submitted automatically: review
or edit the draft, then press Enter yourself.

A runner retains only the latest run record within each assistant's storage.
Output can only be returned from the source pane that sent that run. Output is
capped at its last 400 lines, and truncation or incomplete history is labeled.
`o` also works on the empty screen if a previous run belongs to that pane.
See the [tmux](docs/terminals/tmux.md#runner-panes-and-output) and
[Herdr](docs/terminals/herdr.md#behavior-and-limits) guides for output capture limits.

## Local storage

Captures and run records stay under `~/.cache/shell-handoff/`, or
`$XDG_CACHE_HOME/shell-handoff/`, isolated by assistant, terminal backend, and server identity.
Each captured reply replaces the pane's previous items. Run records contain
the commands sent, source pane, and output boundary. shell-handoff itself makes
no network requests; returned output is pasted into your assistant's input.

## Keys

| Key | In the list | In a pane picker |
|-----|-------------|------------------|
| ↑ ↓ / k j | move | move |
| space | mark / unmark | |
| a | mark all / none | |
| ⏎ | run marked (or the highlighted one) | choose this pane |
| p | paste marked, no Enter | |
| y | copy marked to clipboard + tmux buffer | |
| o | paste the runner pane's output since the last send into the assistant | |
| v | open full command; ↑↓ / j k scroll, esc returns | |
| r | pick a different runner pane | |
| esc | | back to the list |
| q / esc / ctrl-c | quit | |

## Updating from claude-runner

Run `npm link` again (or update your symlink to `bin/shell-handoff`), then
change your Stop hook to `shell-handoff capture` and your tmux binding to
`shell-handoff pick`. Reload the hook and tmux configuration in the assistant and terminal guides.

The cache now lives under `~/.cache/shell-handoff/` (or
`$XDG_CACHE_HOME/shell-handoff/`), and the runner window option is
`@shell_handoff`. Old captures and runner selections are not migrated: finish
a new assistant reply, then choose your runner pane again.

## Integration development

A Rust migration is in progress alongside the JavaScript implementation.
The first milestone implements `capture` and `doctor`; the installed launcher
and picker still use JavaScript. See [Rust development](docs/rust-migration.md)
for building and checking compatibility.

Setup guides live in `docs/assistants/` and `docs/terminals/`. The terminal
category includes multiplexers such as tmux and can also cover other terminal
backends. See [the integration contract](docs/integrations.md) for adapter
interfaces, capabilities, and storage boundaries.

## License

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
