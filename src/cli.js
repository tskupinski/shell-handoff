#!/usr/bin/env node
// claude-runner: send the shell commands Claude Code hands you into a tmux pane.
//
//   capture   Stop hook - reads the hook event JSON on stdin, stashes this
//             pane's hand-off commands (the "! " lines and denied Bash calls)
//   pick      the popup - choose commands, choose a runner pane, send them
//   doctor    check the hook + tmux wiring
//
// See README.md for how to wire it up.

import { capture } from "./capture.js";
import { doctor } from "./doctor.js";
import { pick } from "./tui.js";

const HELP = `claude-runner - run the commands Claude hands you, in a tmux pane

usage:
  claude-runner capture      Stop hook: stash this pane's commands (hook JSON on stdin)
  claude-runner pick [pane]  popup: pick commands and send them to a runner pane
  claude-runner doctor       check the Claude Code hook and tmux binding
  claude-runner help
`;

const [cmd, ...rest] = process.argv.slice(2);

switch (cmd) {
	case "capture":
		await capture();
		break;
	case "pick":
		await pick(rest[0]);
		break;
	case "doctor":
		await doctor();
		break;
	case undefined:
	case "help":
	case "-h":
	case "--help":
		process.stdout.write(HELP);
		break;
	default:
		process.stderr.write(`claude-runner: unknown command "${cmd}"\n\n${HELP}`);
		process.exit(1);
}
