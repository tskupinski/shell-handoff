// The Towerman terminal palette, so the two tools look like one family. This
// file is the only place that knows about colors; nothing here depends on
// Towerman itself.

export const C = {
	bg: "#14161b",
	panel: "#272b33",
	fg: "#e6e1d7",
	muted: "#7d838d",
	accent: "#d97757", // Claude terracotta
	blue: "#7aa2e8",
	green: "#8fbf67",
	yellow: "#e8b45a",
	red: "#d4665a",
};

const rgb = (hex) => {
	const n = parseInt(hex.slice(1), 16);
	return `${(n >> 16) & 255};${(n >> 8) & 255};${n & 255}`;
};

/** ANSI truecolor styling; pass color=false for plain output. */
export function style(text, { fg, bg, bold } = {}, color = true) {
	if (!color) return text;
	let on = "";
	if (bold) on += "\x1b[1m";
	if (fg) on += `\x1b[38;2;${rgb(fg)}m`;
	if (bg) on += `\x1b[48;2;${rgb(bg)}m`;
	return on ? `${on}${text}\x1b[0m` : text;
}
