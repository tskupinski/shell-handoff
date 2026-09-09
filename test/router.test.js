import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPickerRouter } from "../src/runtime.js";
import { createStore } from "../src/store.js";

test("picker routes each pane to its latest assistant, including empty captures", async (t) => {
	const directory = await mkdtemp(join(tmpdir(), "handoff-router-"));
	t.after(() => rm(directory, { recursive: true, force: true }));
	let scope = "one";
	const terminal = { id: "test", storage: {
		scope: async () => scope, key: (pane) => pane, target: (key) => key,
		validMark: () => true,
	} };
	const router = createPickerRouter({ terminal, directory });
	const claude = createStore(terminal, { directory, assistantId: "claude-code" });
	const codex = createStore(terminal, { directory, assistantId: "codex" });
	const items = [{ kind: "command", text: "echo hello" }];
	assert.equal((await router.forSource("new")).assistant.id, "claude-code");
	await claude.writeItems("a", items);
	await codex.writeItems("b", items);
	assert.equal((await router.forSource("a")).assistant.id, "claude-code");
	assert.equal((await router.forSource("b")).assistant.id, "codex");
	assert.deepEqual((await router.listCaptures()).map((c) => [c.pane, c.assistant.id]).sort(), [["a", "claude-code"], ["b", "codex"]]);
	await new Promise((resolve) => setTimeout(resolve, 20));
	await codex.writeItems("a", []);
	assert.equal((await router.forSource("a")).assistant.id, "codex");
	assert.deepEqual((await router.listCaptures()).map((c) => c.pane), ["b"]);
	await new Promise((resolve) => setTimeout(resolve, 20));
	await claude.writeItems("a", items);
	assert.equal((await router.forSource("a")).assistant.id, "claude-code");
	scope = "another-server";
	assert.deepEqual(await router.listCaptures(), []);
	assert.equal((await router.forSource("b")).assistant.id, "claude-code");
});
