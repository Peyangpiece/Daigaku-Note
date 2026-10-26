// 画面の小さな部品（DOM だけに頼る。状態や経路は store.js）：エスケープ・日本語の折り返し・入力中の判定・窓（確認・入力・文章）・トースト。
// 画面（views/*）はここと store.js を読み、app.js（経路と全体の委譲）を読まない（循環 import をなくす）
export {esc} from '../shared/html.js';
export {jaWrap} from './ja-wrap.js';

/**
 * 文字を打っている最中か（入力欄・テキストエリア・選択肢・編集中の要素、日本語入力の変換中）。
 * 1 文字のショートカットは一切使わず、ショートカットは ⌘（Windows は Ctrl）＋キーだけにする。それでも打っている間は何も起こさない
 */
export const isTyping = (e) =>
  e.isComposing ||
  e.key === 'Process' ||
  !!e.target?.closest?.('input, textarea, select, [contenteditable]:not([contenteditable="false"])');

/** 同期の進み具合の文（ホーム・授業画面） */
export const progressText = (p) => (p ? `同期中 ${p.current}/${p.total}（${p.courseName}）` : '');

/**
 * 確認の窓（OS の confirm の代わり。アプリの見た目にそろえる）。戻りは「進む」を押したら true。
 * danger を付けると「進む」のボタンを危険の色にする。Esc・「やめる」で false
 */
export function confirmDialog(message, {ok = 'OK', cancel = 'やめる', danger = false} = {}) {
  return new Promise((resolve) => {
    const d = document.createElement('dialog');
    d.className = 'confirm-dialog';
    // 危ない操作（danger）は「やめる」に最初のフォーカス（Enter を続けて押しても消えないように）
    d.innerHTML = `<form method="dialog"><p></p><div class="confirm-dialog__foot"><button type="submit" class="btn" value="cancel"${danger ? ' autofocus' : ''}></button><button type="submit" class="btn ${danger ? 'btn--danger' : 'btn--primary'}" value="ok"${danger ? '' : ' autofocus'}></button></div></form>`;
    d.querySelector('p').textContent = message;
    d.querySelector('[value="cancel"]').textContent = cancel;
    d.querySelector('[value="ok"]').textContent = ok;
    d.addEventListener('close', () => {
      resolve(d.returnValue === 'ok');
      d.remove();
    });
    document.body.append(d);
    d.showModal();
  });
}

/**
 * 文字を 1 行入れる窓（OS の prompt の代わり。アプリの見た目にそろえる）。戻りは入れた文字。Esc・「やめる」なら null。
 * 入力欄で Enter を押したら「OK」（form の既定のボタンは「やめる」なので、自分で閉じる）
 */
export function promptDialog(
  message,
  {value = '', ok = 'OK', cancel = 'やめる', placeholder = '', maxlength = 60} = {}
) {
  return new Promise((resolve) => {
    const d = document.createElement('dialog');
    d.className = 'confirm-dialog';
    d.innerHTML = `<form method="dialog"><label><span></span><input class="input" type="text" autofocus></label><div class="confirm-dialog__foot"><button type="submit" class="btn" value="cancel"></button><button type="submit" class="btn btn--primary" value="ok"></button></div></form>`;
    d.querySelector('span').textContent = message;
    const input = d.querySelector('input');
    input.value = value;
    input.placeholder = placeholder;
    input.maxLength = maxlength;
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.isComposing) {
        e.preventDefault();
        d.close('ok');
      }
    });
    d.querySelector('[value="cancel"]').textContent = cancel;
    d.querySelector('[value="ok"]').textContent = ok;
    d.addEventListener('close', () => {
      resolve(d.returnValue === 'ok' ? input.value : null);
      d.remove();
    });
    document.body.append(d);
    d.showModal();
    input.select();
  });
}

/** 長い文章を読む窓（ライセンス・規約）。Esc か「閉じる」で閉じる */
export function textDialog(title, text) {
  const d = document.createElement('dialog');
  d.className = 'text-dialog';
  d.innerHTML = `<form method="dialog"><h3></h3><pre class="text-dialog__body"></pre><div class="confirm-dialog__foot"><button type="submit" class="btn btn--primary" autofocus>閉じる</button></div></form>`;
  d.querySelector('h3').textContent = title;
  d.querySelector('pre').textContent = text;
  d.addEventListener('close', () => d.remove());
  document.body.append(d);
  d.showModal();
}

// トースト：画面下に積む（重ねない）。失敗の知らせは長めに残し、押すか × で消える。読み上げは #toasts の role=status で
// action：{label, run}。知らせの中にボタンを出す（「元に戻す」など。押すと run して消える。知らせは長めに残す）
// detail：元の例外文など。ふだんは隠し、「くわしく」を押したときだけ下に出す（英語の例外をそのまま見せない。DESIGN-M0 §11）
// untilNavigate：画面を移ったら消す（更新の知らせなど、今の画面にいる間だけ見せたいもの）
export function toast(message, {error = false, action = null, detail = '', untilNavigate = false} = {}) {
  const box = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = `toast${error ? ' toast--error' : ''}`;
  if (untilNavigate) el.dataset.untilNavigate = '1';
  const text = document.createElement('span');
  text.className = 'toast__text';
  text.textContent = message;
  el.append(text);
  el.title = '押すと消えます';
  el.onclick = () => el.remove();
  const button = (label, run, cls = 'toast__action') => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = cls;
    b.textContent = label;
    b.onclick = (e) => {
      e.stopPropagation();
      run();
    };
    el.append(b);
    return b;
  };
  if (action)
    button(action.label, () => {
      el.remove();
      action.run();
    });
  if (detail) {
    const pre = document.createElement('pre');
    pre.className = 'toast__detail';
    pre.textContent = detail;
    pre.hidden = true;
    el.append(pre);
    const b = button('くわしく', () => {
      pre.hidden = !pre.hidden;
      b.textContent = pre.hidden ? 'くわしく' : 'たたむ';
      b.setAttribute('aria-expanded', String(!pre.hidden));
      clearTimeout(timer); // 読んでいる間は消さない
    });
    b.setAttribute('aria-expanded', 'false');
  }
  const close = button('×', () => el.remove(), 'toast__close');
  close.setAttribute('aria-label', '閉じる');
  if (detail) el.append(el.querySelector('.toast__detail')); // 本文は × より後ろ（2 段目いっぱい）に置く
  box.append(el);
  while (box.children.length > 3) box.firstElementChild.remove();
  const timer = setTimeout(() => el.remove(), error || action || detail ? 8000 : 4000);
}
/** 画面を移ったときに、untilNavigate の知らせを消す */
export function dismissNavigateToasts() {
  for (const el of document.querySelectorAll('#toasts [data-until-navigate]')) el.remove();
}
