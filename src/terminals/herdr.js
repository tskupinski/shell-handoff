import { connect } from "node:net";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, rename, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";
import { cleanOutput, isShell } from "../output.js";

const validPane = (pane) => typeof pane === "string" && /^w\d+:p\d+$/.test(pane);
const requirePane = (pane) => {
	if (!validPane(pane)) throw new Error("Invalid Herdr pane ID");
	return pane;
};

// Herdr's API is newline-delimited JSON over its local Unix socket.
export function herdrRequest(path, method, params = {}, timeout = 3000) {
	return new Promise((resolve, reject) => {
		if (!path) return reject(new Error("HERDR_SOCKET_PATH is missing; run inside Herdr"));
		const id = randomUUID();
		const socket = connect(path);
		let buffer = "";
		const finish = (error, result) => {
			socket.destroy();
			error ? reject(error) : resolve(result);
		};
		socket.setEncoding("utf8");
		socket.setTimeout(timeout, () => finish(new Error(`Herdr ${method} timed out`)));
		socket.on("error", (error) => finish(error));
		socket.on("end", () => finish(new Error(`Herdr closed the connection during ${method}`)));
		socket.on("connect", () => socket.write(JSON.stringify({ id, method, params }) + "\n"));
		socket.on("data", (chunk) => {
			buffer += chunk;
			if (buffer.length > 4 * 1024 * 1024) return finish(new Error("Herdr response is too large"));
			let end;
			while ((end = buffer.indexOf("\n")) >= 0) {
				const line = buffer.slice(0, end);
				buffer = buffer.slice(end + 1);
				try {
					const response = JSON.parse(line);
					if (response.id !== id) continue;
					if (response.error) return finish(new Error(`Herdr: ${response.error.message}`));
					if (!response.result) throw new Error("Invalid Herdr response");
					return finish(null, response.result);
				} catch (error) { return finish(error); }
			}
		});
	});
}

async function copyClipboard(text) {
	for (const [command, args] of [["pbcopy", []], ["wl-copy", []], ["xclip", ["-selection", "clipboard"]], ["xsel", ["--clipboard", "--input"]]]) {
		const copied = await new Promise((resolve) => {
			const child = spawn(command, args, { stdio: ["pipe", "ignore", "ignore"] });
			child.on("error", () => resolve(false));
			child.on("close", (code) => resolve(code === 0));
			child.stdin.on("error", () => {});
			child.stdin.end(text);
		});
		if (copied) return command;
	}
	throw new Error("No clipboard tool available; install pbcopy, wl-copy, xclip, or xsel");
}

export function outputAfter(lines, mark) {
	const matches = [];
	if (mark.anchor.length) {
		for (let i = 0; i <= lines.length - mark.anchor.length; i++) {
			if (mark.anchor.every((line, j) => line === lines[i + j])) matches.push(i + mark.anchor.length);
		}
	}
	if (matches.length === 1) return { lines: lines.slice(matches[0]), warning: "" };
	return { lines, warning: "Herdr output boundary could not be verified; showing retained recent history, which may include earlier output." };
}

export function createHerdrTerminal({ env = process.env, request, directory } = {}) {
	const api = request ?? ((method, params) => herdrRequest(env.HERDR_SOCKET_PATH, method, params));
	const paneInfo = async (pane) => (await api("pane.get", { pane_id: requirePane(pane) })).pane;
	const scope = async () => {
		if (!env.HERDR_SOCKET_PATH) throw new Error("HERDR_SOCKET_PATH is missing");
		const path = await realpath(env.HERDR_SOCKET_PATH);
		const info = await stat(path);
		return JSON.stringify([path, info.dev, info.ino, info.birthtimeMs]);
	};
	const currentPane = async () => requirePane(env.HERDR_PANE_ID || env.HERDR_ACTIVE_PANE_ID);
	const runnerFile = async (source) => {
		const pane = await paneInfo(source);
		const key = createHash("sha256").update(JSON.stringify([await scope(), pane.workspace_id, pane.tab_id])).digest("hex");
		const root = directory ?? join(env.XDG_CACHE_HOME || join(homedir(), ".cache"), "shell-handoff");
		return join(root, "herdr-runners", `${key}.json`);
	};
	const read = async (pane, source = "recent", lines = 2000) => {
		const result = (await api("pane.read", { pane_id: requirePane(pane), source, lines, format: "text", strip_ansi: true })).read;
		if (typeof result?.text !== "string") throw new Error("Invalid Herdr pane output");
		return result.text.split("\n").map((line) => line.trimEnd());
	};
	async function setRunner(source, runner) {
		if (runner !== null) requirePane(runner);
		const file = await runnerFile(source);
		await mkdir(dirname(file), { recursive: true, mode: 0o700 });
		const temp = `${file}.${randomUUID()}`;
		await writeFile(temp, JSON.stringify(runner), { mode: 0o600 });
		await rename(temp, file);
	}

	return {
		id: "herdr", label: "Herdr",
		capabilities: Object.freeze({ paste: true, output: true, preview: true, split: true }),
		captureTarget: () => validPane(env.HERDR_PANE_ID) ? env.HERDR_PANE_ID : null,
		currentPane,
		storage: {
			scope,
			key: (pane) => requirePane(pane).replace(":", "_"),
			target: (key) => /^w\d+_p\d+$/.test(key) ? key.replace("_", ":") : null,
			validMark: (mark) => typeof mark?.terminalId === "string" && Array.isArray(mark.anchor) && mark.anchor.length <= 8 && mark.anchor.every((line) => typeof line === "string"),
		},
		paneExists: async (pane) => { try { return Boolean(await paneInfo(pane)); } catch { return false; } },
		paneLabel: async (pane) => {
			const info = await paneInfo(pane);
			return `${pane} ${info.label || info.title || info.agent || info.cwd || "terminal"}`;
		},
		async siblingPanes(source) {
			const info = await paneInfo(source);
			return (await api("pane.list", { workspace_id: info.workspace_id })).panes
				.filter((pane) => pane.pane_id !== source)
				.map((pane) => ({ id: pane.pane_id, label: `${pane.pane_id} ${pane.label || pane.title || pane.cwd || "terminal"}` }));
		},
		async getRunner(source) {
			try { const pane = JSON.parse(await readFile(await runnerFile(source), "utf8")); return validPane(pane) ? pane : null; }
			catch { return null; }
		},
		setRunner,
		clearRunner: (source) => setRunner(source, null),
		async splitBelow(source) {
			const info = await paneInfo(source);
			return (await api("pane.split", { target_pane_id: source, direction: "down", cwd: info.cwd, focus: false })).pane.pane_id;
		},
		async typeText(pane, text) {
			for (const line of text.split("\n")) {
				await api("pane.send_input", { pane_id: requirePane(pane), text: line, keys: ["enter"] });
			}
		},
		// send_text writes raw bytes. send_input honors the target's bracketed
		// paste mode and only submits when keys includes Enter.
		pasteText: (pane, text) => api("pane.send_input", { pane_id: requirePane(pane), text, keys: [] }),
		copyText: copyClipboard,
		flash: async () => {},
		capturePane: (pane, lines = 3) => read(pane, "visible", lines),
		async outputMark(pane) {
			const info = await paneInfo(pane);
			const lines = await read(pane);
			while (lines.length && !lines.at(-1)) lines.pop();
			lines.pop(); // The current prompt row will change when input arrives.
			return { terminalId: info.terminal_id, anchor: lines.slice(-8) };
		},
		async readOutput(pane, mark) {
			const info = await paneInfo(pane);
			if (info.terminal_id !== mark.terminalId) throw new Error("The Herdr runner terminal was replaced; run the command again");
			const result = outputAfter(await read(pane), mark);
			const process = (await api("pane.process_info", { pane_id: pane })).process_info;
			const jobs = process.foreground_processes ?? [];
			const idle = jobs.length > 0 && jobs.every((job) => isShell(job.name));
			return { ...result, lines: cleanOutput(result.lines, { idle }), running: !idle };
		},
		async checkSetup() {
			try {
				const result = await api("ping", {});
				return { status: "ok", message: `Herdr ${result.version}: socket reachable. Configure a popup running "shell-handoff pick"; key binding is not checked.` };
			} catch (error) { return { status: "bad", message: error.message }; }
		},
	};
}
