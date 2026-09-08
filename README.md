# shell-handoff

Run assistant commands in your terminal. Bring the output back.

Currently supports Claude Code and tmux, in the spirit of vim-tmux-runner.

When Claude Code hands you a shell command to run yourself - a login it cannot
do, a step behind a permission prompt, anything it prefixes with `! ` - this
pops up a list of those commands and sends the ones you pick to a shell pane.
When the command has run, one more key pastes its output back into Claude as
the next prompt.

```
Claude Code ──Stop hook──▶ ~/.cache/shell-handoff/<server>/<pane>.json ──▶ popup (prefix e)
     ▲                                                               │
     │                                  tmux send-keys ◀── you pick ─┘
     │                                        │
     └── `o` pastes what the runner printed ◀─┘
```

It is a companion to [Towerman](https://github.com/tskupinski/towerman) and
wears the same colors, but it needs neither Towerman nor its hooks. All it
needs is tmux 3.2 or later (for `display-popup`), Node 18 or later, and Claude
Code. No runtime dependencies.

Everything stays on your machine. The hook stores the finished reply's code
blocks and denied commands in `~/.cache/shell-handoff/`, nothing else, and
nothing is sent anywhere.

The `shell-handoff` binary is a small POSIX-sh launcher that finds `node`
itself - on `PATH`, else through `asdf`, else a common install location - so it
runs from tmux popups and Claude Code hooks, whose minimal environment often
lacks a version manager's shims on `PATH`.

## What it captures

From the reply that just finished, in two tiers. First, what Claude asked you
to run:

- **`! ` lines** in Claude's text, one item per line. Claude Code already
  suggests commands this way ("type `! foo` in the session"), so this works
  with no convention on your side.
- **Snippets** - a fenced block tagged `run`, like ```` ```bash run ````. The
  whole block is one item, sent as a unit: a heredoc, a few dependent lines,
  anything that should not be split.
- **Denied Bash calls** - a command Claude tried to run that the sandbox, the
  auto-mode classifier, or you rejected. You get the exact command it wanted,
  not a paraphrase.

Then, under a rule, **every other code block** in the reply, any language,
labeled with its language and line count. Not something Claude asked you to
run, but there if you want it - a config pasted into an editor pane, say.

To have Claude hand things off deliberately, tell it in `CLAUDE.md`: single
commands as `! ` lines in a bash block, a multi-line unit as a ```` ```bash run ````
block. Without the convention everything still shows up, just in the lower
tier.

## How it works

- **`shell-handoff capture`** is a Claude Code **Stop hook**. It reads the hook
  event on stdin and writes the pane's command list to
  `~/.cache/shell-handoff/<server>/<pane>.json`, replacing it every reply. It keys off
  `$TMUX_PANE`, so outside tmux it does nothing. The final message is read from
  the hook's `last_assistant_message` field, because the transcript file lags
  the live conversation at Stop time; earlier turn content comes from the
  transcript.
- **`shell-handoff pick`** is the **popup**, bound to a tmux key. It lists the
  captured commands, shows the runner pane (and a peek at its screen), and
  sends the marked ones. The runner pane is remembered per window in the
  `@shell_handoff` window option. With none set, or when it is gone, you pick
  one on send: any other pane in the session, or a fresh split below. Each send
  also records the runner pane's scrollback position and the commands sent in
  `~/.cache/shell-handoff/<server>/runs/<runner>.json`, which is what `o` reads back.

## Install

```sh
git clone https://github.com/tskupinski/shell-handoff
cd shell-handoff
npm link            # exposes the `shell-handoff` CLI (runs from src/, no build)
```

Or skip `npm link` and symlink `bin/shell-handoff` somewhere on your `PATH`.
The launcher resolves its own location through the symlink.

**1. The Stop hook** - add to `~/.claude/settings.json`:

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

**2. The tmux binding** - in `~/.tmux.conf`:

```tmux
bind-key e display-popup -E -w 90% -h 70% "shell-handoff pick"
```

Reload with `tmux source-file ~/.tmux.conf`.

**3. Check it:**

```sh
shell-handoff doctor
```

## Updating from claude-runner

Run `npm link` again (or update your symlink to `bin/shell-handoff`), then
change your Stop hook to `shell-handoff capture` and your tmux binding to
`shell-handoff pick`. Reload the hook and tmux configuration as described above.

The cache now lives under `~/.cache/shell-handoff/` (or
`$XDG_CACHE_HOME/shell-handoff/`), and the runner window option is
`@shell_handoff`. Old captures and runner selections are not migrated: finish
a new Claude reply, then choose your runner pane again.

## Use

After a reply where Claude hands you something, press your prefix + `e` in the
Claude pane. The highlighted item has a short preview under the list. Press `v` for the
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

## Closing the loop

What Claude wants next is usually the output of the thing it asked you to run.
After it has run, open the popup again and press **`o`**: everything the runner
pane has shown since the send is pasted into the Claude pane as a prompt, in
the shape

    Ran `gcloud auth login` in a shell.

    Output:

    ```
    ...
    ```

It arrives as a bracketed paste with **no Enter**, so it sits in Claude's input
as a draft: read it, cut what does not matter, add a question, then submit.

Details worth knowing:

- Cache entries are isolated by tmux server lifetime. Older unscoped cache
  entries are ignored; finish a new Claude reply to capture commands again.
- A shared runner keeps only its latest run. Output can only be returned from
  the source pane that sent that run.
- Paste mode joins selected items with newlines into one paste. A pasted
  command may still be awaiting execution when you request its output.

- Each send records the output boundary and a fingerprint of preceding rows.
  If retained history no longer matches (for example after clearing, resizing,
  or history overflow), the report explicitly labels a fallback to retained
  pane history. Discarded output cannot be recovered. Output uses physical
  terminal rows, so long lines can remain wrapped.
- An idle shell's fresh prompt is dropped from the end. If the command is still
  running (the pane's foreground process is not a shell), the output so far is
  pasted and labeled as such.
- Very long output is cut to its last 400 lines, and the paste says how many
  were cut. The end is where the error is.
- `o` also works from the "nothing captured" screen, when the reply that asked
  for the command is no longer the latest one.

## Keys

| Key | In the list | In a pane picker |
|-----|-------------|------------------|
| ↑ ↓ / k j | move | move |
| space | mark / unmark | |
| a | mark all / none | |
| ⏎ | run marked (or the highlighted one) | choose this pane |
| p | paste marked, no Enter | |
| y | copy marked to clipboard + tmux buffer | |
| o | paste the runner pane's output since the last send into Claude | |
| v | open full command; ↑↓ / j k scroll, esc returns | |
| r | pick a different runner pane | |
| esc | | back to the list |
| q / esc / ctrl-c | quit | |

## License

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
