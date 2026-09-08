// Every tmux call the tool makes, plus the clipboard. Self-contained: no
// dependency on Towerman.

import { execFile, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";

const TMUX = ["/opt/homebrew/bin/tmux", "/usr/local/bin/tmux", "/usr/bin/tmux"].find(existsSync) ?? "tmux";

// A bare environment makes tmux print tabs in formats as "_", which breaks
// every field-splitting caller here; give it a locale if none is set.
const ENV =
	process.env.LANG || process.env.LC_ALL || process.env.LC_CTYPE
		? process.env
		: { ...process.env, LC_CTYPE: "UTF-8" };

export function tmux(args) {
	return new Promise((resolve, reject) => {
		execFile(TMUX, args, { timeout: 3000, maxBuffer: 16 * 1024 * 1024, env: ENV }, (err, stdout) => {
			if (err) reject(err);
			else resolve(stdout.replace(/\n+$/, ""));
		});
	});
}

// Run a command with `input` on its stdin; resolves when it exits cleanly.
function pipeTo(cmd, args, input) {
	return new Promise((resolve, reject) => {
		const child = spawn(cmd, args, { env: ENV, stdio: ["pipe", "ignore", "ignore"], timeout: 3000 });
		child.on("error", reject);
		child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`))));
		child.stdin.on("error", reject);
		child.stdin.end(input);
	});
}

export const currentPane = () => tmux(["display-message", "-p", "#{pane_id}"]);

export async function paneExists(pane) {
	const out = await tmux(["list-panes", "-a", "-F", "#{pane_id}"]).catch(() => "");
	return out.split("\n").includes(pane);
}

export const paneLabel = (pane) =>
	tmux(["display-message", "-p", "-t", pane, "#{window_index}:#{window_name}.#{pane_index}  #{pane_current_command}  #{b:pane_current_path}"]).catch(() => pane);

// Every other pane in the session, the current window first (so the obvious
// target is at the top), each as { id, label }.
export async function siblingPanes(src) {
	const win = await tmux(["display-message", "-p", "-t", src, "#{window_id}"]).catch(() => "");
	const fmt = "#{window_id}\t#{pane_id}\t#{window_index}:#{window_name}.#{pane_index}  #{pane_current_command}  #{b:pane_current_path}";
	const out = await tmux(["list-panes", "-s", "-t", src, "-F", fmt]).catch(() => "");
	const rows = out
		.split("\n")
		.filter(Boolean)
		.map((l) => {
			const [w, id, label] = l.split("\t");
			return { w, id, label };
		})
		.filter((p) => p.id !== src);
	const here = rows.filter((p) => p.w === win);
	const elsewhere = rows.filter((p) => p.w !== win);
	return [...here, ...elsewhere].map(({ id, label }) => ({ id, label }));
}

export async function getRunner(src) {
	const r = await tmux(["show-option", "-wqv", "-t", src, "@shell_handoff"]).catch(() => "");
	return r || null;
}
export const setRunner = (src, pane) => tmux(["set-option", "-w", "-t", src, "@shell_handoff", pane]);
export const clearRunner = (src) => tmux(["set-option", "-w", "-t", src, "-u", "@shell_handoff"]).catch(() => {});

export async function splitBelow(src) {
	const cwd = await tmux(["display-message", "-p", "-t", src, "#{pane_current_path}"]);
	return tmux(["split-window", "-t", src, "-v", "-d", "-l", "30%", "-P", "-F", "#{pane_id}", "-c", cwd]);
}

export async function capturePane(pane, lines = 6) {
	const out = await tmux(["capture-pane", "-p", "-t", pane]).catch(() => "");
	const rows = out.split("\n");
	while (rows.length > 0 && rows[rows.length - 1].trim() === "") rows.pop();
	return rows.slice(-lines);
}

const paneNumbers = async (pane, fmt) => (await tmux(["display-message", "-p", "-t", pane, fmt])).split(" ");

// Keep a fingerprint of the rows before the send. If history is evicted,
// cleared, or reflowed, refuse to treat the old offset as an exact boundary.
const digest = (rows) => createHash("sha256").update(rows.join("\n")).digest("hex");
export async function outputMark(pane) {
	const [history, cursor] = await paneNumbers(pane, "#{history_size} #{cursor_y}");
	const line = Number(history) + Number(cursor);
	const rows = (await tmux(["capture-pane", "-p", "-t", pane, "-S", "-", "-E", cursor])).split("\n");
	return { line, prefix: digest(rows.slice(0, line)) };
}

export async function captureSince(pane, mark) {
	const [history, cursor, command] = await paneNumbers(pane, "#{history_size} #{cursor_y} #{pane_current_command}");
	const rows = (await tmux(["capture-pane", "-p", "-t", pane, "-S", "-", "-E", cursor])).split("\n");
	const reliable = mark?.line > 0 && mark.line <= Number(history) + Number(cursor)
		&& digest(rows.slice(0, mark.line)) === mark.prefix;
	return {
		lines: reliable ? rows.slice(mark.line) : rows,
		command,
		warning: reliable ? "" : "Output boundary unavailable: showing retained pane history, which may include earlier commands. History may have been cleared, resized, or discarded.",
	};
}

// Type text into the pane one line at a time - each line literally, then
// Enter - so a multi-line item runs line by line the way I would type it.
export async function typeText(pane, text) {
	for (const line of text.split("\n")) {
		await tmux(["send-keys", "-t", pane, "-l", "--", line]);
		await tmux(["send-keys", "-t", pane, "Enter"]);
	}
}

// Paste text into the pane as one bracketed paste, with no Enter: the shell
// (or editor, or REPL) shows it whole and waits, so I can read or edit it
// before running.
export async function pasteText(pane, text) {
	const buffer = `shell-handoff-${randomUUID()}`;
	await pipeTo(TMUX, ["load-buffer", "-b", buffer, "-"], text);
	try {
		await tmux(["paste-buffer", "-p", "-d", "-b", buffer, "-t", pane]);
	} finally {
		await tmux(["delete-buffer", "-b", buffer]).catch(() => {});
	}
}

const CLIPBOARDS = [
	["pbcopy", []],
	["wl-copy", []],
	["xclip", ["-selection", "clipboard"]],
	["xsel", ["--clipboard", "--input"]],
];

// Copy text to a tmux paste buffer and, when one is available, the system
// clipboard. Returns the name of the clipboard tool used, or null.
export async function copyText(text) {
	await pipeTo(TMUX, ["load-buffer", "-b", "shell-handoff-copy", "-"], text);
	for (const [cmd, args] of CLIPBOARDS) {
		const ok = await pipeTo(cmd, args, text).then(() => true, () => false);
		if (ok) return cmd;
	}
	return null;
}

export const flash = (pane, message) => tmux(["display-message", "-t", pane, message]).catch(() => {});
