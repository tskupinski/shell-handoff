import { formatReport } from "./output.js";

export async function sendItems({ terminal, store }, { source, runner, items, how }) {
	if (!["type", "paste"].includes(how)) throw new Error("Unknown send mode");
	if (how === "paste" && !terminal.capabilities.paste) throw new Error(`${terminal.label} does not support paste without execution; use copy instead`);
	if (runner === source || !(await terminal.paneExists(runner))) throw new Error("Runner pane is unavailable; press r to choose another pane");
	if (!items.length) throw new Error("No commands selected");
	const mark = terminal.capabilities.output ? await terminal.outputMark(runner) : null;
	// Invalidate before input can be partially sent.
	await store.writeRun(runner, null);
	const commands = items.map((item) => item.text);
	const text = commands.join("\n");
	if (how === "paste") await terminal.pasteText(runner, text);
	else await terminal.typeText(runner, text);
	await store.writeRun(runner, { source, mark, at: new Date().toISOString(), commands });
}

export async function returnOutput({ terminal, assistant, store }, { source, runner }) {
	if (!terminal.capabilities.output) throw new Error(`${terminal.label} cannot capture output; copy it from the terminal manually`);
	const run = runner ? await store.readRun(runner) : null;
	if (!run) throw new Error(runner ? "nothing sent to the runner yet - run something first" : "no runner pane yet - run something first");
	if (run.source !== source) throw new Error(`The last run belongs to another ${assistant.label} pane; open the picker there to return its output`);
	if (run.mark === null) throw new Error("Output was not tracked for this run");
	if (!(await terminal.paneExists(source))) throw new Error("The source pane is no longer available");
	const { lines, running, warning } = await terminal.readOutput(runner, run.mark);
	const text = [warning, formatReport({ commands: run.commands, lines, running })].filter(Boolean).join("\n\n");
	return assistant.returnReport({ terminal, source, text });
}
