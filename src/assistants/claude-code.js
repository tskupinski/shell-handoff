import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { extractItems } from "../transcript.js";

// Claude Code currently accepts reports through its terminal input.
export const claudeCode = {
	id: "claude-code",
	label: "Claude Code",
	checkSetup: checkHook,
	captureHint: 'a "! " line, a code block, or a denied command',
	extractItems,
	async returnReport({ terminal, source, text }) {
		if (!terminal.capabilities.paste) {
			const where = await terminal.copyText(text);
			return `copied output to ${where || "the terminal buffer"}; paste it into Claude Code`;
		}
		await terminal.pasteText(source, text);
		return "pasted output into Claude Code - Enter to send";
	},
};

const ok = (message) => ({ status: "ok", message });
const bad = (message) => ({ status: "bad", message });
const info = (message) => ({ status: "info", message });
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

