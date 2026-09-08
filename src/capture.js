// The Claude Code Stop hook. Reads the hook event JSON on stdin, extracts the
// items from the finished turn, and stashes them for the pane the session
// runs in. Outside tmux there is nowhere to send anything, so it is a no-op.
// It always exits 0: a hook that fails must never disrupt the session.

import { extractItems } from "./transcript.js";
import { writeItems } from "./store.js";

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

export async function capture() {
	const pane = process.env.TMUX_PANE;
	if (!pane) return;
	let event = {};
	try {
		event = JSON.parse(await readStdin());
		await writeItems(pane, await extractItems(event));
	} catch {
		return;
	}
}
