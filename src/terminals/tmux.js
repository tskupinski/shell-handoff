import * as tmux from "../tmux.js";
import { cleanOutput, isShell } from "../output.js";

export const tmuxTerminal = {
	...tmux,
	id: "tmux",
	label: "tmux",
	checkSetup: checkBinding,
	capabilities: Object.freeze({ paste: true, output: true, preview: true, split: true }),
	captureTarget: () => process.env.TMUX_PANE || null,
	// Preserve existing cache paths while moving tmux details out of storage.
	storage: {
		scope: () => tmux.tmux(["display-message", "-p", "#{socket_path}:#{pid}:#{start_time}"]),
		key(target) {
			if (!/^%\d+$/.test(target)) throw new Error("Invalid tmux pane ID");
			return target.slice(1);
		},
		target: (key) => /^\d+$/.test(key) ? `%${key}` : null,
		validMark: (mark) => Number.isInteger(mark?.line) && typeof mark.prefix === "string",
	},
	async readOutput(target, mark) {
		const { lines, command, warning } = await tmux.captureSince(target, mark);
		const idle = isShell(command);
		return { lines: cleanOutput(lines, { idle }), running: !idle, warning };
	},
};

const ok = (message) => ({ status: "ok", message });
const bad = (message) => ({ status: "bad", message });
const info = (message) => ({ status: "info", message });

async function checkBinding() {
	let keys;
	try {
		keys = await tmux.tmux(["list-keys"]);
	} catch {
		return info("tmux is not running - cannot check the key binding");
	}
	const bound = keys.split("\n").find((l) => l.includes("shell-handoff pick"));
	return bound
		? ok(`tmux binding: ${bound.trim().replace(/\s+/g, " ").slice(0, 80)}`)
		: bad('no tmux binding - add e.g. bind-key e display-popup -E "shell-handoff pick"');
}

