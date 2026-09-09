// The popup. Opens on the items captured for the pane it was launched from,
// shows where they will go, lets me mark some and send, paste or copy them.
// A full-redraw raw-mode TUI in the Towerman house style - no dependencies.
//
// Two tiers in the list: what Claude asked me to run (commands, snippets,
// denied calls), then, under a rule, every other code block from the reply.
// The highlighted item shows in full below the list, so nothing is sent blind.
//
// After a send, `o` closes the loop: what the runner pane has shown since is
// pasted into the Claude pane as a prompt, without Enter, for me to read and
// add to before submitting.
//
// When the pane it opened on has nothing captured (you pressed the key in the
// wrong pane, or the reply had no code), it does not vanish: it either lists
// the panes that do have items to pick from, or says so and waits.

import { C, style } from "./palette.js";
import { createPickerRouter } from "./runtime.js";
import { sendItems, returnOutput } from "./handoff.js";
import { PRIMARY_KINDS } from "./items.js";

const ALT_ON = "\x1b[?1049h\x1b[?25l";
const ALT_OFF = "\x1b[?25h\x1b[?1049l";
const CLEAR = "\x1b[H\x1b[2J";

const visibleText = (s) => s.replace(/[\x00-\x08\x0b-\x1f\x7f]/g, (c) => `\\x${c.charCodeAt(0).toString(16).padStart(2, "0")}`);
const clip = (text, w) => { const s = visibleText(text); return (s.length > w ? `${s.slice(0, Math.max(0, w - 1))}…` : s); };
const firstLine = (text) => text.split("\n").find((l) => l.trim()) ?? "";
const lineCount = (text) => text.split("\n").length;

function badge(item) {
	const n = lineCount(item.text);
	if (item.kind === "denied") return style("denied", { fg: C.yellow });
	if (item.kind === "snippet") return style(`${n} lines`, { fg: C.blue });
	if (item.kind === "block") return style(`${item.lang || "text"}${n > 1 ? ` · ${n} lines` : ""}`, { fg: C.muted });
	return "";
}

export async function pick(srcArg, runtime) {
	const router = runtime?.forSource ? runtime : runtime ? null : createPickerRouter();
	if (router) runtime = undefined;
	const terminal = runtime?.terminal ?? router.terminal;
	const { capturePane, clearRunner, copyText, currentPane, flash, getRunner,
		paneExists, paneLabel, setRunner, siblingPanes, splitBelow } = terminal;
	const resolveRunner = async (src) => {
		const runner = await getRunner(src);
		return runner && runner !== src && await paneExists(runner) ? runner : null;
	};
	const out = process.stdout;
	if (!process.stdin.isTTY || !out.isTTY) {
		process.stderr.write("shell-handoff pick needs an interactive terminal\n");
		process.exit(1);
	}

	const openedOn = srcArg || (await currentPane());
	runtime ??= await router.forSource(openedOn);
	let { assistant, store } = runtime;
	const listCaptures = () => router ? router.listCaptures() : store.listCaptures();
	const readItems = (pane) => store.readItems(pane);
	const readRun = (pane) => store.readRun(pane);

	// Which pane's items we are showing, and the items themselves: the primary
	// tier first, the other blocks after. When the pane we opened on is empty,
	// source is chosen from the panes that do have items (mode "source"); with
	// none anywhere, mode "empty" just waits.
	let source = openedOn;
	let items = await readItems(source);
	let runner = await resolveRunner(source);
	// Whether the runner has something to report back; only decides what the
	// empty screen offers, `o` itself re-reads the run.
	const hasRun = runner ? (await readRun(runner))?.source === source : false;
	const primaryCount = () => items.filter((it) => PRIMARY_KINDS.has(it.kind)).length;

	let cursor = 0;
	let previewOffset = 0;
	const marked = new Set();
	let runnerPeek = [];
	let message = "";

	// "list" | "panes" | "source" | "empty"
	let mode = "list";
	let choices = []; // for "panes" and "source"
	let choiceCursor = 0;
	let pendingSend = null; // the send mode to run after picking a runner

	const refreshRunnerPeek = async () => {
		runnerPeek = runner && terminal.capabilities.preview ? await capturePane(runner, 3) : [];
	};

	if (items.length === 0) {
		const others = [];
		for (const c of await listCaptures()) {
			if (c.pane !== openedOn && (await paneExists(c.pane))) {
				others.push({ id: c.pane, label: `${await paneLabel(c.pane)}  ·  ${c.assistant?.label ?? assistant.label} · ${c.items.length} item${c.items.length === 1 ? "" : "s"}`, items: c.items });
			}
		}
		if (others.length > 0 && !hasRun) {
			mode = "source";
			choices = others;
		} else {
			mode = "empty";
		}
	} else {
		await refreshRunnerPeek();
	}

	const cols = () => out.columns || 80;
	const rows = () => out.rows || 24;

	// What is left for the preview and the runner peek once the title, the
	// runner line, the list, and the footer have taken their rows.
	const layout = () => {
		const divider = primaryCount() > 0 && primaryCount() < items.length ? 1 : 0;
		const fixed = 7; // title, blank, runner, blank, [list], blank, footer
		const visible = Math.min(items.length, Math.max(1, rows() - 14));
		const spare = rows() - fixed - visible - divider;
		let preview = 0;
		let peek = 0;
		if (spare >= 3) preview = Math.min(8, spare - 1); // one row for its rule
		const rest = spare - (preview ? preview + 1 : 0);
		if (runner && rest >= 3) peek = Math.min(runnerPeek.length, rest - 1);
		return { preview, peek, visible };
	};

	const rule = (label, w) => ` ${style(`─${label}${"─".repeat(Math.max(0, Math.min(w - 3, 60) - label.length))}`, { fg: C.panel })}`;

	const renderList = async () => {
		const w = cols();
		const { preview, peek, visible } = layout();
		const lines = [];
		const n = primaryCount();
		lines.push(` ${style("SHELL HANDOFF", { fg: C.accent, bold: true })} ${style(`· ${assistant.label} · ${n} to run${items.length > n ? `, ${items.length - n} more block${items.length - n === 1 ? "" : "s"}` : ""}`, { fg: C.muted })}`);
		lines.push("");
		if (runner) {
			lines.push(` ${style("→ runner", { fg: C.green })} ${style(clip(await paneLabel(runner), w - 12), { fg: C.fg })}`);
		} else {
			lines.push(` ${style("→ runner", { fg: C.yellow })} ${style("none yet - you pick one when you send", { fg: C.muted })}`);
		}
		lines.push("");
		const start = Math.max(0, Math.min(cursor - Math.floor(visible / 2), items.length - visible));
		items.slice(start, start + visible).forEach((item, offset) => {
			const i = start + offset;
			if (i === n && n > 0) lines.push(rule(" other code in the reply ", w));
			const here = i === cursor;
			const box = marked.has(i) ? style("[x]", { fg: C.green }) : style("[ ]", { fg: C.muted });
			const arrow = here ? style("❯", { fg: C.accent, bold: true }) : " ";
			const tag = badge(item);
			const tagW = tag ? tag.replace(/\x1b\[[0-9;]*m/g, "").length + 2 : 0;
			const text = clip(firstLine(item.text), w - 8 - tagW);
			const dim = item.kind === "block" && !here;
			const shown = here ? style(text, { fg: C.fg, bold: true }) : style(text, { fg: dim ? C.muted : C.fg });
			lines.push(` ${arrow} ${box} ${tag ? `${tag}  ` : ""}${shown}`);
		});
		if (preview > 0 && items[cursor]) {
			lines.push("");
			const all = items[cursor].text.split("\n");
			const shown = all.slice(0, preview);
			lines.push(rule(all.length > preview ? ` ${lineCount(items[cursor].text)} lines, first ${preview} ` : "", w));
			for (const l of shown) lines.push(`  ${style(clip(l, w - 4), { fg: C.fg })}`);
		}
		if (peek > 0) {
			lines.push(rule(" runner pane ", w));
			for (const l of runnerPeek.slice(-peek)) lines.push(`  ${style(clip(l, w - 4), { fg: C.muted })}`);
		}
		lines.push("");
		const help = "↑↓ move · space mark · a all · v full preview · ⏎ run · p paste · y copy · o output→assistant · r runner · q quit";
		lines.push(message ? ` ${style(message, { fg: C.yellow })}` : ` ${style(help, { fg: C.muted })}`);
		out.write(CLEAR + lines.join("\r\n"));
	};

	const renderChoices = (title, hint) => {
		const w = cols();
		const lines = [` ${style(title, { fg: C.accent, bold: true })}`, ""];
		const visible = Math.max(1, rows() - 5);
		const start = Math.max(0, Math.min(choiceCursor - Math.floor(visible / 2), choices.length - visible));
		choices.slice(start, start + visible).forEach((p, offset) => {
			const i = start + offset;
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
			` ${style("SHELL HANDOFF", { fg: C.accent, bold: true })}`,
			"",
			` ${style("Nothing captured for this pane yet.", { fg: C.yellow })}`,
			"",
			` ${style("Items are captured per pane when a reply finishes. Press the key", { fg: C.muted })}`,
			` ${style(`in the ${assistant.label} pane, after a reply with`, { fg: C.muted })}`,
			` ${style(`${assistant.captureHint}.`, { fg: C.muted })}`,
			"",
			` ${style("If nothing ever appears, check capture setup with", { fg: C.muted })}`,
			` ${style(`shell-handoff doctor --assistant ${assistant.id}`, { fg: C.fg })}`,
			"",
		];
		if (hasRun) {
			lines.push(` ${style("o", { fg: C.fg })} ${style("paste the runner pane's output into the assistant", { fg: C.muted })}`);
			lines.push("");
		}
		if (message) lines.push(` ${message}`);
		lines.push(` ${style("any key to close", { fg: C.muted })}`);
		out.write(CLEAR + lines.join("\r\n"));
	};

	const renderPreview = () => {
		const width = Math.max(1, cols() - 4);
		const content = items[cursor].text.split("\n").flatMap((line) => {
			const chars = Array.from(visibleText(line).replace(/\t/g, "    "));
			const chunks = [];
			for (let i = 0; i < chars.length; i += width) chunks.push(chars.slice(i, i + width).join(""));
			return chunks.length ? chunks : [""];
		});
		const height = Math.max(1, rows() - 4);
		previewOffset = Math.min(previewOffset, Math.max(0, content.length - height));
		out.write(CLEAR + [" FULL COMMAND · ↑↓ / j k scroll · esc back", "",
			...content.slice(previewOffset, previewOffset + height).map((line) => `  ${line}`),
			` ${previewOffset + 1}-${Math.min(content.length, previewOffset + height)} / ${content.length}`].join("\r\n"));
	};

	const render = () => {
		if (mode === "preview") return renderPreview();
		if (mode === "empty") return renderEmpty();
		if (mode === "source") return renderChoices("PICK A PANE WITH ITEMS", "↑↓ move · ⏎ choose · q quit");
		if (mode === "panes") return renderChoices("WHERE SHOULD IT GO?", "↑↓ move · ⏎ choose · esc back");
		return renderList();
	};

	let cleaned = false;
	const cleanup = () => {
		if (cleaned) return;
		cleaned = true;
		if (process.stdin.isTTY) process.stdin.setRawMode(false);
		process.stdin.pause();
		out.write(ALT_OFF);
	};
	const finish = (code = 0) => {
		cleanup();
		process.exit(code);
	};

	const selection = () => (marked.size > 0 ? [...marked].sort((a, b) => a - b) : [cursor]).map((i) => items[i]);

	const enterList = async () => {
		mode = "list";
		cursor = 0;
		marked.clear();
		runner = await resolveRunner(source);
		await refreshRunnerPeek();
		return render();
	};

	const openPanePicker = async () => {
		const siblings = await siblingPanes(source);
		choices = [...siblings];
		if (terminal.capabilities.split) choices.push({ id: "new", label: `＋ split a new pane below ${assistant.label}` });
		if (!choices.length) throw new Error("No runner targets available; open another terminal pane first");
		choiceCursor = 0;
		mode = "panes";
		return render();
	};

	const choosePane = async () => {
		let id = choices[choiceCursor].id;
		if (id === "new") id = await splitBelow(source);
		await setRunner(source, id);
		runner = id;
		await refreshRunnerPeek();
		mode = "list";
		message = "";
		if (pendingSend) {
			const how = pendingSend;
			pendingSend = null;
			return send(how);
		}
		return render();
	};

	// how: "type" runs each item line by line; "paste" pastes it whole, no Enter.
	// The runner's position is marked first, so `o` can later pick up exactly
	// what these items produced.
	const send = async (how) => {
		if (!runner) {
			pendingSend = how;
			return openPanePicker();
		}
		await sendItems(runtime, { source, runner, items: selection(), how });
		finish(0);
	};

	// Close the loop: what the runner pane has shown since the last send goes
	// into the Claude pane as one bracketed paste. No Enter - it lands as a
	// draft to read, trim or add to, then submit.
	const report = async () => {
		const result = await returnOutput(runtime, { source, runner });
		await flash(source, `shell-handoff: ${result}`);
		finish(0);
	};

	const copy = async () => {
		const chosen = selection();
		const text = chosen.map((it) => it.text).join("\n");
		const where = await copyText(text);
		const n = lineCount(text);
		await flash(source, `shell-handoff: copied ${n} line${n === 1 ? "" : "s"} to ${where ? `${where} and ` : ""}the terminal buffer`);
		finish(0);
	};

	process.once("exit", cleanup);
	process.once("SIGTERM", () => finish(143));
	process.once("SIGINT", () => finish(130));
	out.write(ALT_ON);
	process.stdin.setRawMode(true);
	process.stdin.resume();
	process.stdin.setEncoding("utf8");
	await render();

	let busy = false;
	out.on("resize", async () => {
		if (busy || cleaned) return;
		busy = true;
		try { await render(); } catch { finish(1); } finally { busy = false; }
	});
	process.stdin.on("data", async (key) => {
		if (busy) return;
		busy = true;
		try {
			if (key === "\x03") return finish(0); // ctrl-c

			if (mode === "preview") {
				if (key === "\x1b" || key === "q") mode = "list";
				else if (key === "j" || key === "\x1b[B") previewOffset++;
				else if (key === "k" || key === "\x1b[A") previewOffset = Math.max(0, previewOffset - 1);
				return await render();
			}
			if (mode === "empty") return key === "o" && hasRun ? await report() : finish(0);

			if (mode === "source") {
				if (key === "q" || key === "\x1b") return finish(0);
				if (key === "\x1b[A" || key === "k") choiceCursor = Math.max(0, choiceCursor - 1);
				else if (key === "\x1b[B" || key === "j") choiceCursor = Math.min(choices.length - 1, choiceCursor + 1);
				else if (key === "\r") {
					source = choices[choiceCursor].id;
					if (router) {
						runtime = await router.forSource(source);
						({ assistant, store } = runtime);
					}
					items = await readItems(source);
					return await enterList();
				}
				return await render();
			}

			if (mode === "panes") {
				if (key === "\x1b") {
					mode = "list";
					pendingSend = null;
					return await render();
				}
				if (key === "\x1b[A" || key === "k") choiceCursor = Math.max(0, choiceCursor - 1);
				else if (key === "\x1b[B" || key === "j") choiceCursor = Math.min(choices.length - 1, choiceCursor + 1);
				else if (key === "\r") return await choosePane();
				return await render();
			}

			// list mode
			if (key === "q" || key === "\x1b") return finish(0);
			if (key === "\x1b[A" || key === "k") cursor = Math.max(0, cursor - 1);
			else if (key === "\x1b[B" || key === "j") cursor = Math.min(items.length - 1, cursor + 1);
			else if (key === " ") {
				marked.has(cursor) ? marked.delete(cursor) : marked.add(cursor);
				cursor = Math.min(items.length - 1, cursor + 1);
			} else if (key === "a") {
				if (marked.size === items.length) marked.clear();
				else items.forEach((_, i) => marked.add(i));
			} else if (key === "r") {
				await clearRunner(source);
				runner = null;
				runnerPeek = [];
				return await openPanePicker();
			} else if (key === "\r") return await send("type");
			else if (key === "p") return await send("paste");
			else if (key === "y") return await copy();
			else if (key === "o") return await report();
			else if (key === "v") { mode = "preview"; previewOffset = 0; }
			await render();
		} catch (error) {
			message = error.message;
			try { await render(); } catch { finish(1); }
		} finally {
			busy = false;
		}
	});
}
