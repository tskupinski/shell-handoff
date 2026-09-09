// The items captured for a pane live in one small JSON file per pane, under
// the cache dir. The capture hook writes it whole on every reply; the picker
// reads it. Keyed by tmux pane id (the "%" stripped so it is a legal filename).
// Next to them, runs/ holds the last send into each runner pane.

import { createHash, randomUUID } from "node:crypto";
import { tmuxTerminal } from "./terminals/tmux.js";
import { mkdir, readdir, readFile, writeFile, rename, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const STORE_DIR = process.env.XDG_CACHE_HOME
	? join(process.env.XDG_CACHE_HOME, "shell-handoff")
	: join(homedir(), ".cache", "shell-handoff");

// The backend owns target identifiers and output markers. The assistant scope
// prevents two integrations in the same terminal from sharing captures/runs.
export function createStore(terminal, { assistantId = "claude-code", directory = STORE_DIR } = {}) {
	async function scopedDir() {
		const identity = await terminal.storage.scope();
		const scope = assistantId === "claude-code" && terminal.id === "tmux"
			? identity : JSON.stringify([terminal.id, assistantId, identity]);
		return join(directory, createHash("sha256").update(scope).digest("hex"));
	}
	function paneName(pane) {
		const key = terminal.storage.key(pane);
		if (!/^[a-zA-Z0-9_-]+$/.test(key)) throw new Error("Invalid storage key");
		return `${key}.json`;
	}
	const fileFor = async (pane) => join(await scopedDir(), paneName(pane));

	async function writeJson(file, value) {
		await mkdir(dirname(file), { recursive: true, mode: 0o700 });
		const tmp = `${file}.tmp.${randomUUID()}`;
		await writeFile(tmp, JSON.stringify(value), { mode: 0o600 });
		await rename(tmp, file);
	}

	const writeItems = async (pane, items) => writeJson(await fileFor(pane), items);

	// The last send into a runner pane, so its output can be brought back to
	// Claude: where the pane's scrollback stood (see tmux.js outputMark), what was
	// sent, and from which pane. One file per runner pane.
	const runFileFor = async (runner) => join(await scopedDir(), "runs", paneName(runner));

	const writeRun = async (runner, run) => writeJson(await runFileFor(runner), run);

	async function readRun(runner) {
		try {
			const run = JSON.parse(await readFile(await runFileFor(runner), "utf8"));
			const valid = run && (run.mark === null || terminal.storage.validMark(run.mark)) && typeof run.source === "string" && Array.isArray(run.commands) && run.commands.every((c) => typeof c === "string");
			if (!valid) return null;
			paneName(run.source);
			return run;
		} catch {
			return null;
		}
	}

	// Files written before items had a shape hold plain strings: those were all
	// commands.
	function normalize(entry) {
		if (typeof entry === "string") return entry ? { kind: "command", text: entry } : null;
		if (entry && typeof entry.text === "string" && entry.text) {
			return { kind: entry.kind || "command", text: entry.text, lang: entry.lang || "" };
		}
		return null;
	}

	async function readItems(pane) {
		try {
			const parsed = JSON.parse(await readFile(await fileFor(pane), "utf8"));
			return Array.isArray(parsed) ? parsed.map(normalize).filter(Boolean) : [];
		} catch {
			return [];
		}
	}

	// Empty captures still identify the assistant that most recently replied.
	async function capturedAt(pane) {
		try {
			return (await stat(await fileFor(pane))).mtimeMs;
		} catch {
			return null;
		}
	}

	// Every pane that has captured items, as { pane, items }. Used when the pane
	// the popup opened on has nothing, so it can point at the panes that do.
	async function listCaptures() {
		let files;
		try {
			files = await readdir(await scopedDir());
		} catch {
			return [];
		}
		const out = [];
		for (const f of files) {
			if (!/^[a-zA-Z0-9_-]+\.json$/.test(f)) continue;
			const pane = terminal.storage.target(f.slice(0, -5));
			if (pane === null) continue;
			const items = await readItems(pane);
			if (items.length > 0) out.push({ pane, items });
		}
		return out;
	}

	return { writeItems, readItems, writeRun, readRun, listCaptures, capturedAt };
}

// Existing callers retain the default Claude Code/tmux store.
export const { writeItems, readItems, writeRun, readRun, listCaptures } = createStore(tmuxTerminal);
