import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';
import {
  conversation,
  createCliClient,
  detectClis,
  findCli,
  probe,
  resolveCmdShim,
  searchDirs
} from '../src/main/quiz/cli.js';

const SCHEMA = {type: 'object', additionalProperties: false, required: ['a'], properties: {a: {type: 'string'}}};
const params = (messages) => ({
  model: 'claude-sonnet-5-5',
  system: [{type: 'text', text: '作る係'}],
  output_config: {format: {type: 'json_schema', schema: SCHEMA}},
  messages
});

test('Claude Code・Codex を探す：PATH とよく入る場所。Windows は .exe・.cmd', () => {
  const dirs = searchDirs({platform: 'darwin', home: '/Users/a', env: {PATH: '/bin:/usr/bin'}});
  assert.deepEqual(dirs.slice(0, 2), ['/bin', '/usr/bin']);
  assert.ok(dirs.includes('/opt/homebrew/bin'), 'アプリからは見えない Homebrew の場所も探す');
  assert.ok(dirs.includes('/Users/a/.local/bin'));
  const have = new Set(['/opt/homebrew/bin/codex']);
  assert.equal(
    findCli('codex', {platform: 'darwin', home: '/Users/a', env: {PATH: '/bin'}, exists: (f) => have.has(f)}),
    '/opt/homebrew/bin/codex'
  );
  assert.equal(
    findCli('claude', {platform: 'darwin', home: '/Users/a', env: {PATH: '/bin'}, exists: () => false}),
    null
  );
  const win = new Set(['C:\\Users\\a\\AppData\\Roaming\\npm\\claude.cmd']);
  assert.equal(
    findCli('claude', {
      platform: 'win32',
      home: 'C:\\Users\\a',
      env: {Path: 'C:\\Windows', APPDATA: 'C:\\Users\\a\\AppData\\Roaming'},
      exists: (f) => win.has(f)
    }),
    'C:\\Users\\a\\AppData\\Roaming\\npm\\claude.cmd'
  );
});

test('Windows の npm の入口（.cmd）は、中の .js を Node で直接動かす（シェルを通さない）', () => {
  const shim = `@ECHO off\r\nSET dp0=%~dp0\r\n"%_prog%"  "%dp0%\\node_modules\\@openai\\codex\\bin\\codex.js" %*\r\n`;
  const r = resolveCmdShim('C:\\npm\\codex.cmd', () => shim);
  assert.deepEqual(r.prefix, ['C:\\npm\\node_modules\\@openai\\codex\\bin\\codex.js']);
  assert.deepEqual(resolveCmdShim('/usr/bin/claude'), {command: '/usr/bin/claude', prefix: []});
  assert.throws(() => resolveCmdShim('C:\\npm\\x.cmd', () => 'echo hi'), /読み取れません/);
});

test('版を聞いて動くか確かめる・見つからなければ null', async () => {
  assert.deepEqual(await probe('/x/claude', async () => ({code: 0, stdout: '2.1.316 (Claude Code)\n', stderr: ''})), {
    path: '/x/claude',
    version: '2.1.316'
  });
  assert.equal(await probe('/x/claude', async () => ({code: 1, stdout: '', stderr: 'boom'})), null);
  assert.equal(
    await probe('/x/claude', async () => {
      throw new Error('ENOENT');
    }),
    null
  );
  const found = await detectClis({
    find: (bin) => (bin === 'codex' ? '/x/codex' : null),
    check: async (f) => ({path: f, version: '0.166.0'})
  });
  assert.deepEqual(found, {'claude-code': null, codex: {path: '/x/codex', version: '0.166.0'}});
});

test('会話を 1 つの文に：直してもらうときは前の返事と追加の依頼を分ける', () => {
  assert.equal(conversation([{role: 'user', content: '作って'}]), '作って');
  const two = conversation([
    {role: 'user', content: '作って'},
    {role: 'assistant', content: [{type: 'text', text: '{"a":"x"}'}]},
    {role: 'user', content: '直して'}
  ]);
  assert.match(two, /## 依頼\n作って\n\n## あなたの前の返事\n\{"a":"x"\}\n\n## 追加の依頼\n直して/);
});

test('Claude Code：--json-schema の答えを受け取る。道具なし・会話は stdin。ログインがなければ知らせる', async () => {
  const calls = [];
  const runner = async (file, args, opts) => {
    calls.push({file, args, opts});
    return {
      code: 0,
      stdout: JSON.stringify({type: 'result', subtype: 'success', is_error: false, structured_output: {a: 'ok'}}),
      stderr: ''
    };
  };
  const c = createCliClient({engine: 'claude-code', file: '/x/claude', runner});
  const msg = await c.beta.messages.stream(params([{role: 'user', content: '作って'}])).finalMessage();
  assert.deepEqual(msg, {content: [{type: 'text', text: '{"a":"ok"}'}], stop_reason: 'end_turn', usage: {}});
  const {args, opts} = calls[0];
  assert.equal(args[args.indexOf('--json-schema') + 1], JSON.stringify(SCHEMA));
  assert.equal(args[args.indexOf('--tools') + 1], '', '道具は使わせない');
  assert.equal(args[args.indexOf('--model') + 1], 'claude-sonnet-5-5');
  assert.match(args[args.indexOf('--system-prompt') + 1], /^作る係/);
  assert.equal(opts.input, '作って');
  const out = createCliClient({
    engine: 'claude-code',
    file: '/x/claude',
    runner: async () => ({
      code: 1,
      stdout: JSON.stringify({
        type: 'result',
        subtype: 'success',
        is_error: true,
        result: 'Not logged in · Please run /login'
      }),
      stderr: ''
    })
  });
  await assert.rejects(
    out.beta.messages.stream(params([{role: 'user', content: 'x'}])).finalMessage(),
    (e) => e.code === 'cli-login'
  );
});

test('Codex：--output-schema のファイルを渡し、-o のファイルから答えを読む。失敗はわかる言葉で', async () => {
  let seen;
  const runner = async (file, args, opts) => {
    seen = {args, opts, schema: JSON.parse(await readFile(args[args.indexOf('--output-schema') + 1], 'utf8'))};
    await writeFile(args[args.indexOf('-o') + 1], '{"a":"codex"}\n');
    return {code: 0, stdout: '', stderr: ''};
  };
  const c = createCliClient({engine: 'codex', file: '/x/codex', runner});
  const msg = await c.beta.messages.stream(params([{role: 'user', content: '作って'}])).finalMessage();
  assert.equal(msg.content[0].text, '{"a":"codex"}');
  assert.deepEqual(seen.schema, SCHEMA);
  assert.deepEqual(seen.args.slice(0, 2), ['exec', '--skip-git-repo-check']);
  assert.equal(seen.args[seen.args.indexOf('--sandbox') + 1], 'read-only');
  assert.equal(seen.args.at(-1), '-', '依頼は stdin から');
  assert.match(seen.opts.input, /^作る係[\s\S]*## 返し方[\s\S]*作って$/);
  const fail = createCliClient({
    engine: 'codex',
    file: '/x/codex',
    runner: async () => ({code: 1, stdout: '', stderr: 'Error: Not authenticated. Run codex login'})
  });
  await assert.rejects(
    fail.beta.messages.stream(params([{role: 'user', content: 'x'}])).finalMessage(),
    (e) => e.code === 'cli-login'
  );
  assert.throws(() => createCliClient({engine: 'api', file: '/x'}), /知らない/);
});
