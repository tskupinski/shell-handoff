import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sendItems, returnOutput } from "../src/handoff.js";
import { createStore } from "../src/store.js";
import { claudeCode } from "../src/assistants/claude-code.js";

function fixture(capabilities = {}) {
	let run = null;
	const calls = [];
	const terminal = {
		id: "test-terminal", label: "Test terminal",
		capabilities: { paste: true, output: true, ...capabilities },
		paneExists: async () => true,
		outputMark: async () => "opaque-cursor",
		pasteText: async (...args) => calls.push(["paste", ...args]),
		typeText: async (...args) => calls.push(["type", ...args]),
		copyText: async (text) => { calls.push(["copy", text]); return "clipboard"; },
		readOutput: async () => ({ lines: ["result"], running: false, warning: "partial output" }),
	};
	const store = { readRun: async () => run, writeRun: async (_, value) => { run = value; } };
	const assistant = { id: "test-assistant", label: "Test assistant", returnReport: async (report) => { calls.push(["report", report.source, report.text]); return "delivered"; } };
	return { terminal, assistant, store, calls };
}
const request = { source: "conversation/one", runner: "terminal:two", how: "paste", items: [{ text: "cd project" }, { text: "npm test" }] };

test("shared handoff works with non-tmux IDs, opaque marks and a different assistant", async () => {
	const runtime = fixture();
	await sendItems(runtime, request);
	assert.deepEqual(runtime.calls, [["paste", request.runner, "cd project\nnpm test"]]);
	assert.equal((await runtime.store.readRun()).mark, "opaque-cursor");
	assert.equal(await returnOutput(runtime, request), "delivered");
	assert.equal(runtime.calls[1][1], request.source);
	assert.match(runtime.calls[1][2], /partial output/);
	assert.match(runtime.calls[1][2], /result/);
});

test("unsupported paste never executes input, and no-output terminals still run commands", async () => {
	const runtime = fixture({ paste: false, output: false });
	await assert.rejects(sendItems(runtime, request), /does not support paste/);
	assert.deepEqual(runtime.calls, []);
	await sendItems(runtime, { ...request, how: "type" });
	assert.equal((await runtime.store.readRun()).mark, null);
	await assert.rejects(returnOutput(runtime, request), /cannot capture output/);
});

test("failed sends invalidate prior reports and mismatched sources never receive output", async () => {
	const runtime = fixture();
	await sendItems(runtime, request);
	await assert.rejects(returnOutput(runtime, { ...request, source: "other" }), /another Test assistant/);
	assert.equal(runtime.calls.length, 1);
	runtime.terminal.pasteText = async () => { throw new Error("target disappeared"); };
	await assert.rejects(sendItems(runtime, request), /target disappeared/);
	assert.equal(await runtime.store.readRun(), null);
});

test("Claude report delivery falls back to copy without submitting", async () => {
	const { terminal, calls } = fixture({ paste: false });
	const result = await claudeCode.returnReport({ terminal, source: "source", text: "report" });
	assert.deepEqual(calls, [["copy", "report"]]);
	assert.match(result, /clipboard/);
});

test("storage accepts backend IDs and marks and isolates assistants", async () => {
	const directory = await mkdtemp(join(tmpdir(), "handoff-store-"));
	const terminal = { id: "test-terminal", storage: {
		scope: async () => "server-lifetime",
		key: (id) => Buffer.from(id).toString("hex"),
		target: (key) => Buffer.from(key, "hex").toString(),
		validMark: (mark) => typeof mark === "string",
	} };
	const one = createStore(terminal, { directory, assistantId: "one" });
	const two = createStore(terminal, { directory, assistantId: "two" });
	await one.writeItems(request.source, request.items);
	assert.equal((await one.listCaptures())[0].pane, request.source);
	assert.equal((await one.readItems(request.source)).length, 2);
	assert.deepEqual(await two.readItems(request.source), []);
	await one.writeRun(request.runner, { source: request.source, mark: "offset", commands: ["echo hello"] });
	assert.equal((await one.readRun(request.runner)).mark, "offset");
	assert.equal(await two.readRun(request.runner), null);
});
