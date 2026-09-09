# Integration boundaries

For installation and configuration, see the [setup guides](../README.md#install-and-setup).

Claude Code and Codex CLI assistant adapters and tmux and Herdr terminal adapters
are built in. This is an internal JavaScript
contract, not a public plugin API or a promise of other integrations.

`createRuntime()` in `src/runtime.js` composes an assistant, a terminal, and
storage. `capture`, `pick`, and `doctor` accept an optional runtime for tests
and future integrations. CLI commands accept `--assistant claude-code|codex`;
Capture and doctor default to Claude Code. Pick defaults to automatic detection
from the latest capture modification time in the source pane, including empty
captures. Its source chooser combines both assistants and changes runtime when
the user selects a source. Explicit `--assistant` bypasses detection.
Codex notify supplies capture JSON as an argument. `--terminal auto|tmux|herdr`
selects the backend; auto prefers a Herdr pane environment and otherwise tmux.
Herdr uses a local Unix socket, popup source IDs, and per-tab runner storage.

## Assistant

- `id`, `label`, `captureHint`: stable identity and picker wording.
- `extractItems(event)`: normalize an app's hook event into `{ kind, text, lang }`
  items. Claude's transcript parsing remains in `src/transcript.js`.
- Optional `acceptsEvent(event)`: ignore unrelated events without clearing captures.
- `returnReport({ terminal, source, text })`: deliver a draft to the source
  conversation and return a user-facing status. Never submit automatically.
  Claude Code pastes through the terminal, or copies when paste is unsupported.
- Optional `checkSetup()`: return `{ status: "ok" | "bad" | "info", message }`.

Integrate assistant applications, not individual model names: the application
owns the event and input protocol.

## Terminal

The current interface uses “pane” for a target, but target IDs are opaque
strings. Another adapter can map tabs, windows, or sessions to that contract.
Methods should not depend on `this`, since the picker destructures them.

Required operations are `captureTarget`, `currentPane`, `paneExists`,
`paneLabel`, `siblingPanes`, `getRunner`, `setRunner`, `clearRunner`, `typeText`,
`copyText`, and `flash`. `captureTarget` returns null when a capture event has
no usable target. `siblingPanes` returns `{ id, label }` entries. `copyText`
returns the destination label, or null when the backend's own buffer was used;
throw if no destination succeeds. `checkSetup` is optional.

Capabilities control optional operations:

| Capability | Methods | Behavior when absent |
| --- | --- | --- |
| `paste` | `pasteText` | Paste action explains how to use copy; report delivery can copy |
| `output` | `outputMark`, `readOutput` | Commands still run; automatic output return explains the limitation |
| `preview` | `capturePane` | Runner preview is omitted |
| `split` | `splitBelow` | Picker only offers existing targets |

`outputMark` returns any serializable, non-null backend marker. `readOutput`
returns `{ lines, running, warning }` with terminal-specific cleanup already
applied. The shared report formatter does not interpret shell process names or
scrollback. The tmux adapter owns those heuristics.

Popup creation is external to the picker; `pick` only requires a TTY. A backend
without popup support can run it in an ordinary interactive terminal.

## Storage and shared workflow

Terminal `storage` provides `scope()` (server lifetime identity), `key(target)`
(a unique filename-safe key using letters, digits, underscores or hyphens),
`target(key)` (inverse mapping, or null), and `validMark(mark)`.
Storage namespaces combine terminal and assistant identities. The existing
Claude Code/tmux namespace is preserved for compatibility.

`sendItems` and `returnOutput` in `src/handoff.js` own selection delivery, run
records, source ownership, and report formatting. Failed sends invalidate old
reports. Commands sent without output support have a null marker. The picker
owns navigation and rendering only.

Before adding a built-in adapter, test its behavior against a real application.
The substitute adapters in `test/handoff.test.js` validate shared behavior but
are not evidence that another terminal or assistant is supported.
