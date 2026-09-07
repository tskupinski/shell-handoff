# claude-runner

A tmux runner for Claude Code, in the spirit of vim-tmux-runner.

When Claude Code hands you a shell command to run yourself - a login it cannot
do, a step behind a permission prompt, anything it prefixes with `! ` - this
pops up a list of those commands and sends the ones you pick to a shell pane,
one line at a time.

```
Claude Code ──Stop hook──▶ ~/.cache/claude-runner/<pane>.json ──▶ popup (prefix e)
                                                                     │
                                        tmux send-keys ◀── you pick ─┘
```

It is a companion to [Towerman](https://github.com/tskupinski/towerman) and
wears the same colors, but it needs neither Towerman nor its hooks. All it
needs is tmux, Node 18+, and Claude Code.

The `claude-runner` binary is a small POSIX-sh launcher that finds `node`
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

- **`claude-runner capture`** is a Claude Code **Stop hook**. It reads the hook
  event on stdin and writes the pane's command list to
  `~/.cache/claude-runner/<pane>.json`, replacing it every reply. It keys off
  `$TMUX_PANE`, so outside tmux it does nothing. The final message is read from
  the hook's `last_assistant_message` field, because the transcript file lags
  the live conversation at Stop time; earlier turn content comes from the
  transcript.
- **`claude-runner pick`** is the **popup**, bound to a tmux key. It lists the
  captured commands, shows the runner pane (and a peek at its screen), and
  sends the marked ones. The runner pane is remembered per window in the
  `@claude_runner` window option. With none set, or when it is gone, you pick
  one on send: any other pane in the session, or a fresh split below.

## Install

```sh
git clone https://github.com/tskupinski/claude-runner ~/workshop/claude-runner
cd ~/workshop/claude-runner
npm link            # exposes the `claude-runner` CLI (runs from src/, no build)
```

Or skip `npm link` and symlink `src/cli.js` onto your `PATH` as `claude-runner`.

**1. The Stop hook** - add to `~/.claude/settings.json`:

```json
{
  "hooks": {
    "Stop": [
      { "matcher": "", "hooks": [
        { "type": "command", "command": "claude-runner capture", "timeout": 5 }
      ] }
    ]
  }
}
```

Open `/hooks` once (or restart) in running sessions so it loads.

**2. The tmux binding** - in `~/.tmux.conf`:

```tmux
bind-key e display-popup -E -w 90% -h 70% "claude-runner pick"
```

Reload with `tmux source-file ~/.tmux.conf`.

**3. Check it:**

```sh
claude-runner doctor
```

## Use

After a reply where Claude hands you something, press your prefix + `e` in the
Claude pane. The highlighted item shows in full under the list. Mark items with
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

## Keys

| Key | In the list | In a pane picker |
|-----|-------------|------------------|
| ↑ ↓ / k j | move | move |
| space | mark / unmark | |
| a | mark all / none | |
| ⏎ | run marked (or the highlighted one) | choose this pane |
| p | paste marked, no Enter | |
| y | copy marked to clipboard + tmux buffer | |
| r | pick a different runner pane | |
| esc | | back to the list |
| q / esc / ctrl-c | quit | |

## License

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
