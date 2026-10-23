// 電卓（編集画面のポーチ）の計算。式の文字列を読んで値を出す。eval は使わない。副作用なし。
// 使えるもの：数（小数）・＋ − × ÷（+ - * / も）・^（累乗。右から）・( )・%（百分の一）・√（平方根）・π
// 「2π」「3(4+5)」のように、数・π・√・( が続けば掛け算とみる。−2^2 は −(2^2) = −4（数学の約束どおり）
// 結果は 12 桁に丸める（0.1 + 0.2 が 0.30000000000000004 にならないように）

const OPS = {
  '+': '+',
  '-': '-',
  '−': '-',
  '*': '*',
  '×': '*',
  '/': '/',
  '÷': '/',
  '^': '^',
  '%': '%',
  '(': '(',
  ')': ')'
};

/** 式を字句に分ける。読めない文字があれば Error */
export function tokenize(src) {
  const out = [];
  const s = String(src).replace(/\s+/g, '');
  for (let i = 0; i < s.length; ) {
    const c = s[i];
    const num = /^(\d+\.?\d*|\.\d+)/.exec(s.slice(i));
    if (num) {
      out.push({type: 'num', value: Number(num[1])});
      i += num[1].length;
    } else if (c === 'π') {
      out.push({type: 'num', value: Math.PI});
      i++;
    } else if (c === '√') {
      out.push({type: 'sqrt'});
      i++;
    } else if (OPS[c]) {
      out.push({type: OPS[c]});
      i++;
    } else throw new Error(`「${c}」は使えません`);
  }
  return out;
}

/** 式を計算する。戻りは数。式が正しくなければ Error（メッセージは画面に出す） */
export function evaluate(src) {
  const tokens = tokenize(src);
  if (!tokens.length) throw new Error('式がありません');
  let i = 0;
  const peek = () => tokens[i]?.type;
  const starts = (t) => t === 'num' || t === 'sqrt' || t === '(';
  // 和・差
  const expr = () => {
    let v = term();
    while (peek() === '+' || peek() === '-') v = tokens[i++].type === '+' ? v + term() : v - term();
    return v;
  };
  // 積・商（数・π・√・( が続けば掛け算）
  const term = () => {
    let v = unary();
    for (;;) {
      if (peek() === '*') {
        i++;
        v *= unary();
      } else if (peek() === '/') {
        i++;
        const d = unary();
        if (d === 0) throw new Error('0 では割れません');
        v /= d;
      } else if (starts(peek())) v *= power();
      else return v;
    }
  };
  // 符号（累乗より弱い：−2^2 = −4）
  const unary = () => {
    if (peek() === '-') {
      i++;
      return -unary();
    }
    if (peek() === '+') {
      i++;
      return unary();
    }
    return power();
  };
  // 累乗（右から：2^3^2 = 2^9）
  const power = () => {
    const base = postfix();
    if (peek() !== '^') return base;
    i++;
    return base ** unary();
  };
  const postfix = () => {
    let v = primary();
    while (peek() === '%') {
      i++;
      v /= 100;
    }
    return v;
  };
  const primary = () => {
    const tk = tokens[i++];
    if (!tk) throw new Error('式が途中で終わっています');
    if (tk.type === 'num') return tk.value;
    if (tk.type === 'sqrt') {
      const neg = peek() === '-'; // √-4 は「負の数の平方根」として断る
      if (neg) i++;
      const v = neg ? -postfix() : postfix();
      if (v < 0) throw new Error('負の数の平方根は出せません');
      return Math.sqrt(v);
    }
    if (tk.type === '(') {
      const v = expr();
      if (tokens[i++]?.type !== ')') throw new Error('かっこが閉じていません');
      return v;
    }
    throw new Error('式が正しくありません');
  };
  const v = expr();
  if (i < tokens.length) throw new Error(tokens[i].type === ')' ? 'かっこが合いません' : '式が正しくありません');
  if (!Number.isFinite(v)) throw new Error('大きすぎて計算できません');
  return v;
}

/** 結果の表し方：12 桁に丸め、-0 は 0 */
export function formatNumber(v) {
  const n = Number(v.toPrecision(12));
  return Object.is(n, -0) ? '0' : String(n);
}
