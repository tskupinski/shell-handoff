// The command list captured for a pane lives in one small JSON file per pane,
// under the cache dir. The capture hook writes it whole on every reply; the
// picker reads it. Keyed by tmux pane id (the "%" stripped so it is a legal
// filename).

import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export const STORE_DIR = process.env.XDG_CACHE_HOME
	? join(process.env.XDG_CACHE_HOME, "claude-runner")
	: join(homedir(), ".cache", "claude-runner");

const fileFor = (pane) => join(STORE_DIR, `${pane.replace(/^%/, "")}.json`);

export async function writeCommands(pane, commands) {
	await mkdir(STORE_DIR, { recursive: true });
	const file = fileFor(pane);
	const tmp = `${file}.tmp.${process.pid}`;
	await writeFile(tmp, JSON.stringify(commands));
	await rename(tmp, file);
}

export async function readCommands(pane) {
	try {
		const parsed = JSON.parse(await readFile(fileFor(pane), "utf8"));
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
}
