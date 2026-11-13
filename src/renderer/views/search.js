// さがす（SPEC §8.1 ホームの検索）：資料の名前・本文・書き込んだ文字・回のメモを、授業をまたいで探す（main/search.js）。
// 探す言葉は画面の中に持つ（経路は #/search のまま。打つたびに経路を変えると、描き直しで入力の続きが切れる）
import {esc, jaWrap} from '../ui-kit.js';

const api = window.daigaku;
const POLL_MS = 1500; // まだ本文を読んでいる資料があるあいだ、探し直す間
const TYPE_MS = 200; // 打ち終わってから探すまで

const st = {q: '', result: null, seq: 0, timer: 0, poll: 0};

/** 探す言葉を決めて、さがす画面へ（ホームの検索欄から） */
export function searchFor(q) {
  st.q = String(q ?? '').slice(0, 200);
  st.result = null;
}
export const searchQuery = () => st.q;

const mark = (h) => `${esc(h.before)}<mark>${esc(h.match)}</mark>${esc(h.after)}`;

function resultsHtml(r) {
  if (!r) return '<p class="muted">さがしています…</p>';
  if (r.error) return `<p class="error-text">${esc(r.error)}</p>`;
  if (!r.terms.length)
    return '<p class="muted">資料の名前・本文・書き込んだ文字・回のメモを、授業をまたいでさがします。言葉を空白で区切ると、すべてを含むものをさがします。</p>';
  const reading = r.pending
    ? `<p class="muted search__reading" role="status">資料の本文を読んでいます（あと ${r.pending} 件）。読み終わると結果が増えます。</p>`
    : '';
  const none = !r.materials.length && !r.notes.length && !r.courses.length;
  if (none)
    return `${reading}<p class="search__none">「${esc(r.q.trim())}」は見つかりませんでした。${r.pending ? '' : '<span class="muted">写真だけの PDF（文字を選べない PDF）の中は、さがせません。</span>'}</p>`;
  const courses = r.courses.length
    ? `<section aria-labelledby="search-courses"><h3 class="search__sec" id="search-courses">授業・フォルダ</h3><ul class="search__chips">${r.courses
        .map(
          (c) =>
            `<li><button type="button" class="btn btn--small" data-action="open-course" data-id="${esc(c.id)}">${esc(c.name)}</button></li>`
        )
        .join('')}</ul></section>`
    : '';
  const q = encodeURIComponent(r.q.trim());
  const material = (m) => {
    const where = [m.courseName, m.round].filter(Boolean).join('・');
    // PDF は見つけたページを開いて、その言葉に印を付ける。ほかの種類はパソコンのアプリで開く
    const open = m.pdf
      ? `data-action="nav" data-route="/viewer/${esc(m.id)}?from=search&amp;find=${q}${m.hits[0] ? `&amp;page=${m.hits[0].page}` : ''}"`
      : `data-action="open-material" data-id="${esc(m.id)}"`;
    const hits = m.hits
      .map((h) => {
        const label = `${h.where === 'note' ? '書き込み' : '本文'}${m.pdf || h.page > 1 ? ` ${h.page} ページ` : ''}`;
        return m.pdf
          ? `<li><button type="button" class="search__hit" data-action="nav" data-route="/viewer/${esc(m.id)}?from=search&amp;find=${q}&amp;page=${h.page}"><span class="search__page">${esc(label)}</span><span class="search__snip">${mark(h)}</span></button></li>`
          : `<li class="search__hit search__hit--plain"><span class="search__page">${esc(label)}</span><span class="search__snip">${mark(h)}</span></li>`;
      })
      .join('');
    const rest = m.count - m.hits.length;
    return `<li class="search__item card">
        <button type="button" class="search__name" ${open}><strong>${jaWrap(m.name)}</strong><span class="muted">${esc(where)}</span></button>
        ${hits ? `<ul class="search__hits">${hits}</ul>` : ''}
        ${rest > 0 ? `<p class="muted search__rest">ほかに ${rest} か所</p>` : ''}
      </li>`;
  };
  const materials = r.materials.length
    ? `<section aria-labelledby="search-mats"><h3 class="search__sec" id="search-mats">資料 ${r.materials.length}${r.more ? ' 件以上' : ' 件'}</h3><ul class="search__list">${r.materials.map(material).join('')}</ul>${r.more ? '<p class="muted">多すぎるので、はじめの分だけ出しています。言葉を足してしぼってください。</p>' : ''}</section>`
    : '';
  const notes = r.notes.length
    ? `<section aria-labelledby="search-notes"><h3 class="search__sec" id="search-notes">回のメモ</h3><ul class="search__list">${r.notes
        .map(
          (n) =>
            `<li class="search__item card"><button type="button" class="search__name" data-action="open-course" data-id="${esc(n.courseId)}"><strong>${esc([n.courseName, n.round].filter(Boolean).join('・'))}</strong></button><p class="search__snip search__snip--note">${mark(n)}</p></li>`
        )
        .join('')}</ul></section>`
    : '';
  return `${reading}${courses}${materials}${notes}`;
}

export function renderSearch() {
  return `<nav class="page-nav"><button class="btn" data-action="nav" data-route="/">← ホーム</button><h2>さがす</h2></nav>
    <div class="search">
      <form class="search__bar" role="search" data-search-form="page">
        <input id="search-q" class="input search__input" type="search" name="q" maxlength="200" autocomplete="off"
          placeholder="資料の名前・本文・書き込みをさがす" aria-label="さがす言葉" value="${esc(st.q)}">
      </form>
      <div id="search-results" class="search__results" aria-live="polite">${resultsHtml(st.result ?? (st.q.trim() ? null : {terms: []}))}</div>
    </div>`;
}

async function run() {
  clearTimeout(st.poll);
  const seq = ++st.seq;
  const q = st.q;
  const box = () => document.getElementById('search-results');
  if (!q.trim()) {
    st.result = null;
    if (box()) box().innerHTML = resultsHtml({terms: []});
    return;
  }
  const r = await api['search.query']({q});
  if (seq !== st.seq || !box()) return; // 打ち直した・画面を離れた
  st.result = r;
  box().innerHTML = resultsHtml(r);
  // まだ本文を読んでいる資料がある：読み終わるまで、ときどき探し直す
  if (!r.error && r.pending) st.poll = setTimeout(run, POLL_MS);
}

/** さがす画面を描いたあと：欄に入れた言葉で探す。打つたびに少し待って探し直す */
export function mountSearch(view, {fresh}) {
  const input = view.querySelector('#search-q');
  if (!input) return;
  input.addEventListener('input', () => {
    st.q = input.value;
    clearTimeout(st.timer);
    st.timer = setTimeout(run, TYPE_MS);
  });
  view.querySelector('[data-search-form]').addEventListener('submit', (e) => {
    e.preventDefault();
    clearTimeout(st.timer);
    run();
  });
  if (fresh) {
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }
  run();
}

/** さがす画面を離れた：探し直しを止める */
export function leaveSearch() {
  clearTimeout(st.poll);
  clearTimeout(st.timer);
  st.seq++;
}
