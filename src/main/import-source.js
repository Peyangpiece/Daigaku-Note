// 授業資料の自動取り込み（v0.16.32）：ダウンロードしたファイルの「ダウンロード元」を読み、大学のサイトか見分ける。
// - Windows：ブラウザがファイルに付ける Zone.Identifier（NTFS の代替データストリーム）の ReferrerUrl（落としたときに開いていたページ）と
//   HostUrl（ファイルそのものの URL）
// - Mac：拡張属性 com.apple.metadata:kMDItemWhereFroms（バイナリの plist。ファイルの URL と開いていたページの URL）
// - どちらもブラウザ・設定によっては付かない。付いていなければ「分からない」（本人に聞く）
// 見分け方（judgeSource）：つないだ LMS とログインで通ったホストにそのまま一致 → 大学。登録した大学と同じ組織のドメイン（siteOf）→ 大学。
// 自分で足したサイト → 大学。どれでもなければ「ほか」（何もしない）
import {execFile} from 'node:child_process';
import {promises as fsp} from 'node:fs';
import {siteOf} from './browser/login-form.js';
import {sharedHost, tenantSharePoint} from '../shared/import-sites.js';

/** Zone.Identifier の中身から URL を読む。戻り：[開いていたページ, ファイルの URL]（ないものは除く） */
export function parseZoneIdentifier(text) {
  const get = (key) => String(text ?? '').match(new RegExp(`^\\s*${key}\\s*=\\s*(\\S+)\\s*$`, 'mi'))?.[1] ?? null;
  return [get('ReferrerUrl'), get('HostUrl')].filter((u) => u && /^https?:\/\//i.test(u));
}

/**
 * バイナリの plist（bplist00）から、いちばん上の配列の文字列を読む（kMDItemWhereFroms は URL の文字列の配列）。
 * 読めなければ []。ほかの形（辞書・数など）は読まない
 */
export function parseWhereFroms(buf) {
  try {
    const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf ?? []);
    if (b.length < 40 || b.toString('latin1', 0, 8) !== 'bplist00') return [];
    const t = b.length - 32;
    const offSize = b[t + 6];
    const refSize = b[t + 7];
    const count = Number(b.readBigUInt64BE(t + 8));
    const top = Number(b.readBigUInt64BE(t + 16));
    const table = Number(b.readBigUInt64BE(t + 24));
    const uint = (at, size) => {
      let n = 0;
      for (let i = 0; i < size; i++) n = n * 256 + b[at + i];
      return n;
    };
    const offsetOf = (ref) => uint(table + ref * offSize, offSize);
    // 長さ：下の 4 ビットが 0xF なら、続く整数の印（0x1n）の 2^n バイトが長さ
    const lengthAt = (at) => {
      const low = b[at] & 0x0f;
      if (low !== 0x0f) return {len: low, start: at + 1};
      const size = 1 << (b[at + 1] & 0x0f);
      return {len: uint(at + 2, size), start: at + 2 + size};
    };
    const stringAt = (ref) => {
      if (ref >= count) return null;
      const at = offsetOf(ref);
      const kind = b[at] >> 4;
      const {len, start} = lengthAt(at);
      if (kind === 0x5) return b.toString('latin1', start, start + len);
      if (kind === 0x6) {
        const s = b.subarray(start, start + len * 2);
        const le = Buffer.alloc(s.length);
        for (let i = 0; i + 1 < s.length; i += 2) ((le[i] = s[i + 1]), (le[i + 1] = s[i])); // UTF-16 BE → LE
        return le.toString('utf16le');
      }
      return null;
    };
    const at = offsetOf(top);
    if (b[at] >> 4 !== 0xa) return [];
    const {len, start} = lengthAt(at);
    const out = [];
    for (let i = 0; i < len && i < 16; i++) {
      const s = stringAt(uint(start + i * refSize, refSize));
      if (s && /^https?:\/\//i.test(s)) out.push(s);
    }
    return out;
  } catch {
    return [];
  }
}

const run = (cmd, args) =>
  new Promise((resolve) =>
    execFile(cmd, args, {timeout: 5000, maxBuffer: 1024 * 1024}, (e, out) => resolve(e ? '' : String(out)))
  );

/**
 * ファイルのダウンロード元の URL（開いていたページを先に）。分からなければ []。
 * Mac の WhereFroms は [ファイルの URL, 開いていたページ] の順なので、逆にしてそろえる
 */
export async function readSource(file, {platform = process.platform, readFile = fsp.readFile, exec = run} = {}) {
  if (platform === 'win32') {
    const text = await readFile(`${file}:Zone.Identifier`, 'utf8').catch(() => '');
    return parseZoneIdentifier(text);
  }
  if (platform === 'darwin') {
    const hex = await exec('/usr/bin/xattr', ['-px', 'com.apple.metadata:kMDItemWhereFroms', file]);
    const clean = hex.replace(/[^0-9a-f]/gi, '');
    if (!clean) return [];
    return parseWhereFroms(Buffer.from(clean, 'hex')).reverse();
  }
  return [];
}

const hostOf = (u) => {
  try {
    return new URL(u).hostname.toLowerCase();
  } catch {
    return '';
  }
};
const matchHost = (host, h) => host === h || host.endsWith('.' + h);

export {sharedHost, tenantSharePoint};

const teamsHost = (h) => matchHost(h, 'teams.microsoft.com') || matchHost(h, 'teams.live.com');

/**
 * ダウンロード元が大学のサイトか。urls は readSource の戻り。
 * hosts：つないだ LMS とログインで通ったホスト（そのまま一致）。domain：登録した大学のサイト（例 aichi-edu.ac.jp。同じ組織なら大学）。
 * sites：自分で足したサイト（そのホストと下のホスト）。
 * 戻り：{kind: 'university'|'teams'|'other'|'unknown', host}
 */
export function judgeSource(urls, {hosts = [], domain = '', sites = []} = {}) {
  const list = (urls ?? []).map(hostOf).filter(Boolean);
  if (!list.length) return {kind: 'unknown', host: ''};
  const org = domain ? siteOf(String(domain).toLowerCase()) : '';
  for (const host of list) {
    if (hosts.some((h) => host === String(h).toLowerCase())) return {kind: 'university', host};
    if (org && siteOf(host) === org) return {kind: 'university', host};
    // 足したサイト（共通のサービスは、前の版で足していても使わない）
    if (sites.some((h) => !sharedHost(h) && matchHost(host, String(h).toLowerCase())))
      return {kind: 'university', host};
  }
  // Teams（大学ごとの SharePoint）から落としたもの：まだ大学のサイトとして覚えていなければ、取り込むか聞く（v0.17.2）。
  // host は覚えるときに使う SharePoint のホスト（分からなければ ''）
  const sp = list.find(tenantSharePoint);
  if (sp) return {kind: 'teams', host: sp};
  if (list.some(teamsHost)) return {kind: 'teams', host: ''};
  return {kind: 'other', host: list[0]};
}

/** 入力された URL（またはホスト名）から、大学の組織のドメイン（例 https://www.aichi-edu.ac.jp/ → aichi-edu.ac.jp）。読めなければ '' */
export function domainOf(input) {
  const s = String(input ?? '').trim();
  if (!s) return '';
  const host = hostOf(/^https?:\/\//i.test(s) ? s : `https://${s}`);
  if (!host || !host.includes('.') || /^\d+(\.\d+){3}$/.test(host)) return '';
  return siteOf(host);
}

/** 足すサイト（URL かホスト名）をホスト名にする。読めなければ '' */
export function siteHost(input) {
  const s = String(input ?? '').trim();
  if (!s) return '';
  const host = hostOf(/^https?:\/\//i.test(s) ? s : `https://${s}`);
  return host && host.includes('.') ? host : '';
}
