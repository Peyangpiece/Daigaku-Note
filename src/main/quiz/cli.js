// クイズ（テスト）を、このパソコンに入っている Claude Code・Codex のコマンドで作る（SPEC §11.8）。
// generate.js が使う Anthropic の client と同じ形（client.beta.messages.stream(params).finalMessage()）にそろえ、
// 中でコマンドを 1 回ずつ起こす。答えは JSON Schema に合う形で受け取る（Claude Code は --json-schema、Codex は --output-schema）。
// 道具（ファイルの読み書き・コマンド）は使わせず、空の一時フォルダで動かす。費用は各サービスの契約の範囲なので、ここでは数えない
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/** クイズを作る AI の種類 */
export const ENGINES = {
  api: {label: 'Claude API キー'},
  'claude-code': {label: 'Claude Code', bin: 'claude', vendor: 'Anthropic'},
  codex: {label: 'Codex', bin: 'codex', vendor: 'OpenAI'}
};
export const CLI_ENGINES = Object.keys(ENGINES).filter((k) => ENGINES[k].bin);

const CALL_MS = 10 * 60 * 1000; // 1 回のやりとりの上限（資料が長いと数分かかる）
const PROBE_MS = 15 * 1000;
const err = (code, message, detail) => Object.assign(new Error(message), {code, detail});

/**
 * コマンドを探す場所：PATH と、よく入る場所。アプリはターミナルから起動しないので、
 * Mac ではシェルの設定で足した PATH（Homebrew・npm の置き場など）が見えないことが多い
 */
export function searchDirs({platform = process.platform, home = os.homedir(), env = process.env} = {}) {
  const fromPath = String(env.PATH ?? env.Path ?? '')
    .split(platform === 'win32' ? ';' : ':')
    .filter(Boolean);
  const j = platform === 'win32' ? path.win32.join : path.posix.join;
  const extra =
    platform === 'win32'
      ? [
          env.APPDATA && j(env.APPDATA, 'npm'),
          j(home, '.local', 'bin'),
          j(home, '.bun', 'bin'),
          j(home, '.volta', 'bin'),
          env.LOCALAPPDATA && j(env.LOCALAPPDATA, 'Programs', 'claude'),
          env.ProgramFiles && j(env.ProgramFiles, 'nodejs')
        ]
      : [
          j(home, '.local', 'bin'),
          j(home, '.claude', 'local'),
          j(home, '.npm-global', 'bin'),
          j(home, '.volta', 'bin'),
          j(home, '.bun', 'bin'),
          '/opt/homebrew/bin',
          '/usr/local/bin',
          '/usr/bin',
          ...nvmBins(home)
        ];
  return [...new Set([...fromPath, ...extra.filter(Boolean)])];
}

/** nvm で入れた Node の bin（新しい版から） */
function nvmBins(home) {
  const base = path.join(home, '.nvm', 'versions', 'node');
  try {
    return fs
      .readdirSync(base)
      .sort((a, b) => b.localeCompare(a, 'en', {numeric: true}))
      .map((v) => path.join(base, v, 'bin'));
  } catch {
    return [];
  }
}

/** コマンドの実体の場所。なければ null */
export function findCli(bin, opts = {}) {
  const platform = opts.platform ?? process.platform;
  const names = platform === 'win32' ? [`${bin}.exe`, `${bin}.cmd`, `${bin}.bat`] : [bin];
  const exists = opts.exists ?? ((f) => fs.statSync(f, {throwIfNoEntry: false})?.isFile() ?? false);
  for (const dir of searchDirs(opts))
    for (const n of names) {
      const f = (platform === 'win32' ? path.win32 : path.posix).join(dir, n);
      if (exists(f)) return f;
    }
  return null;
}

/**
 * Windows の npm の入口（○○.cmd）は、シェルを通さないと動かない。シェルを通すと引数の引用がこわれるので、
 * 入口の中に書いてある本体の .js を Node で直接動かす
 */
export function resolveCmdShim(file, read = (f) => fs.readFileSync(f, 'utf8')) {
  if (!/\.(cmd|bat)$/i.test(file)) return {command: file, prefix: []};
  const dir = path.win32.dirname(file);
  const m = /"%(?:~dp0|dp0)%\\?([^"]+?\.(?:c?js|mjs))"/i.exec(read(file));
  if (!m) throw err('cli-shim', `${path.win32.basename(file)} の中身を読み取れませんでした`);
  const script = path.win32.join(dir, m[1]);
  const localNode = path.win32.join(dir, 'node.exe');
  return {command: fs.existsSync(localNode) ? localNode : 'node', prefix: [script]};
}

/** コマンドに渡す環境：見つけた場所と探した場所を PATH に足す（npm の入口は Node を PATH から探すため） */
export function cliEnv(file, base = process.env) {
  const sep = process.platform === 'win32' ? ';' : ':';
  const env = {...base};
  delete env.CLAUDECODE; // Claude Code の中から起動したときの印。入れ子と見なされないように外す
  const key = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';
  env[key] = [path.dirname(file), ...searchDirs({env: base})].join(sep);
  return env;
}

/** コマンドを動かす。stdin に input を流し、終わるまで待つ */
export function run(file, args, {input = '', cwd, timeoutMs = CALL_MS, env = cliEnv(file)} = {}) {
  return new Promise((resolve, reject) => {
    let shim;
    try {
      shim = resolveCmdShim(file);
    } catch (e) {
      return reject(e);
    }
    const child = spawn(shim.command, [...shim.prefix, ...args], {cwd, env, windowsHide: true});
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(err('cli-timeout', '時間がかかりすぎたので止めました。資料を分けるか、もう一度作ってください'));
    }, timeoutMs);
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr = (stderr + d).slice(-8000)));
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(err('cli-start', 'コマンドを起動できませんでした（設定 → クイズ で探し直してください）', e.message));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({code, stdout, stderr});
    });
    child.stdin.on('error', () => {}); // すぐ終わったコマンドへの書き込みの失敗は、終わり方で判断する
    child.stdin.end(input);
  });
}

/** 版を聞いて、動くか確かめる。動けば {path, version} */
export async function probe(file, runner = run) {
  try {
    const r = await runner(file, ['--version'], {timeoutMs: PROBE_MS, cwd: os.tmpdir()});
    const version = /\d+\.\d+\.\d+/.exec(`${r.stdout} ${r.stderr}`)?.[0];
    return r.code === 0 && version ? {path: file, version} : null;
  } catch {
    return null;
  }
}

/** このパソコンの Claude Code・Codex を探す。{'claude-code': {path, version} | null, codex: …} */
export async function detectClis({find = findCli, check = probe} = {}) {
  const out = {};
  for (const engine of CLI_ENGINES) {
    const f = find(ENGINES[engine].bin);
    out[engine] = f ? await check(f) : null;
  }
  return out;
}

const textOf = (content) =>
  typeof content === 'string'
    ? content
    : (content ?? [])
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join('');

/** 会話（messages）を 1 つの文にする。直してもらうとき（2 回目）は前の返事と追加の依頼を見出しで分ける */
export function conversation(messages) {
  if (messages.length === 1) return textOf(messages[0].content);
  return messages
    .map((m, i) =>
      m.role === 'assistant'
        ? `## あなたの前の返事\n${textOf(m.content)}`
        : `## ${i === 0 ? '依頼' : '追加の依頼'}\n${textOf(m.content)}`
    )
    .join('\n\n');
}

const OUTPUT_RULE =
  '## 返し方\n決められた JSON の形で答えだけを返す。ファイルの読み書きやコマンドなどの道具は使わない（必要なものは全部この中にある）。';

/** ログインの要る失敗を見分ける（各コマンドの文言から） */
const needsLogin = (s) =>
  /\b(log ?in|logged out|not authenticated|authentication|unauthori[sz]ed|invalid api key)\b|\b401\b/i.test(s);

async function callClaudeCode(file, params, {runner, tmp}) {
  const system = `${textOf(params.system)}\n\n${OUTPUT_RULE}`;
  const args = [
    '-p',
    '--output-format',
    'json',
    '--json-schema',
    JSON.stringify(params.output_config?.format?.schema ?? {}),
    '--system-prompt',
    system,
    '--tools',
    '',
    '--no-session-persistence',
    '--setting-sources',
    '',
    '--strict-mcp-config',
    ...(params.model ? ['--model', params.model] : [])
  ];
  const r = await runner(file, args, {input: conversation(params.messages), cwd: tmp});
  let out;
  try {
    out = JSON.parse(r.stdout);
  } catch {
    const all = `${r.stdout}\n${r.stderr}`;
    if (needsLogin(all))
      throw err(
        'cli-login',
        'Claude Code にログインしてください（ターミナルで claude を開き /login）',
        all.slice(-500)
      );
    throw err('cli-failed', 'Claude Code から答えを受け取れませんでした', all.slice(-500));
  }
  if (out.is_error || out.subtype !== 'success') {
    const why = String(out.result ?? out.subtype ?? '');
    if (needsLogin(why))
      throw err('cli-login', 'Claude Code にログインしてください（ターミナルで claude を開き /login）', why);
    throw err('cli-failed', `Claude Code で作れませんでした：${why.slice(0, 120)}`, why);
  }
  if (out.structured_output == null)
    throw err('quiz-bad-json', 'AI の返事を読み取れませんでした。もう一度作ってください');
  return JSON.stringify(out.structured_output);
}

async function callCodex(file, params, {runner, tmp}) {
  const schemaFile = path.join(tmp, 'schema.json');
  const outFile = path.join(tmp, 'answer.json');
  await fsp.writeFile(schemaFile, JSON.stringify(params.output_config?.format?.schema ?? {}));
  await fsp.rm(outFile, {force: true});
  const prompt = `${textOf(params.system)}\n\n${OUTPUT_RULE}\n\n${conversation(params.messages)}`;
  const args = [
    'exec',
    '--skip-git-repo-check',
    '--ephemeral',
    '--sandbox',
    'read-only',
    '--color',
    'never',
    '--output-schema',
    schemaFile,
    '-o',
    outFile,
    '-C',
    tmp,
    '-'
  ];
  const r = await runner(file, args, {input: prompt, cwd: tmp});
  const text = await fsp.readFile(outFile, 'utf8').catch(() => '');
  if (r.code !== 0 || !text.trim()) {
    const all = `${r.stderr}\n${r.stdout}`;
    if (needsLogin(all))
      throw err('cli-login', 'Codex にログインしてください（ターミナルで codex login）', all.slice(-500));
    throw err('cli-failed', 'Codex から答えを受け取れませんでした', all.slice(-500));
  }
  return text.trim();
}

/**
 * generate.js の client と同じ形の窓口。engine は 'claude-code' か 'codex'、file はコマンドの場所。
 * 返事は {content: [{type: 'text', text}], stop_reason: 'end_turn', usage: {}}（費用は数えない）
 */
export function createCliClient({engine, file, runner = run, log = () => {}}) {
  if (!CLI_ENGINES.includes(engine)) throw err('cli-engine', '知らない AI の種類です');
  const once = async (params) => {
    const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'daigaku-quiz-'));
    try {
      const started = Date.now();
      const text =
        engine === 'claude-code'
          ? await callClaudeCode(file, params, {runner, tmp})
          : await callCodex(file, params, {runner, tmp});
      log(`[quiz] ${ENGINES[engine].label} で作りました（${Math.round((Date.now() - started) / 1000)} 秒）`);
      return {content: [{type: 'text', text}], stop_reason: 'end_turn', usage: {}};
    } finally {
      await fsp.rm(tmp, {recursive: true, force: true}).catch(() => {});
    }
  };
  return {beta: {messages: {stream: (params) => ({finalMessage: () => once(params)})}}};
}
