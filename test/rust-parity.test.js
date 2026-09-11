import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, execFileSync, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';
import { createHash } from 'node:crypto';
import { extractItems } from '../src/transcript.js';
import { codex } from '../src/assistants/codex.js';
import { createStore } from '../src/store.js';
import { createHerdrTerminal } from '../src/terminals/herdr.js';

const binary = process.env.SHELL_HANDOFF_RUST_BIN;
const fixtures = JSON.parse(await readFile(new URL('./fixtures/capture.json', import.meta.url), 'utf8'));
const exec = promisify(execFile);

test('JavaScript capture matches the shared migration fixtures', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'shh-fixtures-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const fixture of fixtures) {
    const transcript = join(directory, 't');
    await writeFile(transcript, (fixture.padding ? 'x'.repeat(fixture.padding) + '\n' : fixture.prefix ?? '') + (fixture.entries ?? []).map(e => JSON.stringify(e)).join('\n') + '\n' + (fixture.suffix ?? ''));
    const event = { ...fixture.event, transcript_path: transcript, ...(fixture.text !== undefined ? { last_assistant_message: fixture.text } : {}) };
    assert.deepEqual(await extractItems(event), fixture.expected['claude-code'], fixture.name);
    assert.deepEqual(codex.extractItems({ type: 'agent-turn-complete', 'last-assistant-message': fixture.text ?? fixture.event?.last_assistant_message }), fixture.expected.codex, fixture.name);
  }
});

test('Rust capture matches JavaScript fixtures and Herdr cache identities', { skip: !binary }, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'shh-rust-'));
  const socketPath = join(directory, 's');
  const server = createServer(socket => {
    let input = '';
    socket.on('data', chunk => {
      input += chunk;
      if (!input.includes('\n')) return;
      const request = JSON.parse(input);
      const reply = JSON.stringify({ id: request.id, result: { version: 'fixture' } }) + '\n';
      socket.write(reply.slice(0, 8));
      socket.end(reply.slice(8));
    });
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(socketPath, resolve); });
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await rm(directory, { recursive: true, force: true }); });
  const env = { ...process.env, HERDR_SOCKET_PATH: socketPath, HERDR_PANE_ID: 'w1:p2', XDG_CACHE_HOME: directory };
  const terminal = createHerdrTerminal({ env });
  const invoke = async (args, overrides = {}) => {
    const result = await exec(resolve(binary), args, { env: { ...env, ...overrides } });
    return result;
  };
  for (const assistant of ['claude-code', 'codex']) {
    const store = createStore(terminal, { assistantId: assistant, directory: join(directory, 'shell-handoff') });
    const identity = JSON.stringify(['herdr', assistant, await terminal.storage.scope()]);
    const file = join(directory, 'shell-handoff', createHash('sha256').update(identity).digest('hex'), 'w1_p2.json');
    for (const fixture of fixtures) {
      const transcript = join(directory, 'transcript.jsonl');
      await writeFile(transcript, (fixture.padding ? 'x'.repeat(fixture.padding) + '\n' : fixture.prefix ?? '') + (fixture.entries ?? []).map(e => JSON.stringify(e)).join('\n') + '\n' + (fixture.suffix ?? ''));
      const event = assistant === 'codex'
        ? { type: 'agent-turn-complete', 'last-assistant-message': fixture.text ?? fixture.event?.last_assistant_message }
        : { ...fixture.event, transcript_path: transcript, ...(fixture.text !== undefined ? { last_assistant_message: fixture.text } : {}) };
      const expected = assistant === 'codex' ? codex.extractItems(event) : await extractItems(event);
      const result = await invoke(['capture', '--assistant', assistant, JSON.stringify(event)]);
      assert.equal(result.stdout + result.stderr, '', fixture.name);
      assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), expected, `${assistant}: ${fixture.name}`);
      assert.equal((await stat(file)).mode & 0o777, 0o600);
      assert.deepEqual((await store.readItems('w1:p2')).map(i => i.text), expected.map(i => i.text));
    }
    await store.writeItems('w1:p2', [{ kind: 'command', text: 'preserved' }]);
    for (const args of [['capture', '--assistant'], ['capture', '--assistant', 'unknown'], ['capture', '--assistant', assistant, '{']]) {
      const result = await invoke(args); assert.equal(result.stdout + result.stderr, '');
      assert.equal((await store.readItems('w1:p2'))[0].text, 'preserved');
    }
    await invoke(['capture', '--assistant', assistant, '{}'], { HERDR_PANE_ID: '', HERDR_ACTIVE_PANE_ID: 'w1:p2' });
    assert.equal((await store.readItems('w1:p2'))[0].text, 'preserved');
    if (assistant === 'codex') {
      await invoke(['capture', '--assistant', assistant, '{"type":"approval-requested"}']);
      assert.equal((await store.readItems('w1:p2'))[0].text, 'preserved');
    }
  }
  const doctor = await invoke(['doctor', '--assistant', 'codex']);
  assert.match(doctor.stdout, /Herdr fixture: socket reachable/);
  assert.match(doctor.stdout, /Effective Codex configuration is not checked/);
  const home = join(directory, 'home');
  const missing = await invoke(['doctor'], { HOME: home });
  assert.match(missing.stdout, /no readable .*settings.json/);
  await mkdir(join(home, '.claude'), { recursive: true });
  await writeFile(join(home, '.claude/settings.json'), JSON.stringify({ hooks: { Stop: [{ hooks: [{ command: 'shell-handoff capture' }] }] } }));
  assert.match((await invoke(['doctor'], { HOME: home })).stdout, /✓ Stop hook runs/);
  await writeFile(join(home, '.claude/settings.json'), '{}');
  assert.match((await invoke(['doctor'], { HOME: home })).stdout, /no Stop hook found/);
  await assert.rejects(invoke(['doctor', '--assistant', 'unknown']), error => error.code === 1 && /Unknown assistant/.test(error.stderr));
});

test('Rust capture uses the existing tmux namespaces and stdin hook', { skip: !binary }, async (t) => {
  if (spawnSync('tmux', ['-V']).status !== 0) return t.skip('tmux is not installed');
  const directory = await mkdtemp(join(tmpdir(), 'shh-rust-tmux-'));
  const socket = join(directory, 's');
  const tmux = (...args) => execFileSync('tmux', ['-S', socket, ...args], { encoding: 'utf8' }).trimEnd();
  tmux('-f', '/dev/null', 'new-session', '-d', 'sh');
  t.after(async () => { try { tmux('kill-server'); } finally { await rm(directory, { recursive: true, force: true }); } });
  const pane = tmux('display-message', '-p', '#{pane_id}');
  const identity = tmux('display-message', '-p', '#{socket_path}:#{pid}:#{start_time}');
  const env = { ...process.env, HERDR_SOCKET_PATH: '', HERDR_PANE_ID: '', TMUX: `${socket},1,0`, TMUX_PANE: pane, XDG_CACHE_HOME: directory };
  for (const assistant of ['claude-code', 'codex']) {
    const event = assistant === 'codex' ? { type: 'agent-turn-complete', 'last-assistant-message': '! echo rust' } : { last_assistant_message: '! echo rust' };
    const result = spawnSync(resolve(binary), ['capture', '--assistant', assistant], { input: JSON.stringify(event), encoding: 'utf8', env });
    assert.equal(result.status, 0); assert.equal(result.stdout + result.stderr, '');
    const scope = assistant === 'claude-code' ? identity : JSON.stringify(['tmux', assistant, identity]);
    const file = join(directory, 'shell-handoff', createHash('sha256').update(scope).digest('hex'), `${pane.slice(1)}.json`);
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), [{ kind: 'command', text: 'echo rust' }]);
  }
});
