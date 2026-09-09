import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { codex } from "../src/assistants/codex.js";
import { capture } from "../src/capture.js";
import { createRuntime } from "../src/runtime.js";

const event = (text) => ({ type: "agent-turn-complete", "last-assistant-message": text });

test("Codex captures final reply items, primary first, deduplicated", () => {
	assert.deepEqual(codex.extractItems(event('```json\n{}\n```\n! echo hi\n```bash run\ncd project\nnpm test\n```\n! echo hi')), [
		{ kind: "command", text: "echo hi" },
		{ kind: "snippet", text: "cd project\nnpm test", lang: "bash" },
		{ kind: "block", text: "{}", lang: "json" },
	]);
	assert.deepEqual(codex.extractItems(event({ text: "! wrong" })), []);
	assert.deepEqual(codex.extractItems(null), []);
});

test("capture ignores unrelated notifications, clears empty turns, and swallows errors", async () => {
	const writes = [];
	const runtime = { assistant: codex, terminal: { captureTarget: async () => "%1" }, store: { writeItems: async (...args) => writes.push(args) } };
	await capture(runtime, JSON.stringify(event("! echo hi")));
	await capture(runtime, JSON.stringify({ type: "approval-requested" }));
	await capture(runtime, "{");
	assert.equal(writes.length, 1);
	await capture(runtime, JSON.stringify(event("Done.")));
	assert.deepEqual(writes[1], ["%1", []]);
	runtime.terminal.captureTarget = async () => null;
	await capture(runtime, JSON.stringify(event("! ignored")));
	assert.equal(writes.length, 2);
});

test("Codex report delivery pastes a draft or falls back to copying", async () => {
	const calls = [];
	const terminal = { capabilities: { paste: true }, pasteText: async (...args) => calls.push(args), copyText: async (text) => { calls.push([text]); return "clipboard"; } };
	assert.match(await codex.returnReport({ terminal, source: "%1", text: "report" }), /Codex - Enter to send/);
	assert.deepEqual(calls, [["%1", "report"]]);
	terminal.capabilities.paste = false;
	assert.match(await codex.returnReport({ terminal, source: "%1", text: "report" }), /clipboard/);
	assert.deepEqual(calls[1], ["report"]);
});

test("runtime selects adapters and CLI validates selection without breaking hooks", () => {
	assert.equal(createRuntime().assistant.id, "claude-code");
	assert.equal(createRuntime({ assistant: "codex" }).assistant, codex);
	assert.throws(() => createRuntime({ assistant: "unknown" }), /Unknown assistant/);
	const bad = spawnSync(process.execPath, ["src/cli.js", "doctor", "--assistant", "unknown"], { encoding: "utf8" });
	assert.equal(bad.status, 1);
	assert.match(bad.stderr, /Unknown assistant/);
	for (const args of [["--assistant", "codex", "{"], ["--assistant"], ["--assistant", "unknown"]]) {
		const result = spawnSync(process.execPath, ["src/cli.js", "capture", ...args], { encoding: "utf8", env: { ...process.env, TMUX_PANE: "" } });
		assert.equal(result.status, 0);
		assert.equal(result.stdout + result.stderr, "");
	}
});
