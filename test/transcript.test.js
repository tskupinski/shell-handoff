import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractItems, itemsFromText } from "../src/transcript.js";

const texts = (items) => items.map((i) => i.text);
const kinds = (items) => items.map((i) => i.kind);

test("! lines become commands, inside or outside fences, stripped of the prefix", () => {
	const { primary, blocks } = itemsFromText("Do this:\n\n```bash\n! tmux -V\n  ! bin/tunnel start\n```\n\nor `! echo hi` inline (not a line) and not this: important!");
	assert.deepEqual(texts(primary), ["tmux -V", "bin/tunnel start"]);
	assert.deepEqual(kinds(primary), ["command", "command"]);
	assert.deepEqual(blocks, []);
});

test("a run-tagged block is one snippet, kept whole", () => {
	const { primary, blocks } = itemsFromText("```bash run\ncd ~/x\nexport FOO=1\n./script.sh\n```");
	assert.equal(primary.length, 1);
	assert.equal(primary[0].kind, "snippet");
	assert.equal(primary[0].text, "cd ~/x\nexport FOO=1\n./script.sh");
	assert.equal(primary[0].lang, "bash");
	assert.deepEqual(blocks, []);
});

test("`run` alone as the info string works too, and ! prefixes inside are stripped", () => {
	const { primary } = itemsFromText("```run\n! a\n! b\n```");
	assert.equal(primary[0].kind, "snippet");
	assert.equal(primary[0].text, "a\nb");
});

test("an untagged block with no ! lines is a lower-tier block with its language", () => {
	const { primary, blocks } = itemsFromText("Config:\n\n```yaml\nkey: value\nlist:\n  - a\n```\n\nand output:\n\n```\n$ ls\nfoo\n```");
	assert.deepEqual(primary, []);
	assert.deepEqual(blocks.map((b) => [b.kind, b.lang]), [["block", "yaml"], ["block", ""]]);
	assert.equal(blocks[0].text, "key: value\nlist:\n  - a");
});

test("a block consumed by ! lines is not also a block; blank edges are trimmed", () => {
	const { primary, blocks } = itemsFromText("```sh\n\n# comment\n! cmd\n\n```");
	assert.deepEqual(texts(primary), ["cmd"]);
	assert.deepEqual(blocks, []);
});

test("a fenced block nested in a list is dedented; tildes and longer fences close correctly", () => {
	const { blocks } = itemsFromText("1. step\n\n   ~~~json\n   {\n     \"a\": 1\n   }\n   ~~~\n\n````md\n```\ninner\n```\n````");
	assert.equal(blocks[0].text, '{\n  "a": 1\n}');
	assert.equal(blocks[1].text, "```\ninner\n```");
});

test("an unclosed fence runs to the end of the text", () => {
	const { blocks } = itemsFromText("```py\nprint(1)\nprint(2)");
	assert.equal(blocks[0].text, "print(1)\nprint(2)");
});

test("extractItems: turn order, denied Bash from the transcript, final message from the hook, dedupe, tiers", async () => {
	const dir = await mkdtemp(join(tmpdir(), "cr-"));
	const path = join(dir, "t.jsonl");
	const entries = [
		{ type: "user", message: { role: "user", content: "old prompt" } },
		{ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "```\n! echo OLD\n```" }] } },
		{ type: "user", message: { role: "user", content: [{ type: "text", text: "new prompt" }] } },
		{ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "gcloud auth login" } }] } },
		{ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", is_error: true, content: "Permission to use Bash has been denied" }] } },
		{ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id: "t2", name: "Bash", input: { command: "ls" } }] } },
		{ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t2", is_error: false, content: "a" }] } },
		{ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "Here is the config:\n\n```toml\nx = 1\n```" }] } },
		{ type: "assistant", isSidechain: true, message: { role: "assistant", content: [{ type: "text", text: "! from a sidechain" }] } },
	];
	await writeFile(path, `${entries.map((e) => JSON.stringify(e)).join("\n")}\n`);

	const items = await extractItems({
		transcript_path: path,
		last_assistant_message: "Run these:\n\n```bash\n! gcloud auth login\n! tmux -V\n```\n\n```bash run\nset -e\nmake\n```\n\n```json\n{}\n```",
	});
	assert.deepEqual(texts(items), ["gcloud auth login", "tmux -V", "set -e\nmake", "x = 1", "{}"]);
	assert.deepEqual(kinds(items), ["denied", "command", "snippet", "block", "block"]);
});

test("extractItems copes with an object-shaped or missing last message and a missing transcript", async () => {
	assert.deepEqual(texts(await extractItems({ last_assistant_message: { content: [{ type: "text", text: "! echo obj" }] } })), ["echo obj"]);
	assert.deepEqual(await extractItems({ transcript_path: "/nonexistent" }), []);
	assert.deepEqual(await extractItems({}), []);
});
