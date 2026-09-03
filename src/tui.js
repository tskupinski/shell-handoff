// The popup. Opens on the commands captured for the pane it was launched from,
// shows where they will go, lets me mark some and send them to a runner pane.
// A full-redraw raw-mode TUI in the Towerman house style - no dependencies.
//
// When the pane it opened on has nothing captured (you pressed the key in the
// wrong pane, or the reply had no commands), it does not vanish: it either
// lists the panes that do have commands to pick from, or says so and waits.

import { C, style } from "./palette.js";
import { listCaptures, readCommands } from "./store.js";
import {
	capturePane,
	clearRunner,
	currentPane,
	getRunner,
	paneExists,
	paneLabel,
	sendCommand,
	setRunner,
	siblingPanes,
	splitBelow,
} from "./tmux.js";

const ALT_ON = "\x1b[?1049h\x1b[?25l";
const ALT_OFF = "\x1b[?25h\x1b[?1049l";
const CLEAR = "\x1b[H\x1b[2J";

const oneLine = (cmd) => cmd.replace(/\s*\n\s*/g, " | ");
const clip = (s, w) => (s.length > w ? `${s.slice(0, w - 1)}…` : s);

async function resolveRunner(src) {
	const r = await getRunner(src);
	if (r && (await paneExists(r))) return r;
	return null;
}

export async function pick(srcArg) {
	const out = process.stdout;
	if (!process.stdin.isTTY || !out.isTTY) {
		process.stderr.write("claude-runner pick needs a terminal (run it from a tmux popup)\n");
		process.exit(1);
	}

	const openedOn = srcArg || (await currentPane());

	// Which pane's commands we are showing, and the commands themselves. When the
	// pane we opened on is empty, source is chosen from the panes that do have
	// commands (mode "source"); with none anywhere, mode "empty" just waits.
	let source = openedOn;
	let commands = await readCommands(source);

	let cursor = 0;
	const marked = new Set();
	let runner = null;
	let runnerPreview = [];
	let message = "";

	// "list" | "panes" | "source" | "empty"
	let mode = "list";
	let choices = []; // for "panes" and "source"
	let choiceCursor = 0;
	let pendingSend = false;

	if (commands.length === 0) {
		const others = [];
		for (const c of await listCaptures()) {
			if (c.pane !== openedOn && (await paneExists(c.pane))) {
				others.push({ id: c.pane, label: `${await paneLabel(c.pane)}  ·  ${c.commands.length} cmd`, commands: c.commands });
			}
		}
		if (others.length > 0) {
			mode = "source";
			choices = others;
		} else {
			mode = "empty";
		}
	} else {
		runner = await resolveRunner(source);
		await refreshRunnerPreview();
	}

	async function refreshRunnerPreview() {
		runnerPreview = runner ? await capturePane(runner, 6) : [];
	}

	const cols = () => out.columns || 80;

	const renderList = async () => {
		const w = cols();
		const lines = [];
		lines.push(` ${style("CLAUDE RUNNER", { fg: C.accent, bold: true })} ${style(`· ${commands.length} command${commands.length === 1 ? "" : "s"}`, { fg: C.muted })}`);
		lines.push("");
		if (runner) {
			lines.push(` ${style("→ runner", { fg: C.green })} ${style(clip(await paneLabel(runner), w - 12), { fg: C.fg })}`);
		} else {
			lines.push(` ${style("→ runner", { fg: C.yellow })} ${style("none yet - you pick one when you send", { fg: C.muted })}`);
		}
		lines.push("");
		commands.forEach((cmd, i) => {
			const here = i === cursor;
			const box = marked.has(i) ? style("[x]", { fg: C.green }) : style("[ ]", { fg: C.muted });
			const arrow = here ? style("❯", { fg: C.accent, bold: true }) : " ";
			const text = clip(oneLine(cmd), w - 8);
			lines.push(` ${arrow} ${box} ${here ? style(text, { fg: C.fg, bold: true }) : style(text, { fg: C.fg })}`);
		});
		if (runner && runnerPreview.length > 0) {
			lines.push("");
			const label = " runner pane ";
			lines.push(` ${style(`─${label}${"─".repeat(Math.max(0, Math.min(w - 3, 60) - label.length))}`, { fg: C.panel })}`);
			for (const l of runnerPreview) lines.push(`  ${style(clip(l, w - 4), { fg: C.muted })}`);
		}
		lines.push("");
		const help = "↑↓ move · space mark · a all · ⏎ send · r runner · q quit";
		lines.push(message ? ` ${style(message, { fg: C.yellow })}` : ` ${style(help, { fg: C.muted })}`);
		out.write(CLEAR + lines.join("\r\n"));
	};

	const renderChoices = (title, hint) => {
		const w = cols();
		const lines = [` ${style(title, { fg: C.accent, bold: true })}`, ""];
		choices.forEach((p, i) => {
			const here = i === choiceCursor;
			const arrow = here ? style("❯", { fg: C.accent, bold: true }) : " ";
			const text = clip(p.label, w - 6);
			lines.push(` ${arrow}  ${here ? style(text, { fg: C.fg, bold: true }) : style(text, { fg: C.fg })}`);
		});
		lines.push("");
		lines.push(` ${style(hint, { fg: C.muted })}`);
		out.write(CLEAR + lines.join("\r\n"));
	};

	const renderEmpty = () => {
		const lines = [
			` ${style("CLAUDE RUNNER", { fg: C.accent, bold: true })}`,
			"",
			` ${style("No commands captured for this pane yet.", { fg: C.yellow })}`,
			"",
			` ${style("They are captured per pane when a reply finishes. Press the key", { fg: C.muted })}`,
			` ${style("in the pane running Claude, after a reply that hands you a command", { fg: C.muted })}`,
			` ${style("(a \"! \" line) or has a denied command.", { fg: C.muted })}`,
			"",
			` ${style("If nothing ever appears, the Stop hook is not wired: run", { fg: C.muted })}`,
			` ${style("claude-runner doctor", { fg: C.fg })}`,
			"",
			` ${style("any key to close", { fg: C.muted })}`,
		];
		out.write(CLEAR + lines.join("\r\n"));
	};

	const render = () => {
		if (mode === "empty") return renderEmpty();
		if (mode === "source") return renderChoices("PICK A PANE WITH COMMANDS", "↑↓ move · ⏎ choose · q quit");
		if (mode === "panes") return renderChoices("WHERE SHOULD THE COMMANDS GO?", "↑↓ move · ⏎ choose · esc back");
		return renderList();
	};

	const cleanup = () => {
		process.stdin.setRawMode(false);
		process.stdin.pause();
		out.write(ALT_OFF);
	};
	const finish = (code = 0) => {
		cleanup();
		process.exit(code);
	};

	const enterList = async () => {
		mode = "list";
		cursor = 0;
		marked.clear();
		runner = await resolveRunner(source);
		await refreshRunnerPreview();
		render();
	};

	const openPanePicker = async () => {
		const siblings = await siblingPanes(source);
		choices = [...siblings, { id: "new", label: "＋ split a new pane below Claude" }];
		choiceCursor = 0;
		mode = "panes";
		render();
	};

	const choosePane = async () => {
		let id = choices[choiceCursor].id;
		if (id === "new") id = await splitBelow(source);
		await setRunner(source, id);
		runner = id;
		await refreshRunnerPreview();
		mode = "list";
		message = "";
		if (pendingSend) {
			pendingSend = false;
			return doSend();
		}
		render();
	};

	const doSend = async () => {
		const indexes = marked.size > 0 ? [...marked].sort((a, b) => a - b) : [cursor];
		for (const i of indexes) await sendCommand(runner, commands[i]);
		finish(0);
	};

	out.write(ALT_ON);
	process.stdin.setRawMode(true);
	process.stdin.resume();
	process.stdin.setEncoding("utf8");
	await render();

	let busy = false;
	process.stdin.on("data", async (key) => {
		if (busy) return;
		busy = true;
		try {
			if (key === "\x03") return finish(0); // ctrl-c

			if (mode === "empty") return finish(0);

			if (mode === "source") {
				if (key === "q") return finish(0);
				if (key === "\x1b[A" || key === "k") choiceCursor = Math.max(0, choiceCursor - 1);
				else if (key === "\x1b[B" || key === "j") choiceCursor = Math.min(choices.length - 1, choiceCursor + 1);
				else if (key === "\r") {
					source = choices[choiceCursor].id;
					commands = choices[choiceCursor].commands;
					return enterList();
				}
				return render();
			}

			if (mode === "panes") {
				if (key === "\x1b") {
					mode = "list";
					pendingSend = false;
					return render();
				}
				if (key === "\x1b[A" || key === "k") choiceCursor = Math.max(0, choiceCursor - 1);
				else if (key === "\x1b[B" || key === "j") choiceCursor = Math.min(choices.length - 1, choiceCursor + 1);
				else if (key === "\r") return choosePane();
				return render();
			}

			// list mode
			if (key === "q" || key === "\x1b") return finish(0);
			if (key === "\x1b[A" || key === "k") cursor = Math.max(0, cursor - 1);
			else if (key === "\x1b[B" || key === "j") cursor = Math.min(commands.length - 1, cursor + 1);
			else if (key === " ") {
				marked.has(cursor) ? marked.delete(cursor) : marked.add(cursor);
				cursor = Math.min(commands.length - 1, cursor + 1);
			} else if (key === "a") {
				if (marked.size === commands.length) marked.clear();
				else commands.forEach((_, i) => marked.add(i));
			} else if (key === "r") {
				await clearRunner(source);
				runner = null;
				runnerPreview = [];
				return openPanePicker();
			} else if (key === "\r") {
				if (!runner) {
					pendingSend = true;
					return openPanePicker();
				}
				return doSend();
			}
			render();
		} finally {
			busy = false;
		}
	});
}
