// スマホのページの小さな部品：文字の逃がし・知らせ・下から出る窓・確かめ
export {esc} from '/m/shared/html.js';

/** 画面の下に短く知らせる。action（{label, run}）を渡すと、押せるボタンを添える（取り消しなど） */
export function toast(message, {error = false, action = null} = {}) {
  document.querySelector('.m-toast')?.remove();
  const t = document.createElement('div');
  t.className = `m-toast${error ? ' m-toast--error' : ''}`;
  t.setAttribute('role', 'status');
  const text = document.createElement('span');
  text.textContent = message;
  t.append(text);
  if (action) {
    const b = document.createElement('button');
    b.className = 'm-toast__action';
    b.textContent = action.label;
    b.onclick = () => {
      t.remove();
      action.run();
    };
    t.append(b);
  }
  document.body.append(t);
  setTimeout(() => t.remove(), error || action ? 5000 : 2500);
}

/**
 * 下から出る窓。html は中身、onReady(el, close) で中身に動きを付ける。閉じたら resolve（close に渡した値）
 */
export function sheet(html, onReady = () => {}) {
  return new Promise((resolve) => {
    const back = document.createElement('div');
    back.className = 'm-sheet-back';
    back.innerHTML = `<div class="m-sheet" role="dialog" aria-modal="true">${html}</div>`;
    const close = (v) => {
      back.remove();
      resolve(v);
    };
    back.addEventListener('click', (e) => e.target === back && close(null));
    document.body.append(back);
    onReady(back.querySelector('.m-sheet'), close);
  });
}

/** はい／いいえを聞く */
export const confirmSheet = (message, ok = 'OK') =>
  sheet(
    `<p class="m-sheet__msg"></p><div class="m-row"><button class="m-btn" data-v="no">やめる</button><button class="m-btn m-btn--primary" data-v="yes"></button></div>`,
    (el, close) => {
      el.querySelector('.m-sheet__msg').textContent = message;
      el.querySelector('[data-v="yes"]').textContent = ok;
      el.querySelector('[data-v="yes"]').onclick = () => close(true);
      el.querySelector('[data-v="no"]').onclick = () => close(false);
    }
  );
