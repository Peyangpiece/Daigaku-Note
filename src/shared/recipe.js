// 画面操作型レシピ（SPEC §6.13）の検査・式の解釈・URL の差し込み。DOM には触れない（実行器が Playwright で行う）。副作用なし。

/**
 * 式：  selector ( '@' attr )? ( ':' '/' regex '/' flags? )?
 *   selector … CSS セレクタ。空なら項目そのもの。先頭に歩き方を付けられる：
 *              '^tr' … 項目から closest('tr') へ上がる、'<' … 前の兄弟要素、'>' … 次の兄弟要素（続けて書ける。例 '^tr<' は「項目の行の 1 つ前の行」）
 *   attr     … 'text'（既定）| 'innertext'（見えている文字。改行あり）| 'html' | 属性名（href は絶対 URL に解決）
 *   regex    … 最初に値を持つキャプチャ群を値にする。合わなければ ''
 * 式は ' || ' で並べられる（parseFieldList）。左から順に試し、最初に値のあるものを使う。例 '@text || ^tr<@text'
 */
export function parseField(expr) {
  const s = String(expr ?? '').trim();
  const m = s.match(/^(.*?)(?:@([A-Za-z_:-][\w:-]*))?(?::\/(.+)\/([a-z]*))?$/s);
  if (!m) throw new Error(`式を読めません: ${expr}`);
  const [, rawSelector, rawAttr, re, flags] = m;
  let selector = rawSelector.trim();
  let attr = rawAttr;
  // '@href' だけの式（selector が空）を許す
  if (!attr && selector.startsWith('@')) {
    attr = selector.slice(1);
    selector = '';
  }
  return {selector, attr: attr || 'text', regex: re ? new RegExp(re, flags || '') : null};
}

/** ' || ' で並べた式を配列に。1 つなら長さ 1 */
export function parseFieldList(expr) {
  const parts = String(expr ?? '')
    .split(/\s\|\|\s/)
    .map((p) => p.trim());
  if (parts.some((p) => !p && parts.length > 1)) throw new Error(`空の式があります: ${expr}`);
  return parts.map(parseField);
}

/** 取り出した生の値に正規表現を当てる。regex がなければそのまま。群が複数あれば値のあるもの */
export function applyRegex(raw, field) {
  const v = String(raw ?? '').trim();
  if (!field.regex) return v;
  const m = v.match(field.regex);
  if (!m) return '';
  if (m.length === 1) return m[0];
  return (m.slice(1).find((g) => g !== undefined && g !== '') ?? '').trim();
}

/** URL テンプレートの差し込み：{base} {course.url} {course.lmsId} {round.url} {round.lmsRef} */
export function fillTemplate(template, vars) {
  return String(template ?? '').replace(/\{([a-zA-Z.]+)\}/g, (_, key) => {
    const v = key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), vars);
    return v == null ? '' : String(v);
  });
}

/** 相対 URL を絶対にする。できなければ '' */
export function resolveHref(href, base) {
  try {
    return new URL(href, base).toString();
  } catch {
    return '';
  }
}

/** ホストが許可一覧（ホスト名の完全一致か、そのサブドメイン）に入っているか */
export function hostAllowed(url, allowedHosts) {
  let host;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return allowedHosts.some((h) => {
    const a = String(h).toLowerCase();
    return host === a || host.endsWith('.' + a);
  });
}

const SECTION_FIELDS = {
  courses: ['items', 'name', 'link'],
  rounds: ['items', 'title'],
  files: ['items', 'link']
};

/** レシピの形を検査し、問題の一覧を返す（空なら OK） */
export function validateRecipe(r) {
  const errors = [];
  if (!r || typeof r !== 'object') return ['レシピがオブジェクトではありません'];
  if (!/^[a-z0-9-]{2,32}$/.test(String(r.id ?? ''))) errors.push('id は英小文字・数字・ハイフン 2〜32 文字');
  if (!r.name) errors.push('name がありません');
  if (!/^\d{4}\.\d{1,2}\.\d{1,3}$/.test(String(r.version ?? ''))) errors.push('version は 2026.10.1 の形');
  if (!r.detect || (!Array.isArray(r.detect.urlPatterns) && !Array.isArray(r.detect.htmlMarkers)))
    errors.push('detect.urlPatterns か detect.htmlMarkers が要ります');
  for (const p of r.detect?.urlPatterns ?? []) {
    try {
      new RegExp(p);
    } catch {
      errors.push(`detect.urlPatterns の正規表現が不正: ${p}`);
    }
  }
  if (!r.login || !r.login.loggedIn?.selector) errors.push('login.loggedIn.selector が要ります');
  if (r.login?.form && (!r.login.form.user || !r.login.form.password || !r.login.form.submit))
    errors.push('login.form には user・password・submit が要ります');
  if (r.login?.sso !== undefined && (typeof r.login.sso !== 'string' || !r.login.sso.trim()))
    errors.push('login.sso はセレクタの文字列');
  for (const [sec, fields] of Object.entries(SECTION_FIELDS)) {
    if (!r[sec]) {
      errors.push(`${sec} がありません`);
      continue;
    }
    if (!r[sec].url) errors.push(`${sec}.url がありません`);
    for (const f of fields) if (!r[sec][f]) errors.push(`${sec}.${f} がありません`);
    for (const [k, v] of Object.entries(r[sec])) {
      if (['url', 'openBeforeRead', 'items', 'container'].includes(k) || typeof v !== 'string') continue;
      try {
        parseFieldList(v);
      } catch (e) {
        errors.push(`${sec}.${k}: ${e.message}`);
      }
    }
    if ((r[sec].items === 'auto' || r[sec].openBeforeRead === 'auto') && !r[sec].container)
      errors.push(`${sec}: items や openBeforeRead を auto にするには container が要ります`);
  }
  for (const sec of ['notices']) {
    if (!r[sec] || typeof r[sec] !== 'object') continue;
    if (!r[sec].url || !r[sec].items) errors.push(`${sec} には url と items が要ります`);
    for (const [k, v] of Object.entries(r[sec])) {
      if (['url', 'openBeforeRead', 'items', 'container'].includes(k) || typeof v !== 'string') continue;
      try {
        parseFieldList(v);
      } catch (e) {
        errors.push(`${sec}.${k}: ${e.message}`);
      }
    }
    if ((r[sec].items === 'auto' || r[sec].openBeforeRead === 'auto') && !r[sec].container)
      errors.push(`${sec}: items や openBeforeRead を auto にするには container が要ります`);
  }
  for (const k of Object.keys(r)) {
    if (/^(script|code|eval|js)$/i.test(k)) errors.push(`レシピにコードは入れられません: ${k}`);
  }
  if (r.universities && typeof r.universities !== 'object') errors.push('universities はオブジェクト');
  return errors;
}

/** 大学別の上書きを適用したレシピを返す（host が universities の鍵に一致するとき） */
export function applyUniversityOverride(recipe, host) {
  const o = recipe.universities?.[String(host ?? '').toLowerCase()];
  if (!o) return recipe;
  const merged = structuredClone(recipe);
  for (const [sec, val] of Object.entries(o)) {
    if (val === null) merged[sec] = null;
    else if (typeof val === 'object' && typeof merged[sec] === 'object' && merged[sec]) Object.assign(merged[sec], val);
    else merged[sec] = val;
  }
  return merged;
}

/** URL と HTML から、このレシピの LMS である確からしさ（0〜1） */
export function detectScore(recipe, url, html = '') {
  let score = 0;
  for (const p of recipe.detect?.urlPatterns ?? []) if (new RegExp(p, 'i').test(url)) score = Math.max(score, 0.8);
  for (const m of recipe.detect?.htmlMarkers ?? [])
    if (html && html.includes(m)) score = Math.max(score, score ? 0.95 : 0.6);
  return score;
}
