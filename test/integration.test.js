import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'runner-test-'));
const cli = resolve('src/cli.js');

test('capture failures stay silent and successful', () => {
	for (const input of ['{', 'null', JSON.stringify({ last_assistant_message: '! echo hi' })]) {
		const result = spawnSync(process.execPath, [cli, 'capture'], {
			input, encoding: 'utf8', env: { ...process.env, TMUX: join(dir, 'missing') + ',1,0', TMUX_PANE: '%0', XDG_CACHE_HOME: '/dev/null' },
		});
		assert.equal(result.status, 0);
		assert.equal(result.stderr, '');
		assert.equal(result.stdout, '');
	}
});

test('tmux handoff, history loss, pane loss and server isolation', async (t) => {
	if (spawnSync('tmux', ['-V']).status !== 0) return t.skip('tmux is not installed');
	const socket = join(dir, 'tmux.sock');
	const run = (...args) => execFileSync('tmux', ['-S', socket, ...args], { encoding: 'utf8' }).trimEnd();
	try { run('-f', '/dev/null', 'new-session', '-d', '-s', 'test', '-x', '100', '-y', '30', 'sh'); }
	catch (error) { throw new Error(`Cannot start isolated tmux server: ${error.message}`); }
	t.after(() => { try { run('kill-server'); } catch {} });
	process.env.TMUX = `${socket},${run('display-message', '-p', '#{pid}')},0`;
	process.env.XDG_CACHE_HOME = dir;
	const { tmux, pasteText, typeText, outputMark, captureSince, paneExists } = await import('../src/tmux.js');
	const { writeItems, readItems, writeRun, readRun } = await import('../src/store.js');
	const pane = run('display-message', '-p', '#{pane_id}');
	// Codex notify passes JSON as argv, not stdin. Exercise CLI capture and
	// assistant storage isolation against a real tmux server.
	const { createRuntime } = await import('../src/runtime.js');
	const codexRuntime = createRuntime({ assistant: 'codex' });
	const notify = (event) => {
		const result = spawnSync(process.execPath, [cli, 'capture', '--assistant', 'codex', JSON.stringify(event)], {
			encoding: 'utf8', env: { ...process.env, TMUX_PANE: pane },
		});
		assert.equal(result.status, 0);
		assert.equal(result.stdout + result.stderr, '');
	};
	notify({ type: 'agent-turn-complete', 'last-assistant-message': '! echo CODEX_CAPTURE' });
	assert.equal((await codexRuntime.store.readItems(pane))[0].text, 'echo CODEX_CAPTURE');
	assert.deepEqual(await readItems(pane), []);
	notify({ type: 'approval-requested' });
	assert.equal((await codexRuntime.store.readItems(pane)).length, 1);
	notify({ type: 'agent-turn-complete', 'last-assistant-message': 'Done.' });
	assert.deepEqual(await codexRuntime.store.readItems(pane), []);
	const waitFor = async (check) => {
		for (let i = 0; i < 100; i++) { if (await check()) return; await new Promise(r => setTimeout(r, 20)); }
		assert.fail('Timed out waiting for tmux');
	};
	// The ordinary shortcut selects Codex without an assistant flag.
	notify({ type: 'agent-turn-complete', 'last-assistant-message': '! echo AUTO_CODEX' });
	await typeText(pane, `XDG_CACHE_HOME=${JSON.stringify(dir)} ${JSON.stringify(process.execPath)} ${JSON.stringify(cli)} pick ${pane}`);
	await waitFor(async () => (await tmux(['capture-pane', '-p', '-t', pane])).includes('Codex · 1 to run'));
	await tmux(['send-keys', '-t', pane, 'q']);
	await waitFor(async () => !(await tmux(['capture-pane', '-p', '-t', pane])).includes('SHELL HANDOFF'));
	notify({ type: 'agent-turn-complete', 'last-assistant-message': 'Done.' });
	await typeText(pane, "printf 'BEFORE\\n'");
	await waitFor(async () => (await tmux(['capture-pane', '-p', '-t', pane])).includes('BEFORE\n'));
	const mark = await outputMark(pane);
	await typeText(pane, "printf 'AFTER\\n'");
	await waitFor(async () => (await captureSince(pane, mark)).lines.includes('AFTER'));
	assert.equal((await captureSince(pane, mark)).warning, '');
	await writeItems(pane, [{ kind: 'command', text: 'echo first' }, { kind: 'command', text: 'echo second' }]);
	await writeRun(pane, { source: pane, mark, commands: ['echo hi'] });
	assert.equal((await readRun(pane)).source, pane);
	// Exercise the actual TUI using a separate terminal pane.
	const picker = run('split-window', '-d', '-P', '-F', '#{pane_id}', 'sh');
	await tmux(['set-option', '-w', '-t', pane, '@shell_handoff', picker]);
	await typeText(pane, `XDG_CACHE_HOME=${JSON.stringify(dir)} ${JSON.stringify(process.execPath)} ${JSON.stringify(cli)} pick ${pane}`);
	await waitFor(async () => (await tmux(['capture-pane', '-p', '-t', pane])).includes('SHELL HANDOFF'));
	await tmux(['send-keys', '-t', pane, 'v']);
	await waitFor(async () => (await tmux(['capture-pane', '-p', '-t', pane])).includes('FULL COMMAND'));
	await tmux(['send-keys', '-t', pane, 'Escape']);
	await waitFor(async () => (await tmux(['capture-pane', '-p', '-t', pane])).includes('SHELL HANDOFF'));
	await tmux(['send-keys', '-t', pane, 'a']);
	await new Promise(r => setTimeout(r, 50));
	await tmux(['send-keys', '-t', pane, 'p']);
	await waitFor(async () => (await readRun(picker))?.commands.length === 2);
	const pasted = await tmux(['capture-pane', '-p', '-t', picker]);
	assert.ok(!pasted.includes('echo firstecho second'));
	assert.ok(pasted.includes('echo first'));
	assert.ok(pasted.includes('echo second'));
	// A report from another source must not be pasted into this source.
	await writeRun(picker, { source: '%999', mark, commands: ['WRONG_CONVERSATION'] });
	await typeText(pane, `XDG_CACHE_HOME=${JSON.stringify(dir)} ${JSON.stringify(process.execPath)} ${JSON.stringify(cli)} pick ${pane}`);
	await waitFor(async () => (await tmux(['capture-pane', '-p', '-t', pane])).includes('SHELL HANDOFF'));
	await tmux(['send-keys', '-t', pane, 'o']);
	await waitFor(async () => (await tmux(['capture-pane', '-p', '-t', pane])).includes('another Claude Code pane'));
	await tmux(['send-keys', '-t', pane, 'q']);
	await typeText(pane, "seq 1 200");
	await waitFor(async () => (await tmux(['capture-pane', '-p', '-t', pane])).includes('200'));
	const beforeClear = await outputMark(pane);
	await tmux(['clear-history', '-t', pane]);
	assert.ok((await captureSince(pane, beforeClear)).warning);
	const beforeOverflow = await outputMark(pane);
	await typeText(pane, 'seq 1 10000');
	await waitFor(async () => (await tmux(['capture-pane', '-p', '-t', pane])).includes('10000'));
	assert.ok((await captureSince(pane, beforeOverflow)).warning);
	await tmux(['kill-pane', '-t', picker]);
	assert.equal(await paneExists(picker), false);
	await assert.rejects(pasteText(picker, 'unavailable'));
	const oldEnv = process.env.TMUX;
	const otherSocket = join(dir, 'other.sock');
	execFileSync('tmux', ['-S', otherSocket, '-f', '/dev/null', 'new-session', '-d', 'sh']);
	try {
		process.env.TMUX = `${otherSocket},1,0`;
		assert.deepEqual(await readItems(pane), []);
	} finally {
		process.env.TMUX = oldEnv;
		execFileSync('tmux', ['-S', otherSocket, 'kill-server']);
	}
});
