# Rust migration

The Rust implementation lives under `rust/`, with a root Cargo manifest and
committed lockfile. It currently implements `capture` and `doctor` for both
assistant adapters and both terminal backends. Diagnostics use plain text
instead of the JavaScript version's ANSI colors.

The installed `bin/shell-handoff` launcher still runs JavaScript. Rust `pick`
reports that the picker is not implemented. Do not replace the installed
executable with the Rust binary yet.

## Development

Use a current stable Rust toolchain. Node 18+ and tmux are needed for the
cross-implementation integration tests. The executable targets Unix systems;
the CI matrix covers macOS and Linux.

```sh
cargo build --locked
cargo test --locked
cargo fmt --all --check
cargo clippy --locked --all-targets -- -D warnings
SHELL_HANDOFF_RUST_BIN=target/debug/shell-handoff npm test
```

`cargo build` creates `target/debug/shell-handoff`. Without
`SHELL_HANDOFF_RUST_BIN`, the JavaScript suite skips the Rust executable checks
but still validates the shared fixtures. The executable checks create isolated
tmux servers and a local Unix socket; they need permission to create sockets.

## Compatibility contract

- Capture accepts a JSON argument or stdin and remains silent with exit code 0
  on failure. Unrelated Codex notifications leave previous captures intact;
  completed empty replies replace them with an empty list.
- Captured item JSON, primary/secondary ordering, deduplication, transcript
  tails, and denied Bash extraction follow the JavaScript implementation.
- Cache paths preserve assistant and terminal isolation, including the legacy
  Claude Code/tmux namespace and Herdr socket lifetime identity.
- Captures are atomically replaced with private file permissions. Existing
  JavaScript storage and the picker can read the Rust captures.
- Doctor checks setup without changing assistant or terminal configuration.

`test/fixtures/capture.json` contains inputs and expected captures shared by
Rust and JavaScript. `test/rust-parity.test.js` also compares actual Rust cache
writes with JavaScript extraction and storage, checks hook failure handling,
and exercises diagnostics. Its Herdr service is a socket fixture, not a real
Herdr application. Full Herdr application verification remains a later step.

## Remaining milestones

1. Port output formatting, run-record storage, and the send/report workflow.
2. Implement terminal pane operations and the interactive picker.
3. Verify complete workflows with both real terminal backends; benchmark
   startup and memory against JavaScript.
4. Package native releases, update installation instructions, and switch the
   launcher after behavior parity and daily-use verification.

Keep new features and UI redesigns separate from behavior compatibility work.
