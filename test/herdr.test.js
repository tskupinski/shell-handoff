import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:net";
import { mkdtemp, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createHerdrTerminal, herdrRequest, outputAfter } from "../src/terminals/herdr.js";
import { selectTerminal, createRuntime, createPickerRouter } from "../src/runtime.js";
import { capture } from "../src/capture.js";
import { createStore } from "../src/store.js";
import { sendItems, returnOutput } from "../src/handoff.js";

test("Herdr routes hook and popup identities, including nested tmux", async () => {
	const env = { HERDR_SOCKET_PATH: "/tmp/herdr.sock", HERDR_PANE_ID: "w2:p3", TMUX_PANE: "%1" };
	assert.equal(selectTerminal("auto", env).id, "herdr");
	assert.equal(selectTerminal("tmux", env).id, "tmux");
	assert.equal(selectTerminal("auto", {}).id, "tmux");
	assert.throws(() => selectTerminal("unknown"), /Unknown terminal/);
	const terminal = createHerdrTerminal({ env });
	assert.equal(await terminal.currentPane(), "w2:p3");
	assert.equal(terminal.captureTarget(), "w2:p3");
	delete env.HERDR_PANE_ID;
	env.HERDR_ACTIVE_PANE_ID = "w2:p4";
	assert.equal(await terminal.currentPane(), "w2:p4");
	assert.equal(terminal.captureTarget(), null);
	assert.equal(terminal.storage.target(terminal.storage.key("w2:p4")), "w2:p4");
	assert.throws(() => terminal.storage.key("../../bad"), /Invalid/);
});

test("Herdr sends paste without Enter, runs lines with Enter, and detects replaced runners", async () => {
	const calls = [];
	const terminal = createHerdrTerminal({ request: async (method, params) => {
		calls.push({ method, params });
		return { pane: { terminal_id: "replacement" } };
	} });
	await terminal.pasteText("w1:p1", "cd project\nnpm test");
	assert.deepEqual(calls[0], { method: "pane.send_input", params: { pane_id: "w1:p1", text: "cd project\nnpm test", keys: [] } });
	await terminal.typeText("w1:p1", "cd project\nnpm test");
	assert.deepEqual(calls.slice(1).map((c) => c.params.keys), [["enter"], ["enter"]]);
	await assert.rejects(terminal.readOutput("w1:p1", { terminalId: "old", anchor: [] }), /replaced/);
});

test("Herdr output boundary requires a unique retained match", () => {
	assert.deepEqual(outputAfter(["old", "anchor", "new"], { anchor: ["old", "anchor"] }), { lines: ["new"], warning: "" });
	for (const [lines, anchor] of [[["new"], ["missing"]], [["a", "a"], ["a"]], [["new"], []]]) {
		const result = outputAfter(lines, { anchor });
		assert.equal(result.lines, lines);
		assert.match(result.warning, /could not be verified/);
	}
});

test("Herdr socket transport handles fragmented JSON and API errors", async (t) => {
	const directory = await mkdtemp(join(tmpdir(), "shh-api-"));
	const path = join(directory, "s");
	const server = createServer((socket) => {
		let input = "";
		socket.on("data", (chunk) => {
			input += chunk;
			if (!input.includes("\n")) return;
			const request = JSON.parse(input);
			const reply = request.method === "ping" ? { id: request.id, result: { type: "pong", version: "0.9.0" } } : { id: request.id, error: { code: "not_found", message: "pane missing" } };
			const text = JSON.stringify(reply) + "\n";
			socket.write(text.slice(0, 10));
			socket.end(text.slice(10));
		});
	});
	await new Promise((resolve, reject) => { server.once("error", reject); server.listen(path, resolve); });
	t.after(async () => { await new Promise((resolve) => server.close(resolve)); await rm(directory, { recursive: true, force: true }); });
	assert.equal((await herdrRequest(path, "ping")).version, "0.9.0");
	await assert.rejects(herdrRequest(path, "pane.get"), /pane missing/);
});

test("real Herdr: capture, runner persistence, paste, execution, output and pane loss", { skip: !process.env.HERDR_TEST_SOCKET }, async (t) => {
	const directory = await mkdtemp(join(tmpdir(), "shh-real-"));
	const api = (method, params) => herdrRequest(process.env.HERDR_TEST_SOCKET, method, params);
	const workspace = await api("workspace.create", { cwd: directory, label: "shell-handoff test" });
	const source = workspace.root_pane.pane_id;
	t.after(async () => {
		await api("workspace.close", { workspace_id: workspace.workspace.workspace_id });
		await rm(directory, { recursive: true, force: true });
	});
	const env = { HERDR_SOCKET_PATH: process.env.HERDR_TEST_SOCKET, HERDR_PANE_ID: source };
	const terminal = createHerdrTerminal({ env, directory });
	const storeDirectory = join(directory, "shell-handoff");
	const store = createStore(terminal, { assistantId: "codex", directory: storeDirectory });
	const runtime = createRuntime({ assistant: "codex", terminal, store });
	await capture(runtime, JSON.stringify({ type: "agent-turn-complete", "last-assistant-message": "```bash run\nprintf 'hello\\n'\n```" }));
	assert.equal((await store.readItems(source))[0].kind, "snippet");
	assert.equal((await createPickerRouter({ terminal, directory: storeDirectory }).forSource(source)).assistant.id, "codex");
	const runner = await terminal.splitBelow(source);
	assert.ok((await terminal.siblingPanes(source)).some((pane) => pane.id === runner));
	const { setRunner, getRunner, clearRunner } = terminal;
	await setRunner(source, runner);
	assert.equal(await getRunner(source), runner);
	await clearRunner(source);
	assert.equal(await getRunner(source), null);
	await setRunner(source, runner);
	const waitFor = async (check) => {
		for (let i = 0; i < 100; i++) { if (await check()) return; await new Promise((resolve) => setTimeout(resolve, 30)); }
		assert.fail("Timed out waiting for Herdr pane");
	};
	await terminal.typeText(runner, "printf 'BASELINE_A\\nBASELINE_B\\n'");
	await waitFor(async () => (await terminal.capturePane(runner, 50)).includes("BASELINE_B"));
	const marker = join(directory, "executed");
	await sendItems(runtime, { source, runner, how: "paste", items: [{ text: `touch '${marker}'` }] });
	await new Promise((resolve) => setTimeout(resolve, 100));
	await assert.rejects(access(marker));
	await api("pane.send_keys", { pane_id: runner, keys: ["enter"] });
	await waitFor(async () => access(marker).then(() => true, () => false));
	await sendItems(runtime, { source, runner, how: "type", items: [{ text: "printf 'HERDR_RESULT\\n'" }] });
	await waitFor(async () => (await terminal.capturePane(runner, 50)).includes("HERDR_RESULT"));
	const output = await terminal.readOutput(runner, (await store.readRun(runner)).mark);
	assert.ok(output.lines.some((line) => line.includes("HERDR_RESULT")));
	// Verify shared delivery with real output, keeping the report out of the test shell.
	let report;
	await returnOutput({ ...runtime, assistant: { ...runtime.assistant, returnReport: async (value) => { report = value; } } }, { source, runner });
	assert.equal(report.source, source);
	assert.match(report.text, /HERDR_RESULT/);
	const picker = await terminal.splitBelow(source);
	const quote = (text) => "'" + text.replaceAll("'", "'\"'\"'") + "'";
	await terminal.typeText(picker, `XDG_CACHE_HOME=${quote(directory)} ${quote(process.execPath)} ${quote(resolve("src/cli.js"))} pick ${source}`);
	await waitFor(async () => (await terminal.capturePane(picker, 50)).some((line) => line.includes("Codex") && line.includes("to run")));
	await api("pane.send_keys", { pane_id: picker, keys: ["q"] });
	await api("pane.close", { pane_id: picker });
	await api("pane.close", { pane_id: runner });
	assert.equal(await terminal.paneExists(runner), false);
	await assert.rejects(terminal.pasteText(runner, "gone"));
});
