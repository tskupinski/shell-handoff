import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_LINES, cleanOutput, formatReport, isShell } from "../src/output.js";

test("shells are recognized, login shells and nushell included", () => {
	for (const s of ["zsh", "-zsh", "bash", "fish", "sh", "dash", "nu"]) assert.ok(isShell(s), s);
	for (const s of ["node", "vim", "ssh", "gcloud", "", undefined]) assert.ok(!isShell(s), String(s));
});

test("an idle shell's fresh prompt and trailing blanks are dropped, rows are trimmed", () => {
	assert.deepEqual(cleanOutput(["~ ❯ ls   ", "a  b  ", "", "~ ❯ ", ""], { idle: true }), ["~ ❯ ls", "a  b"]);
});

test("while a command runs, the last row is output and stays", () => {
	assert.deepEqual(cleanOutput(["~ ❯ make", "compiling...", ""], { idle: false }), ["~ ❯ make", "compiling..."]);
	assert.deepEqual(cleanOutput([], { idle: true }), []);
});

test("one plain command is named inline, its output fenced", () => {
	const text = formatReport({ commands: ["git status"], lines: ["On branch master", "nothing to commit"] });
	assert.equal(text, "Ran `git status` in a shell.\n\nOutput:\n\n```\nOn branch master\nnothing to commit\n```");
});

test("several commands, or a multi-line snippet, go in a sh fence", () => {
	const text = formatReport({ commands: ["cd x", "make"], lines: ["ok"] });
	assert.ok(text.startsWith("Ran in a shell:\n\n```sh\ncd x\nmake\n```\n\nOutput:"));
	const snippet = formatReport({ commands: ["a\nb"], lines: [] });
	assert.equal(snippet, "Ran in a shell:\n\n```sh\na\nb\n```\n\nNo output.");
});

test("backticks in the command or the output never close a fence early", () => {
	const text = formatReport({ commands: ["echo `x`"], lines: ["```", "inner", "```"] });
	assert.ok(text.includes("```sh\necho `x`\n```"));
	assert.ok(text.includes("````\n```\ninner\n```\n````"));
});

test("a still-running command is labeled as such", () => {
	assert.ok(formatReport({ commands: ["sleep 9"], lines: [], running: true }).endsWith("No output yet, still running."));
	assert.ok(formatReport({ commands: ["make"], lines: ["..."], running: true }).includes("Output so far (still running):"));
});

test("huge output keeps the tail and says how much was cut", () => {
	const lines = Array.from({ length: MAX_LINES + 10 }, (_, i) => `line ${i}`);
	const text = formatReport({ commands: ["x"], lines });
	assert.ok(text.includes(`Output, last ${MAX_LINES} of ${MAX_LINES + 10} lines:`));
	assert.ok(!text.includes("line 9\n"));
	assert.ok(text.includes(`line ${MAX_LINES + 9}\n`));
});
