# shell-handoff

A tmux runner for Claude Code: pops up the shell commands Claude hands you in a
reply and sends the ones you pick to a shell pane, and brings the output back.
Companion to [Towerman](https://github.com/tskupinski/towerman), same visual
language, but no dependency on it - it must stay installable and useful on its
own.

## Shape

Plain JavaScript, ESM, Node 18+, zero runtime dependencies. One binary
(`shell-handoff`) with subcommands.

- `src/runtime.js` - composes the default Claude Code and tmux adapters with
  scoped storage; accepts substitutes for tests and future integrations.
- `src/assistants/codex.js` - Codex CLI notify capture and draft report delivery;
  selected with `--assistant codex`. Only the final reply is captured.
- `src/assistants/claude-code.js` - event extraction, report delivery, and hook
  diagnostics for Claude Code.
- `src/terminals/herdr.js` - local Herdr socket transport, pane controls, per-tab
  runner storage, and verified output boundary with labeled history fallback.
- `src/terminals/tmux.js` - tmux capabilities, target/storage identity, output
  cleanup, and binding diagnostics; delegates subprocess work to `src/tmux.js`.
- `src/handoff.js` - shared send/report workflow, source checks, run tracking.
  No assistant-specific events or tmux commands belong here.
- `src/items.js` - shared item kinds. See `docs/integrations.md` for contracts.
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
- `src/store.js` - per-pane JSON under `~/.cache/shell-handoff/`, isolated by tmux server socket, PID, and start time, then keyed by
  pane id. Old unscoped cache entries are ignored. Written whole every reply. Normalizes plain-string items within scoped files too.
  Also `runs/<runner>.json`: the last send into each runner pane (scrollback
  mark and history fingerprint, commands, source pane), which `o` reads back.
- `src/tmux.js` - every tmux call, plus the clipboard. Three ways out: `typeText`
  (line by line with Enter), `pasteText` (one bracketed paste, no Enter),
  `copyText` (tmux buffer + first clipboard tool found). `outputMark` and
  `captureSince` bracket a run: scrollback position and preceding-row fingerprint before the send,
  retained rows since it after. A changed fingerprint produces an explicitly
  labeled fallback to retained history. Self-contained.
- `src/output.js` - closing the loop, the pure half: `cleanOutput` (drop the
  idle shell's fresh prompt and trailing blanks), `formatReport` (the prompt
  pasted into Claude: command, fenced output, tail-truncated at 400 lines,
  labeled when still running), `isShell`. Covered by `test/`.
- `src/tui.js` - the popup: raw-mode, full-redraw picker. Primary items, a rule,
  then other blocks; a short preview and `v` for a scrollable full command; runner pane in
  the header with a peek at its screen. Keys: ⏎ run, `p` paste, `y` copy,
  `o` paste the runner's output since the last send into the Claude pane (no
  Enter), `r` runner, space/`a` mark. Pane picker when no runner is set; a
  source picker when the pane it opened on has nothing captured.
- `bin/shell-handoff` - POSIX-sh launcher that finds `node` (PATH, asdf, common
  paths) and execs `src/cli.js`. Popups and hooks often lack a version
  manager's shims on PATH, and a bare `node` fails there.
- `src/palette.js` - the Towerman palette, copied so there is no import from
  Towerman.
- `src/doctor.js` - checks the hook and the tmux binding; reports, never edits.

## Conventions

- Everything in English (code, UI, docs).
- No em dash "-" anywhere; use a plain dash.
- The runner pane is stored in the `@shell_handoff` tmux **window** option.
- The `run` tag (also `runner`) on a fence is the only convention Claude needs
  to know, and only for multi-line units. Everything else must keep working
  with no convention at all: `! ` lines are Claude Code's own idiom, and every
  other block still shows up in the lower tier.
- `npm test` runs the extractor and output-formatting tests (`node --test`).
  New parsing or formatting rules get a case there first. Integration tests use
  isolated tmux servers and exercise paste, report ownership, history loss,
  missing panes, server isolation, and hook failures.
- The capture hook is best-effort and silent: a hook failure must never
  disrupt the Claude session, so it always exits 0 and swallows its own errors.
- Match Towerman's terminal look (palette, inverse-video accents, htop feel)
  but never import from it. If something is genuinely shared, copy it.
- Keep it one dependency-free package so `npm link` (or a single symlink) is
  the whole install.

## Wiring (not in this repo)

- Stop hook in `~/.claude/settings.json` running `shell-handoff capture`.
- tmux binding (`prefix e`) running `shell-handoff pick` in a `display-popup`.

Both live in the user's dotfiles, not here. `shell-handoff doctor` checks them.
