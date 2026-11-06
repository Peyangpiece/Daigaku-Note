// ログインのフォームを見つける（SPEC §6.4 の「次回から自動でログイン」）。統合認証のページはレシピにセレクタを書けないので、
// パスワード欄と、その手前の ID 欄を画面から探す。ID だけを先に聞く 2 段階のページにも合わせる。
// 見つけた欄には data-dn-login 属性で印を付け、呼ぶ側はその印で入力・送信する。

/** Google・Microsoft のログインには入力しない（規約・2 段階認証の都合。SPEC §6.4） */
export const NO_AUTOFILL_HOSTS = [
  'accounts.google.com',
  'login.microsoftonline.com',
  'login.live.com',
  'login.microsoft.com'
];

export const noAutofillHost = (host) => NO_AUTOFILL_HOSTS.some((h) => host === h || host.endsWith('.' + h));

// 日本の属性型の第 2 レベル（ac.jp・co.jp など）。この下の 1 つまでを「同じ組織のドメイン」とみなす
const JP_SECOND = new Set(['ac', 'co', 'or', 'ne', 'go', 'ed', 'lg', 'gr', 'ad']);
// 日本以外で「国 + 種類」の 2 段が公共の接尾辞になっている国（ac.uk・com.au など）。この下の 1 つまでを「同じ組織」とみなす。
// これがないと lms.example.ac.uk の組織が ac.uk になり、英国の大学すべてが同じ組織に見えてしまう
const SECOND_LEVEL = new Set([
  'uk',
  'au',
  'nz',
  'kr',
  'tw',
  'cn',
  'hk',
  'sg',
  'my',
  'th',
  'in',
  'id',
  'ph',
  'vn',
  'br',
  'ar',
  'mx',
  'za',
  'il',
  'tr'
]);
const COMMON_SECOND = new Set([
  'ac',
  'co',
  'com',
  'edu',
  'gov',
  'org',
  'net',
  'or',
  'ne',
  'go',
  'sch',
  'ltd',
  'plc',
  'nhs',
  'police'
]);
const LOCAL = new Set(['localhost', '127.0.0.1']);
/** 組織のドメイン（lms.example-u.ac.jp → example-u.ac.jp、lms.example.edu → example.edu、lms.example.ac.uk → example.ac.uk） */
export function siteOf(host) {
  const h = String(host ?? '').toLowerCase();
  if (LOCAL.has(h) || /^\d+(\.\d+){3}$/.test(h)) return h;
  const p = h.split('.').filter(Boolean);
  const second = p.at(-1) === 'jp' ? JP_SECOND : SECOND_LEVEL.has(p.at(-1)) ? COMMON_SECOND : null;
  const n = p.length >= 3 && second?.has(p.at(-2)) ? 3 : 2;
  return p.slice(-n).join('.');
}
/**
 * 保存した ID・パスワードを入れてよいページか。https（手元の試験用の localhost は除く）で、
 * LMS と同じ組織のドメイン（大学の統合認証など）か、レシピに書いたホストだけ。
 * 一度訪れただけのホストや、大学と関係のないページには入れない
 */
export function credentialUrlAllowed(url, {base, hosts = []} = {}) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  const host = u.hostname.toLowerCase();
  if (u.protocol !== 'https:' && !LOCAL.has(host)) return false;
  if (noAutofillHost(host)) return false;
  const baseHost = (() => {
    try {
      return new URL(base).hostname.toLowerCase();
    } catch {
      return String(base ?? '').toLowerCase();
    }
  })();
  if (!baseHost) return false;
  if (host === baseHost || siteOf(host) === siteOf(baseHost)) return true;
  return hosts.some((h) => host === h || host.endsWith('.' + h));
}

/**
 * 統合認証（Shibboleth の IdP）の「過去のリクエスト（Stale Request）」の画面か（v0.16.31）。
 * 同じログインの要求をもう一度送った（戻る・再読み込み・古い要求）ときに IdP が出す。アカウントの制限ではなく、
 * LMS の最初のページからログインをやり直せば通る。url は IdP のページ（/idp/ を含む）、text は画面の文字
 */
export function staleSsoPage(url, text) {
  let path = '';
  try {
    path = new URL(url).pathname;
  } catch {
    return false;
  }
  return /\/idp\//i.test(path) && /過去のリクエスト|Stale Request/i.test(String(text ?? ''));
}

/**
 * ページの中で欄を探して印を付ける（Playwright の page.evaluate に渡すので、外の変数を使わない）。
 * 返り値：{user, password, submit, extra, code, filledUser, filledPassword}
 *   user / password / submit：見つけたか。extra：ID・パスワード以外に入力が要りそうな欄（認証コード・検索欄など）があるか。
 *   code：空の認証コード・ワンタイムパスワードの欄があるか
 */
export function markLoginForm() {
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const s = window.getComputedStyle(el);
    return (
      r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && !el.disabled && !el.readOnly
    );
  };
  for (const el of document.querySelectorAll('[data-dn-login]')) el.removeAttribute('data-dn-login');
  const textLike = (el) => ['text', 'email', 'tel', ''].includes((el.getAttribute('type') ?? '').toLowerCase());
  const hints = (el) =>
    `${el.name} ${el.id} ${el.getAttribute('autocomplete') ?? ''} ${el.getAttribute('placeholder') ?? ''} ${el.getAttribute('aria-label') ?? ''}`;
  // 認証コード・ワンタイムパスワードの欄は ID の欄と取り違えない（本人が入れる。SPEC §6.4）
  const codeHint = (el) =>
    /code|otp|one-?time|token|\bpin\b|認証コード|確認コード|ワンタイム/i.test(hints(el)) ||
    el.getAttribute('autocomplete') === 'one-time-code';
  const userHint = (el) =>
    !codeHint(el) && /user|login|account|mail|uid|(^|[\s_-])id(\s|$)|学籍|ユーザ|アカウント/i.test(hints(el));
  const inputs = [...document.querySelectorAll('input')].filter(visible);
  const password = inputs.find((el) => el.type === 'password');
  const scope = password?.form ?? document;
  const texts = inputs.filter((el) => textLike(el) && scope.contains(el));
  let user = null;
  if (password) {
    // パスワード欄より前にある文字の欄のうち、ID らしいもの。なければ直前の欄
    const before = texts.filter((el) => el.compareDocumentPosition(password) & window.Node.DOCUMENT_POSITION_FOLLOWING);
    user = before.find(userHint) ?? before.filter((el) => !codeHint(el)).at(-1) ?? null;
  } else {
    // ID だけを先に聞くページ：ID らしい名前の欄があるときだけ（1 つしかない欄を当て推量で ID とみなさない）
    user = texts.find(userHint) ?? null;
  }
  const form = (password ?? user)?.form ?? null;
  // 押すボタン：「ログイン」「次へ」などと書いたものを先に。言語の切り替え・戻る・入力し直すなどは押さない
  // （type を書かない <button> は送信のボタンになるので、言語の「日本語」が先に見つかって止まっていた。v0.17.6）
  const label = (b) => `${b.textContent ?? ''} ${b.value ?? ''} ${b.getAttribute('aria-label') ?? ''}`.trim();
  const goWord = /ログイン|サインイン|次へ|送信|login|log\s*in|sign\s*in|next|continue|submit/i;
  const notGo =
    /言語|language|日本語|english|戻る|back|キャンセル|cancel|入力し直す|やり直|忘れ|forgot|設定|help|ヘルプ|表示|show|登録|sign\s*up/i;
  const pick = (root) => {
    const all = [
      ...root.querySelectorAll(
        'button, input[type=submit], input[type=image], input[type=button], [role=button], a[href^="javascript"], a[href="#"]'
      )
    ].filter((b) => visible(b) && !notGo.test(label(b)));
    return (
      all.find((b) => goWord.test(label(b))) ??
      all.find((b) => b.tagName !== 'A' && (b.type === 'submit' || (b.tagName === 'INPUT' && b.type === 'image'))) ??
      null
    );
  };
  const submit = (form && pick(form)) ?? (password || user ? pick(document) : null);
  const extra = inputs.some(
    (el) => el !== user && el !== password && (textLike(el) || el.type === 'number') && !el.value
  );
  const code = inputs.some((el) => el !== user && el !== password && !el.value && codeHint(el));
  if (user) user.setAttribute('data-dn-login', 'user');
  if (password) password.setAttribute('data-dn-login', 'password');
  if (submit) submit.setAttribute('data-dn-login', 'submit');
  return {
    user: !!user,
    password: !!password,
    submit: !!submit,
    extra,
    code,
    filledUser: !!user?.value,
    filledPassword: !!password?.value
  };
}
