// Capture a completed reply. Reads event JSON from stdin or a supplied argument, extracts the
// items from the finished turn, and stashes them for the pane the session
// runs in. Outside a supported terminal there is no capture target, so it is a no-op.
// It always exits 0: a hook that fails must never disrupt the session.

import { createRuntime } from "./runtime.js";

function readStdin() {
	return new Promise((resolve) => {
		if (process.stdin.isTTY) return resolve("");
		let data = "";
		process.stdin.setEncoding("utf8");
		process.stdin.on("data", (chunk) => (data += chunk));
		process.stdin.on("end", () => resolve(data));
		process.stdin.on("error", () => resolve(data));
	});
}

export async function capture({ assistant, terminal, store } = createRuntime(), input) {
	try {
		const pane = await terminal.captureTarget();
		if (!pane) return;
		const event = JSON.parse(input ?? await readStdin());
		if (assistant.acceptsEvent && !assistant.acceptsEvent(event)) return;
		await store.writeItems(pane, await assistant.extractItems(event));
	} catch {
		return;
	}
}
