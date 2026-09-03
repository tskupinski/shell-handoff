# claude-runner

A tmux runner for Claude Code: pops up the shell commands Claude hands you in a
reply and sends the ones you pick to a shell pane. Companion to Towerman
(`~/workshop/towerman`), same visual language, but no dependency on it - it must
stay installable and useful on its own.

## Shape

Plain JavaScript, ESM, Node 18+, zero runtime dependencies. One binary
(`claude-runner`) with subcommands.

- `src/cli.js` - entry point and subcommand dispatch (`capture`, `pick`, `doctor`)
- `src/capture.js` - the Claude Code **Stop hook**: reads the hook event on
  stdin, writes the pane's command list. Never throws out to the session.
- `src/transcript.js` - pulls commands out of the finished turn: `! ` lines in
  Claude's text + denied Bash tool calls. The closing message comes from the
  hook's `last_assistant_message` (the transcript file lags at Stop time);
  earlier turn content from the transcript tail.
- `src/store.js` - per-pane JSON under `~/.cache/claude-runner/`, keyed by tmux
  pane id. Written whole every reply.
- `src/tmux.js` - every tmux call. Self-contained.
- `src/tui.js` - the popup: raw-mode, full-redraw picker. Command list first,
  runner pane shown in the header with a peek at its screen; pane picker when
  no runner is set.
- `src/palette.js` - the Towerman palette, copied so there is no import from
  Towerman.
- `src/doctor.js` - checks the hook and the tmux binding; reports, never edits.

## Conventions

- Everything in English (code, UI, docs).
- No em dash "-" anywhere; use a plain dash.
- The runner pane is stored in the `@claude_runner` tmux **window** option.
- The capture hook is best-effort and silent: a hook failure must never
  disrupt the Claude session, so it always exits 0 and swallows its own errors.
- Match Towerman's terminal look (palette, inverse-video accents, htop feel)
  but never import from it. If something is genuinely shared, copy it.
- Keep it one dependency-free package so `npm link` (or a single symlink) is
  the whole install.

## Wiring (not in this repo)

- Stop hook in `~/.claude/settings.json` running `claude-runner capture`.
- tmux binding (`prefix e`) running `claude-runner pick` in a `display-popup`.

Both live in `~/workshop/dotfiles`. `claude-runner doctor` checks them.
