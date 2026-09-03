// The popup. Opens on the commands captured for the pane it was launched from,
// shows where they will go, lets me mark some and send them to a runner pane.
// A full-redraw raw-mode TUI in the Towerman house style - no dependencies.

import { C, style } from "./palette.js";
import { readCommands } from "./store.js";
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

	const src = srcArg || (await currentPane());
	const commands = await readCommands(src);
	if (commands.length === 0) {
		process.stderr.write("claude-runner: no commands to run from the last reply in this pane\n");
		process.exit(0);
	}

	let cursor = 0;
	const marked = new Set();
	let runner = await resolveRunner(src);
	let runnerPreview = [];
	let message = "";

	// "list" chooses commands; "panes" chooses the runner pane.
	let mode = "list";
	let paneChoices = [];
	let paneCursor = 0;
	let pendingSend = false; // picking a pane because Enter was pressed with none set

	const refreshRunnerPreview = async () => {
		runnerPreview = runner ? await capturePane(runner, 6) : [];
	};
	await refreshRunnerPreview();

	const cols = () => out.columns || 80;

	const renderList = async () => {
		const w = cols();
		const lines = [];
		lines.push(` ${style("CLAUDE RUNNER", { fg: C.accent, bold: true })} ${style(`· ${commands.length} command${commands.length === 1 ? "" : "s"}`, { fg: C.muted })}`);
		lines.push("");

		if (runner) {
			const label = await paneLabel(runner);
			lines.push(` ${style("→ runner", { fg: C.green })} ${style(clip(label, w - 12), { fg: C.fg })}`);
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

	const renderPanes = () => {
		const w = cols();
		const lines = [];
		lines.push(` ${style("WHERE SHOULD THE COMMANDS GO?", { fg: C.accent, bold: true })}`);
		lines.push("");
		paneChoices.forEach((p, i) => {
			const here = i === paneCursor;
			const arrow = here ? style("❯", { fg: C.accent, bold: true }) : " ";
			const text = clip(p.label, w - 6);
			lines.push(` ${arrow}  ${here ? style(text, { fg: C.fg, bold: true }) : style(text, { fg: C.fg })}`);
		});
		lines.push("");
		lines.push(` ${style("↑↓ move · ⏎ choose · esc back", { fg: C.muted })}`);
		out.write(CLEAR + lines.join("\r\n"));
	};

	const render = () => (mode === "panes" ? renderPanes() : renderList());

	const flash = (text) => {
		message = text;
		render();
	};

	const openPanePicker = async () => {
		const siblings = await siblingPanes(src);
		paneChoices = [...siblings, { id: "new", label: "＋ split a new pane below Claude" }];
		paneCursor = 0;
		mode = "panes";
		render();
	};

	const choosePane = async () => {
		const choice = paneChoices[paneCursor];
		let id = choice.id;
		if (id === "new") id = await splitBelow(src);
		await setRunner(src, id);
		runner = id;
		await refreshRunnerPreview();
		mode = "list";
		message = "";
		if (pendingSend) {
			pendingSend = false;
			await doSend();
			return;
		}
		render();
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

			if (mode === "panes") {
				if (key === "\x1b") {
					mode = "list";
					pendingSend = false;
					return render();
				}
				if (key === "\x1b[A" || key === "k") paneCursor = Math.max(0, paneCursor - 1);
				else if (key === "\x1b[B" || key === "j") paneCursor = Math.min(paneChoices.length - 1, paneCursor + 1);
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
				await clearRunner(src);
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
