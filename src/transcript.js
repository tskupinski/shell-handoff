// Pulls the things worth sending to a pane out of the turn that just ended.
// Every one is an item: { kind, text, lang }. Four kinds, two tiers:
//
//   command  a "! " line in Claude's text - Claude Code's own convention for
//            "run this yourself". One item per line.
//   snippet  a fenced block tagged `run` (```bash run) - the whole block is
//            one item, to be sent as a unit.
//   denied   a Bash tool call the sandbox, the classifier or I rejected - the
//            exact command Claude tried.
//   block    every other fenced block in the reply, any language. The lower
//            tier: not something Claude asked me to run, but there if I want
//            it (a config into an editor pane, say).
//
// The closing message is read from the hook's last_assistant_message, not the
// transcript: Claude Code writes the transcript asynchronously, so at Stop the
// file usually still lacks the final message. Earlier turn content (denied
// tool calls, intermediate text) is read from the transcript tail.

import { open } from "node:fs/promises";

const TAIL_BYTES = 512 * 1024;
const BANG = /^\s*`?!\s+(.+?)`?\s*$/;
const FENCE_OPEN = /^(\s*)(`{3,}|~{3,})\s*(.*)$/;
const FENCE_CLOSE = /^\s*(`{3,}|~{3,})\s*$/;
const DENIED = /denied|doesn.t want to proceed|rejected/i;
const RUN_TAGS = new Set(["run", "runner"]);

export const PRIMARY_KINDS = new Set(["command", "snippet", "denied"]);

function bang(line) {
	const m = line.match(BANG);
	return m ? m[1] : null;
}

function parseInfo(info) {
	const words = info.trim().split(/\s+/).filter(Boolean).map((w) => w.toLowerCase());
	return { lang: words[0] ?? "", tags: words.slice(1) };
}

function closes(line, fence) {
	const m = line.match(FENCE_CLOSE);
	return Boolean(m) && m[1][0] === fence[0] && m[1].length >= fence.length;
}

// A block nested in a list is indented as a whole; the indent is not content.
function dedent(lines, indent) {
	if (!indent) return lines;
	return lines.map((l) => (l.startsWith(indent) ? l.slice(indent.length) : l.replace(/^\s+/, "")));
}

function trimBlank(lines) {
	let a = 0;
	let b = lines.length;
	while (a < b && !lines[a].trim()) a++;
	while (b > a && !lines[b - 1].trim()) b--;
	return lines.slice(a, b);
}

/**
 * Items in one piece of assistant text. `primary` holds commands and snippets
 * in reading order; `blocks` the other fenced blocks. A block containing "! "
 * lines is consumed by them and does not also appear as a block.
 */
export function itemsFromText(text) {
	const primary = [];
	const blocks = [];
	if (!text) return { primary, blocks };
	const lines = String(text).split("\n");
	let i = 0;
	while (i < lines.length) {
		const open = lines[i].match(FENCE_OPEN);
		if (!open) {
			const cmd = bang(lines[i]);
			if (cmd) primary.push({ kind: "command", text: cmd });
			i++;
			continue;
		}
		const [, indent, fence, info] = open;
		const { lang, tags } = parseInfo(info);
		const body = [];
		i++;
		while (i < lines.length && !closes(lines[i], fence)) body.push(lines[i++]);
		i++; // the closing fence, or one past the end

		const run = RUN_TAGS.has(lang) || tags.some((t) => RUN_TAGS.has(t));
		const content = dedent(body, indent);
		if (run) {
			const text = trimBlank(content.map((l) => bang(l) ?? l)).join("\n");
			if (text) primary.push({ kind: "snippet", text, lang: RUN_TAGS.has(lang) ? "" : lang });
			continue;
		}
		const cmds = content.map(bang).filter(Boolean);
		if (cmds.length > 0) {
			for (const c of cmds) primary.push({ kind: "command", text: c });
			continue;
		}
		const text = trimBlank(content).join("\n");
		if (text) blocks.push({ kind: "block", text, lang });
	}
	return { primary, blocks };
}

function textOf(message) {
	const content = message?.content;
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content.filter((b) => b.type === "text").map((b) => b.text ?? "").join("\n");
}

// last_assistant_message may be a plain string, a message object with a content
// array, or something nested; collect every text span from whatever it is.
export function finalMessageText(last) {
	if (!last) return "";
	if (typeof last === "string") return last;
	if (Array.isArray(last.content)) return textOf(last);
	const texts = [];
	const walk = (v) => {
		if (Array.isArray(v)) v.forEach(walk);
		else if (v && typeof v === "object") {
			if (typeof v.text === "string") texts.push(v.text);
			for (const k of Object.keys(v)) walk(v[k]);
		}
	};
	walk(last);
	return texts.join("\n");
}

async function readTail(path, bytes = TAIL_BYTES) {
	let fh;
	try {
		fh = await open(path, "r");
	} catch {
		return [];
	}
	try {
		const { size } = await fh.stat();
		const start = Math.max(0, size - bytes);
		const buf = Buffer.alloc(size - start);
		if (buf.length > 0) await fh.read(buf, 0, buf.length, start);
		const lines = buf.toString("utf8").split("\n");
		if (start > 0) lines.shift(); // a tail read lands mid-line
		const entries = [];
		for (const line of lines) {
			if (!line.trim()) continue;
			try {
				const entry = JSON.parse(line);
				if (!entry.isSidechain) entries.push(entry);
			} catch {
				// half-written line - ignore
			}
		}
		return entries;
	} finally {
		await fh.close();
	}
}

// A real prompt starts a turn; a tool_result carried in a user entry does not.
function isPrompt(entry) {
	if (entry.type !== "user") return false;
	const content = entry.message?.content;
	if (typeof content === "string") return true;
	if (!Array.isArray(content)) return false;
	return content.every((b) => b.type !== "tool_result");
}

function resultText(block) {
	const c = block.content;
	if (Array.isArray(c)) return c.map((b) => b.text ?? "").join(" ");
	return typeof c === "string" ? c : JSON.stringify(c ?? "");
}

function turnItems(entries) {
	let start = 0;
	for (let i = entries.length - 1; i >= 0; i--) {
		if (isPrompt(entries[i])) {
			start = i;
			break;
		}
	}
	const turn = entries.slice(start);

	const bash = {};
	for (const e of turn) {
		if (e.type !== "assistant") continue;
		for (const b of e.message?.content ?? []) {
			if (b.type === "tool_use" && b.name === "Bash") bash[b.id] = b.input?.command;
		}
	}

	const primary = [];
	const blocks = [];
	for (const e of turn) {
		if (e.type === "assistant") {
			const found = itemsFromText(textOf(e.message));
			primary.push(...found.primary);
			blocks.push(...found.blocks);
		} else if (e.type === "user" && Array.isArray(e.message?.content)) {
			for (const b of e.message.content) {
				if (b.type === "tool_result" && b.is_error && DENIED.test(resultText(b))) {
					const text = bash[b.tool_use_id];
					if (text) primary.push({ kind: "denied", text });
				}
			}
		}
	}
	return { primary, blocks };
}

function dedupe(items) {
	const seen = new Set();
	return items.filter((it) => {
		if (seen.has(it.text)) return false;
		seen.add(it.text);
		return true;
	});
}

/** All items of the finished turn: the primary tier first, then the other blocks. */
export async function extractItems({ transcript_path, last_assistant_message } = {}) {
	const turn = transcript_path ? turnItems(await readTail(transcript_path)) : { primary: [], blocks: [] };
	const last = itemsFromText(finalMessageText(last_assistant_message));
	return dedupe([...turn.primary, ...last.primary, ...turn.blocks, ...last.blocks]);
}
