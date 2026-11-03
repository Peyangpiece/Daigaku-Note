// IPC の窓口：着せ替えとシール（skin.*・sticker.*）。index.js が register を呼ぶ（SPEC §12・DESIGN-M0 §4）
import {app} from 'electron';
import {promises as fsp} from 'node:fs';
import path from 'node:path';
import {isUlid, ulid} from '../../shared/ids.js';
import {CLASSIC_ID, SHAPES, isBuiltin, isHex, normalizeTemplate} from '../../shared/skin.js';
import {sha256} from '../sync/files.js';
import {isPng} from '../pdf-export.js';
import {bad} from './common.js';

export function register({handle, repo}) {
  // ---- 着せ替え（SPEC-KISEKAE.md）：テンプレートは値だけを持つ。保存のたびに normalizeTemplate を通す ----
  const templateExists = (tid) => isBuiltin(tid) || repo.listSkinTemplates().some((t) => t.id === tid);

  handle('skin.save', ({template}) => {
    const tid = template?.id && isUlid(template.id) && !isBuiltin(template.id) ? template.id : ulid();
    const prev = repo.listSkinTemplates().find((t) => t.id === tid);
    const t = normalizeTemplate({...template, author: template?.author ?? 'わたし'}, {id: tid});
    if (prev) t.createdAt = prev.createdAt;
    // 貼ったシールの画像の大きさは、シール帳の記録から入れる（書き出したファイルを読む側が使う）
    for (const sid of Object.keys(t.assets)) {
      const row = repo.get('sticker', sid);
      if (row) t.assets[sid] = {mime: 'image/png', w: row.w, h: row.h};
    }
    return {template: repo.saveSkinTemplate(t)};
  });

  handle('skin.remove', ({id: tid}) => {
    if (!isUlid(tid)) bad('はじめからあるテンプレートは消せません');
    if (repo.getSetting('skin.global', CLASSIC_ID) === tid) repo.setSetting('skin.global', CLASSIC_ID);
    repo.removeSkinTemplate(tid);
    return {ok: true};
  });

  // 当てる：テンプレートはアプリ全体で 1 つ（SPEC-KISEKAE §4.1）
  handle('skin.apply', ({templateId}) => {
    if (templateId != null && !templateExists(templateId)) bad('テンプレートが見つかりません');
    repo.setSetting('skin.global', templateId ?? CLASSIC_ID);
    return {ok: true};
  });

  handle('skin.recentColor', ({color}) => {
    if (!isHex(color)) bad('色が不正です');
    const list = [
      color.toLowerCase(),
      ...repo.getSetting('skin.recentColors', []).filter((c) => c !== color.toLowerCase())
    ].slice(0, 8);
    repo.setSetting('skin.recentColors', list);
    return {recent: list};
  });

  handle('skin.introduced', () => {
    repo.setSetting('skin.introduced', true);
    return {ok: true};
  });

  // シールの素：レンダラで長辺 512px 以内の PNG に描き直したもの（画像の中の付加情報を落とす）を受け取り、
  // アプリのデータの場所の stickers/<SHA-256>.png に置く。名前は中身から決まるので、同じ画像は 1 つになる
  const stickersDir = () => path.join(app.getPath('userData'), 'stickers');

  const stickerFile = (sid) => path.join(stickersDir(), `${sid}.png`);

  const isSha = (v) => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);

  handle('sticker.add', async ({bytes, shape}) => {
    const buf = bytes instanceof Uint8Array ? bytes : bad('画像が不正です');
    if (!isPng(buf) || buf.length > 2 * 1024 * 1024) bad('画像が不正です（PNG・2MB まで）');
    const w = (buf[16] << 24) | (buf[17] << 16) | (buf[18] << 8) | buf[19];
    const h = (buf[20] << 24) | (buf[21] << 16) | (buf[22] << 8) | buf[23];
    if (!(w >= 1 && w <= 512 && h >= 1 && h <= 512)) bad('画像の大きさが不正です（長辺 512px まで）');
    const sid = sha256(buf);
    await fsp.mkdir(stickersDir(), {recursive: true});
    await fsp.writeFile(stickerFile(sid), buf);
    if (!repo.get('sticker', sid))
      repo.insert('sticker', {
        id: sid,
        w,
        h,
        shape: SHAPES.includes(shape) ? shape : 'cut',
        favorite: 0,
        created_at: new Date().toISOString()
      });
    return {sticker: repo.get('sticker', sid)};
  });

  handle('sticker.update', ({id: sid, shape, favorite, folder}) => {
    if (!isSha(sid) || !repo.get('sticker', sid)) bad('シールが見つかりません');
    const patch = {};
    if (SHAPES.includes(shape)) patch.shape = shape;
    if (typeof favorite === 'boolean') patch.favorite = favorite ? 1 : 0;
    // シール帳のフォルダ分け（名前。空なら分けない）
    if (typeof folder === 'string')
      patch.folder =
        folder
          .replace(/[\u0000-\u001f]/g, '')
          .trim()
          .slice(0, 20) || null;
    repo.update('sticker', sid, patch);
    return {sticker: repo.get('sticker', sid)};
  });

  handle('sticker.remove', async ({id: sid}) => {
    if (!isSha(sid)) bad('シールが見つかりません');
    repo.remove('sticker', sid);
    await fsp.rm(stickerFile(sid), {force: true});
    return {ok: true};
  });

  // シールの画像（data: URL）。CSP で file:// を読まないので、ここから渡す
  handle('sticker.data', async ({ids}) => {
    const out = {};
    for (const sid of Array.isArray(ids) ? ids.slice(0, 200) : []) {
      if (!isSha(sid)) continue;
      const buf = await fsp.readFile(stickerFile(sid)).catch(() => null);
      if (buf) out[sid] = `data:image/png;base64,${buf.toString('base64')}`;
    }
    return {data: out};
  });
}
