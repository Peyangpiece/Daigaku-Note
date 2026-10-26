// IPC の窓口：着せ替えとシール（skin.*・sticker.*）。index.js が register を呼ぶ（SPEC §12・DESIGN-M0 §4）
import {dialog, app, nativeImage} from 'electron';
import {promises as fsp} from 'node:fs';
import path from 'node:path';
import {isUlid, ulid} from '../../shared/ids.js';
import {CLASSIC_ID, FORMAT, SHAPES, STICKER_MODES, isBuiltin, isHex, normalizeTemplate} from '../../shared/skin.js';
import {sha256} from '../sync/files.js';
import {isPng} from '../pdf-export.js';
import {id, bad} from './common.js';

export function register({handle, repo, getWindow}) {
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

  // 当てる：courseId があればその授業（templateId が null なら「全体と同じ」）、なければ全体
  handle('skin.apply', ({courseId, templateId, stickerMode}) => {
    if (templateId != null && !templateExists(templateId)) bad('テンプレートが見つかりません');
    if (courseId) {
      const cid = id(courseId) ?? bad('この授業は見つかりませんでした');
      const patch = {};
      if (templateId !== undefined) patch.skin_template_id = templateId ?? null;
      if (STICKER_MODES.includes(stickerMode)) patch.sticker_mode = stickerMode;
      return {course: repo.updateCourse(cid, patch)};
    }
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

  // ---- テンプレートの書き出し・読み込み（SPEC-KISEKAE §7）。1 つの JSON ファイル（.dnskin）に、テンプレートと
  // 取り込んだ画像（PNG・base64）をまとめる。読み込むときは画像を描き直して（付加情報を落とし、壊れた画像を弾く）シール帳に入れる ----
  handle('skin.export', async ({id: tid}) => {
    const t = repo.listSkinTemplates().find((x) => x.id === tid) ?? bad('テンプレートが見つかりません');
    const assetsData = {};
    for (const sid of Object.keys(t.assets ?? {})) {
      const buf = await fsp.readFile(stickerFile(sid)).catch(() => null);
      if (buf) assetsData[sid] = buf.toString('base64');
    }
    const safe = t.name.replace(/[\\/:*?"<>|]/g, '_').slice(0, 40) || 'テンプレート';
    const win = getWindow();
    const opts = {
      title: 'テンプレートを書き出す',
      defaultPath: path.join(app.getPath('documents'), `${safe}.dnskin`),
      filters: [{name: '大学ノートのテンプレート', extensions: ['dnskin']}]
    };
    const r = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
    if (r.canceled || !r.filePath) return {ok: false};
    await fsp.writeFile(r.filePath, JSON.stringify({...t, assetsData}, null, 2));
    return {ok: true, name: path.basename(r.filePath)};
  });

  handle('skin.import', async () => {
    const win = getWindow();
    const opts = {
      title: 'テンプレートを読み込む',
      properties: ['openFile'],
      filters: [{name: '大学ノートのテンプレート', extensions: ['dnskin', 'json']}]
    };
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    if (r.canceled || !r.filePaths?.[0]) return {ok: false};
    const stat = await fsp.stat(r.filePaths[0]);
    if (stat.size > 20 * 1024 * 1024) bad('ファイルが大きすぎます（20MB まで）');
    let raw;
    try {
      raw = JSON.parse(await fsp.readFile(r.filePaths[0], 'utf8'));
    } catch {
      bad('テンプレートのファイルとして読めませんでした');
    }
    if (raw?.format !== FORMAT) bad('大学ノートのテンプレートではありません');
    normalizeTemplate(raw); // 形と版を先に確かめる（新しすぎる版はここで断る）
    // 画像を描き直してシール帳に入れる。中身から名前（SHA-256）が決まるので、名前を付け替える
    const renamed = {};
    await fsp.mkdir(stickersDir(), {recursive: true});
    for (const [old, b64] of Object.entries(raw.assetsData ?? {}).slice(0, 60)) {
      if (!isSha(old) || typeof b64 !== 'string') continue;
      const buf = Buffer.from(b64, 'base64');
      if (!isPng(buf) || buf.length > 2 * 1024 * 1024) continue;
      let img = nativeImage.createFromBuffer(buf);
      if (img.isEmpty()) continue;
      const {width, height} = img.getSize();
      if (Math.max(width, height) > 512) img = img.resize(width >= height ? {width: 512} : {height: 512});
      const png = img.toPNG();
      const sid = sha256(png);
      await fsp.writeFile(stickerFile(sid), png);
      const size = img.getSize();
      if (!repo.get('sticker', sid))
        repo.insert('sticker', {
          id: sid,
          w: size.width,
          h: size.height,
          shape: 'cut',
          favorite: 0,
          created_at: new Date().toISOString()
        });
      renamed[old] = sid;
    }
    // 画像のないシールは捨てる（はじめから入っているシールと、もうシール帳にある画像はそのまま）
    const fix = (sid) => (isSha(sid) ? (renamed[sid] ?? (repo.get('sticker', sid) ? sid : null)) : sid);
    const stickers = (Array.isArray(raw.stickers) ? raw.stickers : [])
      .map((s) => ({...s, asset: fix(s?.asset)}))
      .filter((s) => s.asset);
    const tape = {...(raw.parts?.tape ?? {}), image: raw.parts?.tape?.image ? fix(raw.parts.tape.image) : null};
    // 同じ識別番号の自作テンプレートがあれば、置き換えるか別のものとして加えるかを選ぶ
    let tid = isUlid(raw.id) && !isBuiltin(raw.id) ? raw.id : ulid();
    if (repo.listSkinTemplates().some((t) => t.id === tid)) {
      const box = {
        type: 'question',
        message: `「${String(raw.name ?? '').slice(0, 40)}」と同じテンプレートがすでにあります`,
        detail: '置き換えると、それを使っている授業の見た目も変わります。',
        buttons: ['置き換える', '別のものとして加える', 'やめる'],
        defaultId: 1,
        cancelId: 2
      };
      const {response} = win ? await dialog.showMessageBox(win, box) : await dialog.showMessageBox(box);
      if (response === 2) return {ok: false};
      if (response === 1) tid = ulid();
    }
    const t = normalizeTemplate({...raw, parts: {...raw.parts, tape}, stickers}, {id: tid});
    for (const sid of Object.keys(t.assets)) {
      const row = repo.get('sticker', sid);
      if (row) t.assets[sid] = {mime: 'image/png', w: row.w, h: row.h};
    }
    return {ok: true, template: repo.saveSkinTemplate(t)};
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
