// 印刷の窓（v0.27.14）：注釈を描き込んだ PDF を、プレビューを見ながら刷る。
// Electron の OS の印刷の窓には、プレビューがなく、ページ数も「全 1 ページ」と出る（刷る中身を並べる前に窓が出るため）。
// そこで、この窓でプレビュー（紙の上の並び）を見せ、プリンタ・部数・ページ・用紙・向き・1 枚に何ページ・カラー・両面を選んで、
// パソコン（main/ipc/pdf.js の print.run）が OS の窓を出さずに刷る。プレビューと紙は同じ割り付け（shared/print-layout.js）。
// 「詳細設定…」は、これまでの OS の印刷の窓（用紙の種類・品質など、プリンタごとの設定）
import {toast} from '../../ui-kit.js';
import {api} from './shared.js';
import {PAPERS, NUPS, layoutSheets, parsePages, sheetsHtml} from '../../../shared/print-layout.js';

/** 刷るときの画像の細かさ（dpi）。300 は文字がくっきりするが、ページが多いとメモリを食うので 200 に */
const PRINT_DPI = 200;
/** プレビューのページの画像の幅（px。窓の中で小さく見せるので、細かすぎなくてよい） */
const THUMB_PX = 640;
/** 前に選んだ設定を覚えておく（この利用者のこのパソコンだけ） */
const STORE = 'palette.print';

const DEFAULTS = {printer: '', paper: 'A4', orient: 'auto', nup: 1, color: true, duplex: 'simplex'};

function loadPrefs() {
  try {
    return {...DEFAULTS, ...JSON.parse(localStorage.getItem(STORE) ?? '{}')};
  } catch {
    return {...DEFAULTS};
  }
}
function savePrefs(p) {
  try {
    localStorage.setItem(STORE, JSON.stringify(p));
  } catch {
    // 保存できなくても刷れる
  }
}

/** ページを画像にする。type：'image/jpeg'（刷る）か 'image/png'。width を決めるか、dpi で決める */
async function renderPage(doc, num, {width = 0, dpi = 0, type = 'image/jpeg'} = {}) {
  const page = await doc.getPage(num);
  try {
    const vp1 = page.getViewport({scale: 1});
    const scale = width ? width / vp1.width : dpi / 72;
    const vp = page.getViewport({scale});
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(vp.width));
    canvas.height = Math.max(1, Math.round(vp.height));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({canvasContext: ctx, viewport: vp}).promise;
    const blob = await new Promise((ok) => canvas.toBlob(ok, type, 0.92));
    canvas.width = canvas.height = 0; // メモリをすぐ返す
    return blob;
  } finally {
    page.cleanup();
  }
}

const pct = (v, all) => `${((v / all) * 100).toFixed(3)}%`;

/**
 * 印刷の窓を開く。doc：pdf.js の文書（注釈を描き込んだもの）、close：閉じたあとの片付け（文書の task を壊す）。
 * 閉じたら（刷った・やめた）戻る
 */
export async function openPrintDialog({doc, name = '印刷', close: cleanup = () => {}}) {
  const total = doc.numPages;
  const sizes = [];
  for (let i = 1; i <= total; i++) {
    const page = await doc.getPage(i);
    const vp = page.getViewport({scale: 1});
    sizes.push({num: i, w: vp.width, h: vp.height});
    page.cleanup();
  }
  const prefs = loadPrefs();
  const d = document.createElement('dialog');
  d.className = 'print-dialog';
  d.innerHTML = `
    <div class="print-dialog__body">
      <div class="print-dialog__preview" aria-label="プレビュー"></div>
      <form class="print-dialog__side" method="dialog">
        <h2 class="print-dialog__title">印刷</h2>
        <p class="print-dialog__name"></p>
        <label>プリンタ<select class="input" name="printer"><option value="">いつものプリンタ</option></select></label>
        <label>部数<input class="input" name="copies" type="number" min="1" max="99" value="1"></label>
        <fieldset>
          <legend>ページ</legend>
          <label class="print-dialog__radio"><input type="radio" name="range" value="all" checked> すべて（${total} ページ）</label>
          <label class="print-dialog__radio"><input type="radio" name="range" value="some"> 指定
            <input class="input" name="pages" type="text" placeholder="例：1-3, 5" autocomplete="off" spellcheck="false"></label>
        </fieldset>
        <label>用紙<select class="input" name="paper">${Object.entries(PAPERS)
          .map(([k, p]) => `<option value="${k}">${p.label}（${p.w} × ${p.h} mm）</option>`)
          .join('')}</select></label>
        <label>向き<select class="input" name="orient">
          <option value="auto">自動（大きく刷れるほう）</option><option value="portrait">縦</option><option value="landscape">横</option>
        </select></label>
        <label>1 枚に<select class="input" name="nup">${NUPS.map((n) => `<option value="${n}">${n} ページ</option>`).join('')}</select></label>
        <label>色<select class="input" name="color"><option value="1">カラー</option><option value="0">白黒</option></select></label>
        <label>両面<select class="input" name="duplex">
          <option value="simplex">片面</option><option value="longEdge">両面（長い辺でとじる）</option><option value="shortEdge">両面（短い辺でとじる）</option>
        </select></label>
        <p class="print-dialog__sum" role="status"></p>
      </form>
    </div>
    <div class="print-dialog__foot">
      <button type="button" class="btn" data-print="system" title="OS の印刷の窓で、用紙の種類・品質などプリンタごとの設定を選ぶ">詳細設定…</button>
      <span class="print-dialog__spacer"></span>
      <button type="button" class="btn" data-print="cancel">キャンセル</button>
      <button type="button" class="btn btn--primary" data-print="go">プリント</button>
    </div>`;
  d.querySelector('.print-dialog__name').textContent = name;
  const form = d.querySelector('form');
  const f = form.elements;
  const preview = d.querySelector('.print-dialog__preview');
  const sum = d.querySelector('.print-dialog__sum');
  const goBtn = d.querySelector('[data-print="go"]');
  f.paper.value = PAPERS[prefs.paper] ? prefs.paper : 'A4';
  f.orient.value = prefs.orient;
  f.nup.value = String(prefs.nup);
  f.color.value = prefs.color ? '1' : '0';
  f.duplex.value = prefs.duplex;

  // プリンタの一覧（あとから入れる。前に選んだプリンタがあれば選び直す）
  api['print.printers']?.().then((list) => {
    for (const p of list ?? []) {
      const o = document.createElement('option');
      o.value = p.name;
      o.textContent = p.label;
      f.printer.append(o);
    }
    if ((list ?? []).some((p) => p.name === prefs.printer)) f.printer.value = prefs.printer;
  });

  const opts = () => ({
    printer: f.printer.value,
    paper: f.paper.value,
    orient: f.orient.value,
    nup: Number(f.nup.value),
    color: f.color.value === '1',
    duplex: f.duplex.value
  });
  const chosen = () => (f.range.value === 'some' ? parsePages(f.pages.value, total) : parsePages('', total));

  // ---- プレビュー：紙を並べ、見えてきたページから画像にする ----
  const thumbs = new Map(); // ページ番号 → 画像の URL（Promise）
  const thumb = (num) => {
    if (!thumbs.has(num))
      thumbs.set(
        num,
        renderPage(doc, num, {width: THUMB_PX}).then((b) => URL.createObjectURL(b))
      );
    return thumbs.get(num);
  };
  const seen = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        seen.unobserve(e.target);
        const img = e.target;
        thumb(Number(img.dataset.num))
          .then((url) => (img.src = url))
          .catch(() => {});
      }
    },
    {root: preview, rootMargin: '400px'}
  );
  let layout = null;
  const draw = () => {
    const pages = chosen();
    seen.disconnect();
    preview.replaceChildren();
    if (!pages) {
      layout = null;
      sum.textContent = 'ページの指定を読めません（例：1-3, 5）';
      sum.classList.add('is-error');
      goBtn.disabled = true;
      return;
    }
    const o = opts();
    layout = layoutSheets(
      pages.map((n) => sizes[n - 1]),
      o
    );
    preview.classList.toggle('is-gray', !o.color);
    layout.sheets.forEach((cells, i) => {
      const sheet = document.createElement('div');
      sheet.className = 'print-dialog__sheet';
      sheet.style.aspectRatio = `${layout.w} / ${layout.h}`;
      sheet.style.width = layout.landscape ? '100%' : `${((layout.w / layout.h) * 100).toFixed(2)}%`;
      for (const c of cells) {
        const img = document.createElement('img');
        img.alt = `${c.num} ページ`;
        img.dataset.num = String(c.num);
        Object.assign(img.style, {
          left: pct(c.x, layout.w),
          top: pct(c.y, layout.h),
          width: pct(c.w, layout.w),
          height: pct(c.h, layout.h)
        });
        sheet.append(img);
        seen.observe(img);
      }
      const no = document.createElement('span');
      no.className = 'print-dialog__no';
      no.textContent = `${i + 1} / ${layout.sheets.length}`;
      const wrap = document.createElement('figure');
      wrap.className = 'print-dialog__fig';
      wrap.append(sheet, no);
      preview.append(wrap);
    });
    const copies = Math.min(Math.max(Math.round(Number(f.copies.value) || 1), 1), 99);
    const n = layout.sheets.length;
    const both = o.duplex !== 'simplex';
    sum.classList.remove('is-error');
    sum.textContent = `${pages.length} ページ → ${PAPERS[o.paper].label}・${layout.landscape ? '横' : '縦'} ${n} 面${
      both ? `（紙 ${Math.ceil(n / 2)} 枚）` : ''
    }${copies > 1 ? ` × ${copies} 部` : ''}`;
    goBtn.disabled = false;
  };
  form.addEventListener('input', (e) => {
    if (e.target === f.pages) f.range.value = 'some';
    draw();
  });
  form.addEventListener('submit', (e) => e.preventDefault());

  /** 刷るページを細かい画像にする（ボタンに進み具合） */
  const renderAll = async (pages, btn) => {
    const out = [];
    for (const [i, n] of pages.entries()) {
      btn.textContent = `準備中 ${i + 1}/${pages.length}`;
      const blob = await renderPage(doc, n, {dpi: PRINT_DPI});
      out.push({num: n, w: sizes[n - 1].w, h: sizes[n - 1].h, blob});
    }
    return out;
  };

  let busy = false;
  const finish = () => {
    seen.disconnect();
    for (const p of thumbs.values()) p.then((u) => URL.revokeObjectURL(u)).catch(() => {});
    d.remove();
    cleanup();
  };
  const closed = new Promise((ok) => d.addEventListener('close', () => ok(), {once: true}));
  d.addEventListener('cancel', (e) => busy && e.preventDefault()); // 準備の途中で Esc を押しても閉じない
  d.querySelector('[data-print="cancel"]').addEventListener('click', () => !busy && d.close());

  // プリント：OS の窓を出さずに、選んだプリンタで刷る
  goBtn.addEventListener('click', async () => {
    const pages = chosen();
    if (!pages || busy) return;
    const o = opts();
    savePrefs(o);
    busy = true;
    d.classList.add('is-busy');
    try {
      const done = await renderAll(pages, goBtn);
      goBtn.textContent = 'プリンタへ送っています…';
      const r = await api['print.run']({
        pages: await Promise.all(
          done.map(async (p) => ({num: p.num, w: p.w, h: p.h, bytes: new Uint8Array(await p.blob.arrayBuffer())}))
        ),
        paper: o.paper,
        nup: o.nup,
        orient: o.orient,
        deviceName: o.printer,
        copies: Number(f.copies.value) || 1,
        color: o.color,
        duplex: o.duplex
      });
      if (r?.error) throw new Error(r.error);
      busy = false;
      d.close();
    } catch (e) {
      busy = false;
      toast(e.message || '印刷できませんでした', {error: true});
    } finally {
      d.classList.remove('is-busy');
      goBtn.textContent = 'プリント';
    }
  });

  // 詳細設定…：同じ割り付けの紙を隠した枠に並べて、OS の印刷の窓を出す（用紙の種類・品質などを選べる）
  d.querySelector('[data-print="system"]').addEventListener('click', async (e) => {
    const pages = chosen();
    if (!pages || busy) return;
    const o = opts();
    savePrefs(o);
    busy = true;
    const btn = e.currentTarget;
    try {
      const done = await renderAll(pages, btn);
      const urls = new Map(done.map((p) => [p.num, URL.createObjectURL(p.blob)]));
      busy = false;
      d.close();
      await printInFrame(
        sheetsHtml(layoutSheets(done, o), (n) => urls.get(n)),
        () => {
          for (const u of urls.values()) URL.revokeObjectURL(u);
        }
      );
    } catch (err) {
      busy = false;
      toast(`印刷できませんでした（${err.message}）`, {error: true});
    } finally {
      btn.textContent = '詳細設定…';
    }
  });

  document.body.append(d);
  draw();
  d.showModal();
  goBtn.focus();
  await closed;
  finish();
}

/** 画面に出さない枠（iframe）に紙を並べて、その枠の印刷を呼ぶ（OS の印刷の窓が出る）。done：刷り終えたあとの片付け */
export async function printInFrame(html, done = () => {}) {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.className = 'print-frame';
  Object.assign(frame.style, {position: 'fixed', width: '0', height: '0', border: '0', right: '0', bottom: '0'});
  document.body.append(frame);
  const w = frame.contentWindow;
  const doc = w.document;
  doc.open();
  doc.write(html);
  doc.close();
  await Promise.all(
    [...doc.images].map((img) => (img.complete ? null : new Promise((ok) => (img.onload = img.onerror = ok))))
  );
  let cleaned = false;
  const clean = () => {
    if (cleaned) return;
    cleaned = true;
    frame.remove();
    done();
  };
  w.addEventListener('afterprint', () => setTimeout(clean, 500), {once: true});
  setTimeout(clean, 10 * 60_000); // afterprint が来ないときの片付け
  w.focus();
  w.print();
}
