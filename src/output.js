// Closing the loop: what the runner pane showed after a send, shaped into a
// prompt for Claude. Pure - the tmux side (marking and capturing) is in
// tmux.js, so all of this is covered by test/.

// Past this, only the tail goes to Claude: the end is where the error is.
export const MAX_LINES = 400;

// When the pane's foreground process is a shell, the command is done. A login
// shell shows up with a leading dash ("-zsh").
const SHELLS = new Set(["sh", "bash", "zsh", "fish", "dash", "ksh", "mksh", "tcsh", "csh", "nu", "xonsh", "elvish"]);
export const isShell = (command) => SHELLS.has((command ?? "").replace(/^-/, ""));

const dropTrailingBlanks = (rows) => {
	while (rows.length > 0 && rows[rows.length - 1] === "") rows.pop();
	return rows;
};

// The captured rows, cleaned: trailing spaces tmux pads rows with, blank rows
// at the end, and the fresh prompt an idle shell printed after the command.
export function cleanOutput(lines, { idle }) {
	const out = dropTrailingBlanks(lines.map((l) => l.trimEnd()));
	if (idle) out.pop();
	return dropTrailingBlanks(out);
}

// A fence long enough that nothing inside closes it early.
function fence(text, lang = "") {
	const runs = [...text.matchAll(/`+/g)].map((m) => m[0].length + 1);
	const f = "`".repeat(Math.max(3, ...runs));
	return `${f}${lang}\n${text}\n${f}`;
}

export function formatReport({ commands, lines, running = false }) {
	const shown = lines.length > MAX_LINES ? lines.slice(-MAX_LINES) : lines;
	const cmd = commands.join("\n");
	const inline = commands.length === 1 && !/[\n`]/.test(cmd);
	const ran = inline ? `Ran \`${cmd}\` in a shell.` : `Ran in a shell:\n\n${fence(cmd, "sh")}`;

	if (shown.length === 0) return `${ran}\n\n${running ? "No output yet, still running." : "No output."}`;

	const label = running ? "Output so far (still running)" : "Output";
	const range = shown.length < lines.length ? `, last ${shown.length} of ${lines.length} lines` : "";
	return `${ran}\n\n${label}${range}:\n\n${fence(shown.join("\n"))}`;
}
