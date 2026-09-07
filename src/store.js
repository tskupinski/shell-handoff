// The items captured for a pane live in one small JSON file per pane, under
// the cache dir. The capture hook writes it whole on every reply; the picker
// reads it. Keyed by tmux pane id (the "%" stripped so it is a legal filename).

import { mkdir, readdir, readFile, writeFile, rename } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export const STORE_DIR = process.env.XDG_CACHE_HOME
	? join(process.env.XDG_CACHE_HOME, "claude-runner")
	: join(homedir(), ".cache", "claude-runner");

const fileFor = (pane) => join(STORE_DIR, `${pane.replace(/^%/, "")}.json`);

export async function writeItems(pane, items) {
	await mkdir(STORE_DIR, { recursive: true });
	const file = fileFor(pane);
	const tmp = `${file}.tmp.${process.pid}`;
	await writeFile(tmp, JSON.stringify(items));
	await rename(tmp, file);
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
		const parsed = JSON.parse(await readFile(fileFor(pane), "utf8"));
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
		files = await readdir(STORE_DIR);
	} catch {
		return [];
	}
	const out = [];
	for (const f of files) {
		if (!f.endsWith(".json")) continue;
		const pane = `%${f.slice(0, -5)}`;
		const items = await readItems(pane);
		if (items.length > 0) out.push({ pane, items });
	}
	return out;
}
