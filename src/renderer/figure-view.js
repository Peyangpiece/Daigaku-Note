// 素材の図を画面に出す・書き換える（SPEC §9.9）。PDF の編集画面（viewer.js）と、クイズ・ホームの机（desk.js）で使う。
// - 図は SVG（文字なし）の上に、文字の層（span）を重ねる。文字の大きさは図の幅に合わせて変わる（CSS の cqw）
// - 書き換え（openFigureEditor）：図の横に小さな窓を出し、決め事（水の量・グラフの式など）を変える。
//   図の上の何もない所を押すと文字を足し（辺の長さ・角度など）、文字を押すと書き換え、ドラッグで動かせる。空にすると消える
import {
  activeParams,
  cleanLabels,
  cleanParams,
  defaultLabels,
  figureOf,
  figureSvg,
  formulaOf,
  labelSize
} from '../shared/figures.js';

import {esc} from '../shared/html.js';

/** 図の文字（書き換えていなければ、決め事に合わせた既定の文字） */
const figureLabels = (style) => style.labels ?? defaultLabels(style.ref, style.params);

/** el の中に図を描く。style は {ref, params?, labels?} */
export function renderFigure(el, style) {
  const f = figureOf(style.ref);
  if (!f) return;
  el.classList.add('fig');
  el.style.setProperty('--fig-w', String(f.w));
  el.innerHTML = `${figureSvg(style.ref, style.params, false).replace('<svg ', '<svg class="fig__svg" preserveAspectRatio="none" ')}<div class="fig__labels"></div>`;
  renderLabels(el, figureLabels(style));
}
function renderLabels(el, labels) {
  el.querySelector('.fig__labels').innerHTML = labels
    .map(
      (l, i) =>
        `<span class="fig__label${l.m ? ' is-math' : ''}" data-i="${i}" style="left: ${(l.x * 100).toFixed(2)}%; top: ${(l.y * 100).toFixed(2)}%; --s: ${labelSize(l)}">${esc(l.t)}</span>`
    )
    .join('');
}

const fieldHtml = (s, v) => {
  if (s.type === 'select')
    return `<label class="fig-ed__field"><span>${esc(s.label)}</span><select data-p="${s.key}">${s.options
      .map(([o, l]) => `<option value="${esc(o)}"${o === v ? ' selected' : ''}>${esc(l)}</option>`)
      .join('')}</select></label>`;
  if (s.type === 'range')
    return `<label class="fig-ed__field"><span>${esc(s.label)}<output>${v}${s.unit ?? ''}</output></span><input type="range" data-p="${s.key}" min="${s.min}" max="${s.max}" step="${s.step}" value="${v}" /></label>`;
  return `<label class="fig-ed__field fig-ed__field--num"><span>${esc(s.label)}</span><input type="number" data-p="${s.key}" min="${s.min}" max="${s.max}" step="${s.step}" value="${v}" /></label>`;
};

/**
 * 図を書き換える。host：窓を入れる要素。el：図の要素（renderFigure したもの）。style：今の図の中身。
 * onChange(style)：書き換えるたびに呼ぶ（使う側が保存する）。onClose(style)：閉じたとき（取り消しの 1 手にまとめる）。
 * focus：'formula' なら式の入力から始める（放物線を押したとき・右クリック）。戻りは {close}
 */
export function openFigureEditor({host, el, style, onChange, onClose, focus = null}) {
  const f = figureOf(style.ref);
  if (!f) return null;
  let cur = {...style, params: cleanParams(style.ref, style.params)};
  const panel = document.createElement('div');
  panel.className = 'fig-ed float-tool';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', `${f.name}を書き換える`);
  const formula = () => (f.params.some((s) => s.key === 'fn') ? formulaOf(cur.params) : '');
  const draw = () => {
    const fields = activeParams(f, cur.params)
      .map((s) => fieldHtml(s, cur.params[s.key]))
      .join('');
    const fx = formula();
    panel.innerHTML = `<div class="float-tool__head"><strong>${esc(f.name)}</strong><button type="button" class="float-tool__close" data-fe="done" aria-label="閉じる" title="閉じる（Esc）">×</button></div>
      ${fields ? `<div class="fig-ed__fields">${fields}</div>` : ''}
      ${fx ? `<p class="fig-ed__formula">${esc(fx)}</p>` : ''}
      <p class="fig-ed__hint">図の上の何もない所を押すと文字を足せます（辺の長さ・高さ・角度など）。文字を押すと書き換え、ドラッグで動かせます。空にすると消えます</p>
      <div class="fig-ed__foot"><button type="button" class="btn btn--small" data-fe="reset" title="文字を最初の形に戻す">文字を元に戻す</button><button type="button" class="btn btn--small btn--primary" data-fe="done">完了</button></div>`;
  };
  draw();
  host.append(panel);
  // 図の横（入らなければ左）に出す
  const place = () => {
    const r = el.getBoundingClientRect();
    const w = panel.offsetWidth,
      h = panel.offsetHeight;
    const vw = document.documentElement.clientWidth;
    let left = r.right + 12;
    if (left + w > vw - 8) left = Math.max(8, r.left - w - 12);
    const top = Math.min(Math.max(8, r.top), window.innerHeight - h - 8);
    Object.assign(panel.style, {left: `${left}px`, top: `${top}px`});
  };
  place();

  const emit = () => onChange({...cur});
  const labelsNow = () => cur.labels ?? figureLabels(cur);
  const setLabels = (labels, redraw = true) => {
    cur = {...cur, labels: cleanLabels(labels)};
    if (redraw) renderLabels(el, labelsNow());
    emit();
  };
  const setParam = (key, raw, s) => {
    const v = s.type === 'select' ? raw : Number(raw);
    if (s.type !== 'select' && !Number.isFinite(v)) return;
    const before = activeParams(f, cur.params)
      .map((x) => x.key)
      .join();
    cur = {...cur, params: cleanParams(cur.ref, {...cur.params, [key]: v})};
    renderFigure(el, cur); // 書き換えた文字はそのまま、既定の文字は決め事に合わせて出し直す
    markEditing();
    emit();
    // 式の種類を変えたら、入れる項目を出し直す
    if (
      activeParams(f, cur.params)
        .map((x) => x.key)
        .join() !== before
    ) {
      draw();
      place();
    } else {
      const out = panel.querySelector(`[data-p="${key}"]`)?.closest('label')?.querySelector('output');
      if (out) out.textContent = `${cur.params[key]}${s.unit ?? ''}`;
      const fx = panel.querySelector('.fig-ed__formula');
      if (fx) fx.textContent = formula();
    }
  };
  panel.addEventListener('input', (e) => {
    const key = e.target.dataset.p;
    const s = key && activeParams(f, cur.params).find((x) => x.key === key);
    if (s) setParam(key, e.target.value, s);
  });
  panel.addEventListener('change', (e) => {
    const key = e.target.dataset.p;
    const s = key && activeParams(f, cur.params).find((x) => x.key === key);
    if (s) {
      setParam(key, e.target.value, s);
      e.target.value = cur.params[key]; // 範囲に収めた値を見せる
    }
  });
  panel.addEventListener('click', (e) => {
    const b = e.target.closest('[data-fe]');
    if (!b) return;
    if (b.dataset.fe === 'reset') {
      cur = {...cur};
      delete cur.labels;
      renderLabels(el, figureLabels(cur));
      markEditing();
      emit();
    } else close();
  });

  // ---- 図の上：文字を押すと書き換え、ドラッグで動かす。何もない所を押すと文字を足す ----
  const markEditing = () => {
    el.classList.add('is-editing');
    for (const s of el.querySelectorAll('.fig__label')) {
      s.contentEditable = 'plaintext-only';
      s.spellcheck = false;
    }
  };
  markEditing();
  const commitText = (span) => {
    const labels = labelsNow().map((l) => ({...l}));
    const i = Number(span.dataset.i);
    if (!labels[i]) return;
    labels[i].t = span.textContent.replace(/[\r\n]+/g, ' ').trim();
    setLabels(labels.filter((l) => l.t)); // 空にした文字は消す
    markEditing();
  };
  const onDown = (e) => {
    e.stopPropagation(); // 書き換えている間は、図を動かさない（ページの操作にしない）
    if (e.button !== 0) return;
    const span = e.target.closest('.fig__label');
    const box = el.getBoundingClientRect();
    if (!span) {
      // 何もない所：そこに文字を足して、すぐ打てるようにする
      e.preventDefault();
      document.activeElement?.blur?.();
      const labels = [
        ...labelsNow(),
        {x: (e.clientX - box.left) / box.width, y: (e.clientY - box.top) / box.height, t: '　'}
      ];
      cur = {...cur, labels};
      renderLabels(el, labels);
      markEditing();
      const s = el.querySelector(`.fig__label[data-i="${labels.length - 1}"]`);
      s.focus();
      window.getSelection()?.selectAllChildren(s);
      return;
    }
    // 文字：動かせば位置を変え、動かさなければそのまま書き換え（カーソルを置く）
    const sx = e.clientX,
      sy = e.clientY;
    let moved = false;
    const move = (ev) => {
      if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 4) return;
      if (!moved) span.blur();
      moved = true;
      span.style.left = `${(((ev.clientX - box.left) / box.width) * 100).toFixed(2)}%`;
      span.style.top = `${(((ev.clientY - box.top) / box.height) * 100).toFixed(2)}%`;
    };
    const up = (ev) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (!moved) return;
      const labels = labelsNow().map((l) => ({...l}));
      const i = Number(span.dataset.i);
      if (labels[i]) {
        labels[i].x = (ev.clientX - box.left) / box.width;
        labels[i].y = (ev.clientY - box.top) / box.height;
        setLabels(labels);
        markEditing();
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const onBlur = (e) => {
    const span = e.target.closest?.('.fig__label');
    if (span) commitText(span);
  };
  const onKey = (e) => {
    e.stopPropagation(); // 文字を打っている間は、ページのショートカットにしない
    if (e.key === 'Enter') {
      e.preventDefault();
      e.target.blur?.();
    } else if (e.key === 'Escape') {
      e.target.blur?.();
      close();
    }
  };
  const onOutside = (e) => {
    if (!el.contains(e.target) && !panel.contains(e.target)) close();
  };
  const onDocKey = (e) => e.key === 'Escape' && !e.target.closest?.('.fig') && close();
  el.addEventListener('pointerdown', onDown);
  el.addEventListener('focusout', onBlur);
  el.addEventListener('keydown', onKey);
  document.addEventListener('pointerdown', onOutside, true);
  document.addEventListener('keydown', onDocKey);

  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    const active = document.activeElement;
    if (active && el.contains(active)) active.blur(); // 打ちかけの文字を残す
    el.removeEventListener('pointerdown', onDown);
    el.removeEventListener('focusout', onBlur);
    el.removeEventListener('keydown', onKey);
    document.removeEventListener('pointerdown', onOutside, true);
    document.removeEventListener('keydown', onDocKey);
    el.classList.remove('is-editing');
    for (const s of el.querySelectorAll('.fig__label')) s.contentEditable = 'false';
    panel.remove();
    onClose?.({...cur});
  }
  if (focus === 'formula') panel.querySelector('[data-p="fn"]')?.focus();
  return {close, panel};
}
