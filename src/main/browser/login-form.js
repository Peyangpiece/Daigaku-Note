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
  const buttons = [...(form ?? document).querySelectorAll('button, input[type=submit], input[type=image]')].filter(
    visible
  );
  const submit =
    buttons.find((b) => (b.type ?? '').toLowerCase() === 'submit' || b.tagName === 'INPUT') ??
    buttons.find((b) =>
      /ログイン|サインイン|次へ|login|sign\s*in|next|continue|submit/i.test(b.textContent ?? b.value ?? '')
    ) ??
    null;
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
