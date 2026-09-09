import { homedir } from "node:os";
import { join } from "node:path";
import { itemsFromText } from "../transcript.js";

export const codex = {
	id: "codex",
	label: "Codex",
	captureHint: 'a "! " line or a code block',
	acceptsEvent: (event) => event?.type === "agent-turn-complete",
	extractItems(event) {
		if (event?.type !== "agent-turn-complete") return [];
		const text = event["last-assistant-message"];
		const { primary, blocks } = itemsFromText(typeof text === "string" ? text : "");
		const seen = new Set();
		return [...primary, ...blocks].filter((item) => {
			if (seen.has(item.text)) return false;
			seen.add(item.text);
			return true;
		});
	},
	async returnReport({ terminal, source, text }) {
		if (!terminal.capabilities.paste) {
			const where = await terminal.copyText(text);
			return `copied output to ${where || "the terminal buffer"}; paste it into Codex`;
		}
		await terminal.pasteText(source, text);
		return "pasted output into Codex - Enter to send";
	},
	async checkSetup() {
		const path = join(process.env.CODEX_HOME || join(homedir(), ".codex"), "config.toml");
		return {
			status: "info",
			message: `Codex: set top-level notify = ["shell-handoff", "capture", "--assistant", "codex"] in ${path}; use "shell-handoff pick" in your tmux binding. Effective Codex configuration is not checked.`,
		};
	},
};
