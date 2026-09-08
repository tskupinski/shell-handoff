// The items captured for a pane live in one small JSON file per pane, under
// the cache dir. The capture hook writes it whole on every reply; the picker
// reads it. Keyed by tmux pane id (the "%" stripped so it is a legal filename).
// Next to them, runs/ holds the last send into each runner pane.

import { createHash, randomUUID } from "node:crypto";
import { tmux } from "./tmux.js";
import { mkdir, readdir, readFile, writeFile, rename } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const STORE_DIR = process.env.XDG_CACHE_HOME
	? join(process.env.XDG_CACHE_HOME, "shell-handoff")
	: join(homedir(), ".cache", "shell-handoff");

// Socket, server PID, and server start time isolate independent tmux lifetimes.
async function scopedDir() {
	const identity = await tmux(["display-message", "-p", "#{socket_path}:#{pid}:#{start_time}"]);
	return join(STORE_DIR, createHash("sha256").update(identity).digest("hex"));
}
function paneName(pane) {
	if (!/^%\d+$/.test(pane)) throw new Error("Invalid tmux pane ID");
	return `${pane.slice(1)}.json`;
}
const fileFor = async (pane) => join(await scopedDir(), paneName(pane));

async function writeJson(file, value) {
	await mkdir(dirname(file), { recursive: true, mode: 0o700 });
	const tmp = `${file}.tmp.${randomUUID()}`;
	await writeFile(tmp, JSON.stringify(value), { mode: 0o600 });
	await rename(tmp, file);
}

export const writeItems = async (pane, items) => writeJson(await fileFor(pane), items);

// The last send into a runner pane, so its output can be brought back to
// Claude: where the pane's scrollback stood (see tmux.js outputMark), what was
// sent, and from which pane. One file per runner pane.
const runFileFor = async (runner) => join(await scopedDir(), "runs", paneName(runner));

export const writeRun = async (runner, run) => writeJson(await runFileFor(runner), run);

export async function readRun(runner) {
	try {
		const run = JSON.parse(await readFile(await runFileFor(runner), "utf8"));
		const valid = Number.isInteger(run?.mark?.line) && typeof run.mark.prefix === "string" && /^%\d+$/.test(run.source) && Array.isArray(run.commands) && run.commands.every((c) => typeof c === "string");
		return valid ? run : null;
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

export async function readItems(pane) {
	try {
		const parsed = JSON.parse(await readFile(await fileFor(pane), "utf8"));
		return Array.isArray(parsed) ? parsed.map(normalize).filter(Boolean) : [];
	} catch {
		return [];
	}
}

// Every pane that has captured items, as { pane, items }. Used when the pane
// the popup opened on has nothing, so it can point at the panes that do.
export async function listCaptures() {
	let files;
	try {
		files = await readdir(await scopedDir());
	} catch {
		return [];
	}
	const out = [];
	for (const f of files) {
		if (!/^\d+\.json$/.test(f)) continue;
		const pane = `%${f.slice(0, -5)}`;
		const items = await readItems(pane);
		if (items.length > 0) out.push({ pane, items });
	}
	return out;
}
