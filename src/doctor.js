// `shell-handoff doctor`: check that the two pieces of wiring are in place -
// the Stop hook in Claude Code settings, and the tmux key binding. It reports;
// it never edits anything.

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { C, style } from "./palette.js";
import { tmux } from "./tmux.js";

const ok = (m) => `${style("✓", { fg: C.green })} ${m}`;
const bad = (m) => `${style("✗", { fg: C.red })} ${m}`;
const info = (m) => `${style("·", { fg: C.muted })} ${m}`;

async function checkHook() {
	const path = join(homedir(), ".claude", "settings.json");
	let settings;
	try {
		settings = JSON.parse(await readFile(path, "utf8"));
	} catch {
		return bad(`no readable ${path} - add a Stop hook running "shell-handoff capture"`);
	}
	const stop = settings.hooks?.Stop ?? [];
	const wired = stop.some((g) => (g.hooks ?? []).some((h) => typeof h.command === "string" && h.command.includes("shell-handoff capture")));
	return wired
		? ok('Stop hook runs "shell-handoff capture"')
		: bad('no Stop hook found - add one running "shell-handoff capture" to ~/.claude/settings.json');
}

async function checkBinding() {
	let keys;
	try {
		keys = await tmux(["list-keys"]);
	} catch {
		return info("tmux is not running - cannot check the key binding");
	}
	const bound = keys.split("\n").find((l) => l.includes("shell-handoff pick"));
	return bound
		? ok(`tmux binding: ${bound.trim().replace(/\s+/g, " ").slice(0, 80)}`)
		: bad('no tmux binding - add e.g. bind-key e display-popup -E "shell-handoff pick"');
}

export async function doctor() {
	const lines = [await checkHook(), await checkBinding()];
	process.stdout.write(`${lines.join("\n")}\n`);
}
