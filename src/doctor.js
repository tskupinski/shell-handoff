import { C, style } from "./palette.js";
import { createRuntime } from "./runtime.js";

export async function doctor({ assistant, terminal } = createRuntime()) {
	const colors = { ok: C.green, bad: C.red, info: C.muted };
	const symbols = { ok: "✓", bad: "✗", info: "·" };
	for (const adapter of [assistant, terminal]) {
		const result = adapter.checkSetup ? await adapter.checkSetup()
			: { status: "info", message: `${adapter.label}: no setup check available` };
		process.stdout.write(`${style(symbols[result.status], { fg: colors[result.status] })} ${result.message}\n`);
	}
}
