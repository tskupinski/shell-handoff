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
- `src/transcript.js` - pulls items out of the finished turn. An item is
  `{ kind, text, lang }`; kinds `command` (a `! ` line), `snippet` (a fenced
  block tagged `run`, kept whole), `denied` (a rejected Bash tool call) form
  the primary tier, `block` (any other fenced block) the lower one. The closing
  message comes from the hook's `last_assistant_message` (the transcript file
  lags at Stop time); earlier turn content from the transcript tail. Fence
  parsing lives here; `itemsFromText()` is pure and covered by `test/`.
- `src/store.js` - per-pane JSON under `~/.cache/claude-runner/`, keyed by tmux
  pane id. Written whole every reply. Reads the old plain-string files too.
- `src/tmux.js` - every tmux call, plus the clipboard. Three ways out: `typeText`
  (line by line with Enter), `pasteText` (one bracketed paste, no Enter),
  `copyText` (tmux buffer + first clipboard tool found). Self-contained.
- `src/tui.js` - the popup: raw-mode, full-redraw picker. Primary items, a rule,
  then other blocks; the highlighted item previewed in full; runner pane in
  the header with a peek at its screen. Keys: ⏎ run, `p` paste, `y` copy,
  `r` runner, space/`a` mark. Pane picker when no runner is set; a
  source picker when the pane it opened on has nothing captured.
- `bin/claude-runner` - POSIX-sh launcher that finds `node` (PATH, asdf, common
  paths) and execs `src/cli.js`. Popups and hooks often lack a version
  manager's shims on PATH, and a bare `node` fails there.
- `src/palette.js` - the Towerman palette, copied so there is no import from
  Towerman.
- `src/doctor.js` - checks the hook and the tmux binding; reports, never edits.

## Conventions

- Everything in English (code, UI, docs).
- No em dash "-" anywhere; use a plain dash.
- The runner pane is stored in the `@claude_runner` tmux **window** option.
- The `run` tag (also `runner`) on a fence is the only convention Claude needs
  to know, and only for multi-line units. Everything else must keep working
  with no convention at all: `! ` lines are Claude Code's own idiom, and every
  other block still shows up in the lower tier.
- `npm test` runs the extractor tests (`node --test`). New parsing rules get a
  case there first.
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
