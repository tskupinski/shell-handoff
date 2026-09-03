// Pulls the commands Claude wants me to run out of the turn that just ended.
// Two sources, kept in turn order:
//   - lines starting with "! " in Claude's text (Claude Code's own convention
//     for "run this yourself")
//   - Bash tool calls that were denied (sandbox, auto-mode classifier, or
//     rejected by me) - the exact command it tried to run
//
// The closing message is read from the hook's last_assistant_message, not the
// transcript: Claude Code writes the transcript asynchronously, so at Stop the
// file usually still lacks the final message. Earlier turn content (denied
// tool calls, intermediate text) is read from the transcript tail.

import { open } from "node:fs/promises";

const TAIL_BYTES = 512 * 1024;
const BANG = /^\s*`?!\s+(.+?)`?\s*$/;
const DENIED = /denied|doesn.t want to proceed|rejected/i;

export function bangLines(text) {
	if (!text) return [];
	const out = [];
	for (const line of String(text).split("\n")) {
		const m = line.match(BANG);
		if (m) out.push(m[1]);
	}
	return out;
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

function turnCommands(entries) {
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

	const cmds = [];
	for (const e of turn) {
		if (e.type === "assistant") {
			cmds.push(...bangLines(textOf(e.message)));
		} else if (e.type === "user" && Array.isArray(e.message?.content)) {
			for (const b of e.message.content) {
				if (b.type === "tool_result" && b.is_error && DENIED.test(resultText(b))) {
					const cmd = bash[b.tool_use_id];
					if (cmd) cmds.push(cmd);
				}
			}
		}
	}
	return cmds;
}

export async function extractCommands({ transcript_path, last_assistant_message } = {}) {
	const fromTurn = transcript_path ? turnCommands(await readTail(transcript_path)) : [];
	const fromLast = bangLines(finalMessageText(last_assistant_message));
	const seen = new Set();
	const out = [];
	for (const c of [...fromTurn, ...fromLast]) {
		if (!seen.has(c)) {
			seen.add(c);
			out.push(c);
		}
	}
	return out;
}
