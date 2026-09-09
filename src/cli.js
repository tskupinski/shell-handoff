#!/usr/bin/env node
import { capture } from "./capture.js";
import { doctor } from "./doctor.js";
import { pick } from "./tui.js";
import { createRuntime, createPickerRouter, selectTerminal } from "./runtime.js";

const HELP = `shell-handoff - run assistant commands in a terminal pane

usage:
  shell-handoff capture [--assistant claude-code|codex] [event-json]
  shell-handoff pick [pane] [--assistant auto|claude-code|codex]
  shell-handoff doctor [--assistant claude-code|codex]
  shell-handoff help

All commands accept --terminal auto|tmux|herdr (default: auto).

Pick detects the assistant from the pane's latest capture. Capture and doctor
default to Claude Code. Capture reads JSON from stdin, or from the
single JSON argument supplied by Codex notify.
`;

const [cmd, ...rest] = process.argv.slice(2);
try {
	let assistant = cmd === "pick" ? "auto" : "claude-code";
	let terminalId = "auto";
	const args = [];
	for (let i = 0; i < rest.length; i++) {
		if (rest[i] === "--terminal") {
			if (!rest[i + 1]) throw new Error("--terminal requires auto, tmux, or herdr");
			terminalId = rest[++i];
		} else if (rest[i].startsWith("--terminal=")) {
			terminalId = rest[i].slice("--terminal=".length);
		} else if (rest[i] === "--assistant") {
			if (!rest[i + 1]) throw new Error("--assistant requires claude-code or codex");
			assistant = rest[++i];
		} else if (rest[i].startsWith("--assistant=")) {
			assistant = rest[i].slice("--assistant=".length);
		} else {
			args.push(rest[i]);
		}
	}
	const terminal = selectTerminal(terminalId);
	switch (cmd) {
		case "capture":
			if (args.length > 1) throw new Error("capture accepts one JSON argument");
			await capture(createRuntime({ assistant, terminal }), args[0]);
			break;
		case "pick":
			if (args.length > 1 || args[0]?.startsWith("-")) throw new Error("pick accepts one pane argument");
			await pick(args[0], assistant === "auto" ? createPickerRouter({ terminal }) : createRuntime({ assistant, terminal }));
			break;
		case "doctor":
			if (args.length) throw new Error("doctor accepts no positional arguments");
			await doctor(createRuntime({ assistant, terminal }));
			break;
		case undefined:
		case "help":
		case "-h":
		case "--help":
			process.stdout.write(HELP);
			break;
		default:
			throw new Error(`unknown command "${cmd}"`);
	}
} catch (error) {
	// A hook failure must never disrupt an assistant session.
	if (cmd !== "capture") {
		process.stderr.write(`shell-handoff: ${error.message}\n\n${HELP}`);
		process.exitCode = 1;
	}
}
