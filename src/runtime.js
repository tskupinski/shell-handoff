import { claudeCode } from "./assistants/claude-code.js";
import { codex } from "./assistants/codex.js";
import { createHerdrTerminal } from "./terminals/herdr.js";
import { tmuxTerminal } from "./terminals/tmux.js";
import { createStore } from "./store.js";

// Composition lives here, never in the picker or shared handoff operations.
export function createRuntime({ assistant = claudeCode, terminal = selectTerminal(), store } = {}) {
	if (typeof assistant === "string") {
		const id = assistant;
		assistant = [claudeCode, codex].find((adapter) => adapter.id === id);
		if (!assistant) throw new Error(`Unknown assistant "${id}"; choose claude-code or codex`);
	}
	return { assistant, terminal, store: store ?? createStore(terminal, { assistantId: assistant.id }) };
}

// Select from completed captures, including empty replies. This also works
// when the foreground process is a shell wrapper instead of the assistant.
export function createPickerRouter({ terminal = selectTerminal(), directory } = {}) {
	const runtimes = [claudeCode, codex].map((assistant) => createRuntime({
		assistant, terminal, store: createStore(terminal, { assistantId: assistant.id, directory }),
	}));
	async function forSource(pane) {
		const captures = await Promise.all(runtimes.map(async (runtime) => ({
			runtime, at: await runtime.store.capturedAt(pane),
		})));
		captures.sort((a, b) => (b.at ?? -Infinity) - (a.at ?? -Infinity));
		return captures[0].runtime;
	}
	async function listCaptures() {
		const captures = await Promise.all(runtimes.map((runtime) => runtime.store.listCaptures()));
		const panes = new Set(captures.flat().map((capture) => capture.pane));
		const result = [];
		for (const pane of panes) {
			const runtime = await forSource(pane);
			const items = await runtime.store.readItems(pane);
			if (items.length) result.push({ pane, items, assistant: runtime.assistant });
		}
		return result;
	}
	return { terminal, forSource, listCaptures };
}

export function selectTerminal(id = "auto", env = process.env) {
	if (id === "auto") id = env.HERDR_SOCKET_PATH && (env.HERDR_PANE_ID || env.HERDR_ACTIVE_PANE_ID) ? "herdr" : "tmux";
	if (id === "tmux") return tmuxTerminal;
	if (id === "herdr") return createHerdrTerminal({ env });
	throw new Error(`Unknown terminal "${id}"; choose auto, tmux, or herdr`);
}
