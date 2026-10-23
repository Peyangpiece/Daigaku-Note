// 保存先の検査（SPEC §7.2）。ホームフォルダの中の、隠しフォルダ・Library 以外に限る。副作用なし。
import path from 'node:path';
import {homedir} from 'node:os';

/**
 * 入力された保存先を検査し、正規化した絶対パスを返す。空なら ''（既定を使う）。だめなら Error を投げる。
 * p は OS に合わせた path モジュール（テストで posix/win32 を差し替えられる）
 */
export function checkDownloadDir(input, home = homedir(), p = path) {
  const raw = String(input ?? '').trim();
  if (!raw) return '';
  if (raw.length > 500) throw new Error('フォルダのパスが長すぎます');
  const expanded = raw === '~' ? home : /^~[\\/]/.test(raw) ? p.join(home, raw.slice(2)) : raw;
  if (!p.isAbsolute(expanded))
    throw new Error('フォルダは絶対パス（/Users/… や C:\\Users\\…、または ~/…）で指定してください');
  const full = p.resolve(expanded);
  const rel = p.relative(home, full);
  if (rel.startsWith('..') || p.isAbsolute(rel) || p.resolve(home, rel) !== full)
    throw new Error('ホームフォルダの中のフォルダを指定してください');
  const parts = rel ? rel.split(p.sep) : [];
  if (parts.some((s) => s.startsWith('.'))) throw new Error('隠しフォルダは指定できません');
  if (parts[0] === 'Library') throw new Error('ライブラリフォルダは指定できません');
  return full;
}

/** child が root の中（root 自身は含まない）にあるか */
export function inside(child, root, p = path) {
  if (!child || !root) return false;
  const rel = p.relative(root, child);
  return rel !== '' && !rel.startsWith('..') && !p.isAbsolute(rel);
}

/** 既定のルート：デスクトップ/大学ノート */
export function defaultRoot(desktop, p = path) {
  return p.join(desktop, '大学ノート');
}

/** 既定の取り込みフォルダ：ルート/取り込み */
export function importDir(root, p = path) {
  return p.join(root, '取り込み');
}
