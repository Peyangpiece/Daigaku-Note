// 資料の本文（SPEC §11.4）。PDF・Word・PowerPoint・テキストからページごとの文字を取り、material_text に保存する（ハッシュが同じなら読み直さない）。
// クイズ生成に渡す本文はここでそろえる：PDF 版の優先、文字の取れない PDF の判定、ID・メール・電話の除去、30 万文字の上限。
import path from 'node:path';
import {readFile} from 'node:fs/promises';
import {inflateRawSync} from 'node:zlib';

export const MAX_CHARS = 300_000;
const TEXT_EXT = new Set(['pdf', 'docx', 'pptx', 'txt', 'md']);
export const extOf = (name) => path.extname(String(name)).slice(1).toLowerCase();
export const canExtract = (name) => TEXT_EXT.has(extOf(name));

/** ファイルからページごとの文字を取る。戻りは {method, pages: [{page, text}]} */
export async function extractPages(file) {
  const ext = extOf(file);
  if (ext === 'pdf') return {method: 'pdfjs', pages: await pdfPages(await readFile(file))};
  if (ext === 'docx') {
    const mammoth = (await import('mammoth')).default;
    const {value} = await mammoth.extractRawText({path: file});
    return {method: 'mammoth', pages: [{page: 1, text: value}]};
  }
  if (ext === 'pptx') return {method: 'pptx', pages: pptxPages(await readFile(file))};
  if (ext === 'txt' || ext === 'md') return {method: 'text', pages: [{page: 1, text: await readFile(file, 'utf8')}]};
  throw new Error(`この種類のファイルからは文字を取れません: .${ext}`);
}

async function pdfPages(data) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({
    data: new Uint8Array(data),
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
    verbosity: 0
  });
  const doc = await task.promise;
  const pages = [];
  try {
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const text = content.items.map((it) => (it.str ?? '') + (it.hasEOL ? '\n' : '')).join('');
      pages.push({page: i, text: text.replace(/[ \t]+\n/g, '\n').trim()});
      page.cleanup();
    }
  } finally {
    await task.destroy();
  }
  return pages;
}

/** pptx（zip）を読む。スライドごとに本文と、あればノート欄。ライブラリを足さず、zip の中央ディレクトリを読んで deflate を戻す */
export function pptxPages(buf) {
  const files = unzip(buf, (name) => /^ppt\/(slides\/slide|notesSlides\/notesSlide)\d+\.xml$/.test(name));
  const textOf = (xml) =>
    xml
      .split(/<\/a:p>/)
      .map((p) => [...p.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => decodeXml(m[1])).join(''))
      .filter((s) => s.trim())
      .join('\n');
  const slides = Object.keys(files)
    .map((n) => n.match(/^ppt\/slides\/slide(\d+)\.xml$/))
    .filter(Boolean)
    .map((m) => Number(m[1]))
    .sort((a, b) => a - b);
  return slides.map((n) => {
    const body = textOf(files[`ppt/slides/slide${n}.xml`]);
    const notes = files[`ppt/notesSlides/notesSlide${n}.xml`]
      ? textOf(files[`ppt/notesSlides/notesSlide${n}.xml`])
      : '';
    return {page: n, text: notes ? `${body}\n（ノート）${notes}` : body};
  });
}

const decodeXml = (s) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&');

/** 最小の zip 読み取り（格納・deflate だけ）。want(name) が true のものを {name: utf8 文字列} で返す */
export function unzip(buf, want) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('zip として読めません');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = {};
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('zip の目次が壊れています');
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    if (!want(name)) continue;
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, start + size);
    out[name] = (method === 0 ? raw : inflateRawSync(raw)).toString('utf8');
  }
  return out;
}

/** 文字の取れない PDF（ページあたり 20 文字未満のページが 8 割以上） */
export const looksScanned = (pages) =>
  pages.length > 0 && pages.filter((p) => p.text.replace(/\s/g, '').length < 20).length / pages.length >= 0.8;

/** AI に送る前に、学籍番号などの ID・メールアドレス・電話番号を消す（SPEC §11.4-6） */
export function scrub(text) {
  return String(text)
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '[メール]')
    .replace(/0\d{1,4}[-(（ ]\d{1,4}[-)） ]\d{3,4}/g, '[電話]')
    .replace(/[A-Za-z]\d{6,}/g, '[ID]')
    .replace(/\d{7,}/g, '[ID]');
}

/** 拡張子と「4up」などの印刷形式を除いた名前（同じ資料の PDF 版を見分ける） */
const baseKey = (name) =>
  path
    .basename(name, path.extname(name))
    .replace(/[\s_\-（(]*(\d+\s*up|配布用|印刷用|handout)[）)]?/gi, '')
    .trim()
    .toLowerCase();

/**
 * 回の資料から、クイズに使う本文をそろえる。
 * materials: material 行（path・name・sha256・status）。readCached(sha)・saveCache(sha, method, pages) で material_text を使う
 * 戻りは {docs: [{file, sha256, pages:[{page,text}]}], skipped: [{name, reason}], truncatedAt, chars}
 */
export async function collectText(materials, {readCached, saveCache, maxChars = MAX_CHARS} = {}) {
  const usable = materials.filter((m) => m.status === 'ok' && canExtract(m.name));
  const pdfKeys = new Set(usable.filter((m) => extOf(m.name) === 'pdf').map((m) => baseKey(m.name)));
  const docs = [];
  const skipped = [];
  for (const m of usable) {
    if (extOf(m.name) !== 'pdf' && pdfKeys.has(baseKey(m.name))) {
      skipped.push({name: m.name, reason: '同じ名前の PDF を使います'});
      continue;
    }
    let pages = readCached?.(m.sha256);
    if (!pages?.length) {
      try {
        const r = await extractPages(m.path);
        pages = r.pages;
        saveCache?.(m.sha256, r.method, pages);
      } catch (e) {
        skipped.push({name: m.name, reason: `読めませんでした（${e.message}）`});
        continue;
      }
    }
    if (looksScanned(pages)) {
      skipped.push({name: m.name, reason: '文字の入っていない（画像の）PDF です'});
      continue;
    }
    docs.push({
      file: m.name,
      sha256: m.sha256,
      pages: pages.map((p) => ({page: p.page, text: scrub(p.text)})).filter((p) => p.text.trim())
    });
  }
  // 上限：ページの前から詰める
  let chars = 0;
  let truncatedAt = null;
  for (const d of docs) {
    const kept = [];
    for (const p of d.pages) {
      if (chars + p.text.length > maxChars) {
        truncatedAt ??= {file: d.file, page: p.page};
        break;
      }
      chars += p.text.length;
      kept.push(p);
    }
    d.pages = kept;
  }
  return {docs: docs.filter((d) => d.pages.length), skipped, truncatedAt, chars};
}

/** 正規化（引用の照合用）：NFKC・空白と改行を除く・小文字 */
export const normalize = (s) =>
  String(s ?? '')
    .normalize('NFKC')
    .replace(/\s+/g, '')
    .toLowerCase();
