// PDF の編集画面：ポインタの振り分け（押す・動かす・離す）。Viewer のメソッド（viewer.js が prototype に足す。this は Viewer）
import {DRAW_TOOLS, api} from './shared.js';
import {syntheticMove} from '../../../shared/ink.js';
import {PALM_SIZE, contactSize} from '../../../shared/pad-channels.js';
import {figureSize, growsWithSize} from '../../../shared/figures.js';
import {growFigure, renderFigure} from '../../figure-view.js';

/** 点が要素の箱（ふちの外側の当たり判定は含まない）の中か */
const inBox = (el, e) => {
  const r = el.getBoundingClientRect();
  return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
};

// 指で流したスクロール（慣性）：離す前のこの長さの動きから速さを出す・これより長く止めてから離したら流さない・
// これより遅ければ流さない（ピクセル / ミリ秒）・1 ミリ秒ごとの減り方・これより遅くなったら止める
const GLIDE_SAMPLE_MS = 100;
const GLIDE_REST_MS = 80;
const GLIDE_MIN = 0.25;
const GLIDE_DECAY = 0.996;
const GLIDE_STOP = 0.02;
// iPad の手のひらの見分け：ペンを画面から離してからの間・ペンを浮かせて（近づけて）動かしてからの間（ms）。
// 字を書く合間（次の字へペンを運ぶ間）に置いた手は手のひら。ペンを遠ざけて少し待てば、指で動かせる
const PAD_PALM_MS = 700;
const PAD_HOVER_MS = 300;
// 時間だけで手のひらとみなした指が、これだけ動いたら指に戻す（CSS のピクセル。置いた手のずれより大きく）
const PALM_RELEASE_PX = 30;
// 指・タッチペン（電池のないペン。iPad には指として届く）で書いている間に、もう 1 か所触れたとき：
// 書き始めてからこれより早く・動かずに触れたなら 2 本指の操作（ピンチ）。それより後なら、書いている手の関節・手のひら
const TOUCH_GESTURE_MS = 250;
const TOUCH_WRITE_PX = 8; // これより動いていたら、書いている（あとから触れたものは関節・手のひら）
// タッチペン（指として届くペン）の手の見分け（iPad）。ピクセルは CSS のピクセル（iPad ではおよそ 1cm が 52）
const PALM_NEAR = 180; // 手のひら（触れた面の大きいもの）からこの距離の内側は、関節とみなす
const PALM_BELOW = 60; // ただし手のひらより下は、ここまで（関節は手のひらの上側に触れる）
const PALM_RECENT_MS = 800; // 手のひらが離れてから、この間はまだそこにあるものとする
const STROKE_RECENT_MS = 1500; // 最後に書いてから、この間を「書いている合間」とする
const STROKE_NEAR = 40; // 最後に書いた所からこれより近ければ、続けて書いた（関節とはみなさない）
const HAND_NEAR = 70; // 覚えた関節の位置（最後に書いた所＋手の位置）からこれより近ければ、関節
const HAND_MIN = 30; // 覚える関節の位置：ペン先からこの距離からここまで
const HAND_MAX = 320;
const HAND_KEY = 'palette.hand'; // 覚えた手の位置（この端末に覚える）
const DOT_MOVE = 4; // これより動かず、DOT_MS より短く触れて書いたものは点
const DOT_MS = 400;
const DOT_BIG = 83; // 点を書いた触れの大きさがこれ以上なら、関節の点らしい（ペン先は 21〜63 が多い）

export const methods = {
  onPointerDown(e) {
    this.inputAt = performance.now(); // ファイルへの上書き保存は、手を止めてから（export.js）
    this.stopGlide(); // 指で流したスクロールは、触れたら止める
    if (e.pointerType === 'pen') {
      this.penAt = performance.now();
      this.palmOff(); // ペンを下ろした：いま触れている指は手のひら（動かしている・ピンチしているのをやめる）
    }
    if (e.pointerType === 'touch') {
      this.touchIds.add(e.pointerId);
      if (this.bigTouch(e)) {
        this.palmIds.add(e.pointerId);
        this.bigSpots.set(e.pointerId, {x: e.clientX, y: e.clientY});
      } else if (this.knuckleAt(e.clientX, e.clientY)) {
        this.palmIds.add(e.pointerId);
        if (this.drawing && !this.drawing.byPen && this.penXY) this.handLearn(e.clientX, e.clientY, this.penXY);
      } else if (this.palmLikely()) {
        // 時間だけで手のひらとみなした指：はっきり指で払ったら、指に戻す（palmRelease）
        this.palmIds.add(e.pointerId);
        this.palmSoft.set(e.pointerId, {x: e.clientX, y: e.clientY});
      }
      if (this.palmIds.has(e.pointerId)) return; // 手のひら：何もしない
      // 2 本目の指は書き込みに使わない（ピンチ）。1 本目で始めたことも取りやめる（ペンで書いている間の手のひらは無視）
      if (this.drawing?.byPen) return;
      // ペンが画面の近くにある・少し前まで使っていた間の指は手のひら：何もしない（Surface などで、ペンを下ろす前に
      // 手を置くと、手のひらでピンチ・スクロールになり、書いている線が動いて途切れていた。v0.16.29）
      if (this.palmLikely()) return;
      if (this.liveTouches() > 1 && this.secondTouch(e)) return;
      if (this.liveTouches() === 1) {
        this.dropKnuckleDot(e);
        this.firstTouch = {id: e.pointerId, t: performance.now(), x: e.clientX, y: e.clientY, moved: 0, size: 0};
        this.penXY = {x: e.clientX, y: e.clientY};
      }
    }
    if (e.pointerType === 'pen' && !this.penSeen) {
      this.penSeen = true;
      this.pagesEl.dataset.pen = 'seen';
    }
    // 文字を打っている間は、ほかの操作をしない：箱の中はカーソル・範囲選択、箱のすぐそば（少しはみ出した所）は打つのを続け、
    // それより外を押したら打ち終わるだけ（線・新しい文字入れ・選択などは始めない）
    if (this.editing) {
      const ed = this.editing.el;
      if (ed.contains(e.target) && inBox(ed, e)) return;
      e.preventDefault();
      // 箱のふち（外側の当たり判定）を押した：打ち終わって動かす
      if (ed.contains(e.target)) {
        const a = this.editing;
        this.finishEdit();
        if (!a.removed) this.grabText(e, a);
        return;
      }
      const r = ed.getBoundingClientRect();
      const near =
        e.clientX > r.left - 12 && e.clientX < r.right + 12 && e.clientY > r.top - 8 && e.clientY < r.bottom + 8;
      if (near) return void ed.focus();
      return void this.finishEdit();
    }
    // 画面の左右の端（指・ペン）は四隅を出すなでる操作の始まり。書き始めない
    if (e.pointerType !== 'mouse' && (e.clientX >= document.documentElement.clientWidth - 24 || e.clientX <= 24))
      return;
    // メモの吹き出しの中は、吹き出しが受ける（手書き・消しゴムは中の欄で。ページには線を引かない）
    if (e.target.closest('.anno-note__pop')) return;
    // ペン・消しゴムを持っていても、メモのアイコンを押せば開く・閉じる（持ったまま中に手書きできる）
    const icon = e.target.closest('.anno-note__icon');
    if (icon && e.button === 0 && DRAW_TOOLS.includes(this.tool)) {
      const a = this.annoOf(icon);
      if (a) {
        e.preventDefault();
        this.openNote(a, a.el.querySelector('.anno-note__pop').hidden);
        return;
      }
    }
    // ペンの消しゴムの側（スタイラスの後ろ・消しゴムのボタン）は、どの道具のときも消しゴム
    const penEraser = e.pointerType === 'pen' && (e.button === 5 || (e.buttons & 32) !== 0);
    if (penEraser || DRAW_TOOLS.includes(this.tool)) return this.startDraw(e, penEraser);
    if (e.button !== 0) return;
    let a = this.annoOf(e.target);
    // 貼りもの（図・シール・紙）は下敷き：選択の道具のときだけ選んで動かす。ほかの道具では上に文字・メモ・文字隠しを置く
    if (a?.kind === 'stamp' && this.tool !== 'select') a = null;
    // 文字入れは、選択の道具と文字入れの道具のときだけ選んで動かす（文字隠し・メモのときは上に重ねて置ける）
    if (a?.kind === 'text' && this.tool !== 'select' && this.tool !== 'text') a = null;
    // 文字入れの道具で文字入れを押したとき：文字の上なら、そのまま打つ（押した所にカーソル。なぞると範囲選択）。
    // ふち（箱の外側の当たり判定）なら、押してそのまま動かす。選択の道具では、箱のどこを押しても動かす（打たない）
    if (a?.kind === 'text' && this.tool === 'text') {
      if (inBox(a.el, e)) {
        this.select(a);
        this.edit(a); // カーソルはブラウザが押した所に置く（preventDefault しない）
        return;
      }
      e.preventDefault();
      return this.grabText(e, a);
    }
    if (a) {
      e.preventDefault();
      const wasSelected = this.selected === a;
      this.select(a);
      this.drag = {
        a,
        wasSelected, // 選んであった図をもう一度押したら、書き換える
        curve: !!e.target.closest('[data-curve]'), // グラフの曲線を押したら、式を入れる
        before: this.snap(a),
        x: e.clientX,
        y: e.clientY,
        left: parseFloat(a.el.style.left),
        top: parseFloat(a.el.style.top),
        // 貼りものの右下のつまみ：大きさを変える
        resize: a.kind === 'stamp' && !!e.target.closest('.anno-stamp__grip'),
        width: a.el.offsetWidth,
        height: a.el.offsetHeight,
        style: a.style, // 伸びる図（表・数直線・座標平面）は、伸ばしたらます・目盛りを増やす
        moved: false,
        pointer: e.pointerId
      };
      this.pagesEl.setPointerCapture(e.pointerId);
      return;
    }
    const pageEl = e.target.closest('.pdf-page');
    if (!pageEl) return this.select(null);
    const p = this.pages[Number(pageEl.dataset.page) - 1];
    const box = pageEl.getBoundingClientRect();
    if (this.tool === 'select') return this.select(null);
    e.preventDefault();
    if (this.tool === 'mask') return this.startMask(e, p, box);
    // 指では、離したときに置く（2 本指のピンチやスクロールの始まりで文字入れ・付箋ができないように）
    if (e.pointerType === 'touch') return void (this.tap = {pointer: e.pointerId, p, x: e.clientX, y: e.clientY});
    this.createAt(this.tool, p, e.clientX - box.left, e.clientY - box.top);
  },

  /** 文字入れのふちを押した：そのまま動かす（押してすぐでも、長押ししてからでも） */
  grabText(e, a) {
    this.select(a);
    a.el.classList.add('is-lifted');
    this.drag = {
      a,
      before: this.snap(a),
      x: e.clientX,
      y: e.clientY,
      left: parseFloat(a.el.style.left),
      top: parseFloat(a.el.style.top),
      width: a.el.offsetWidth,
      height: a.el.offsetHeight,
      style: a.style,
      moved: false,
      lifted: true, // ふちを押して離しても打ち始めない
      pointer: e.pointerId
    };
    try {
      this.pagesEl.setPointerCapture(e.pointerId);
    } catch {
      // 指がもう離れていた
    }
  },

  /** 手のひららしいか：ペンを画面の近く（浮かせた状態も含む）で 1 秒以内に使った */
  /**
   * 指でページを動かす（ペンを使ったあとの 1 本指）。動いた分を貯め、画面の描き直し 1 回に 1 度だけスクロールする
   * （指の動きのたびにスクロールすると、iPad の Safari では追いつかずに指から遅れる）
   */
  panBy(pan, e) {
    pan.dx = (pan.dx ?? 0) + pan.x - e.clientX;
    pan.dy = (pan.dy ?? 0) + pan.y - e.clientY;
    pan.x = e.clientX;
    pan.y = e.clientY;
    (pan.trail ??= []).push([e.timeStamp, e.clientX, e.clientY]);
    if (pan.trail.length > 12) pan.trail.shift();
    if (pan.frame) return;
    pan.frame = requestAnimationFrame(() => {
      pan.frame = 0;
      if (pan.dx || pan.dy) window.scrollBy(pan.dx, pan.dy);
      pan.dx = pan.dy = 0;
    });
  },

  /** 指を離した：残りを動かし、離す直前の速さで少し流す（慣性。ブラウザのスクロールと同じ手ざわり） */
  endPan(pan, e) {
    if (pan.frame) {
      cancelAnimationFrame(pan.frame);
      pan.frame = 0;
      if (pan.dx || pan.dy) window.scrollBy(pan.dx, pan.dy);
    }
    const trail = pan.trail ?? [];
    const last = trail.at(-1);
    if (!last || e.timeStamp - last[0] > GLIDE_REST_MS) return; // 止めてから離した
    const first = trail.find((t) => last[0] - t[0] <= GLIDE_SAMPLE_MS) ?? last;
    const dt = last[0] - first[0];
    if (dt <= 0) return;
    let vx = (first[1] - last[1]) / dt; // スクロールの向き（指と逆）。ピクセル / ミリ秒
    let vy = (first[2] - last[2]) / dt;
    if (Math.hypot(vx, vy) < GLIDE_MIN) return;
    this.stopGlide();
    let prev = performance.now();
    const step = (now) => {
      const t = Math.min(50, now - prev);
      prev = now;
      window.scrollBy(vx * t, vy * t);
      const k = GLIDE_DECAY ** t;
      vx *= k;
      vy *= k;
      if (this.destroyed || Math.hypot(vx, vy) < GLIDE_STOP) return void (this.glide = 0);
      this.glide = requestAnimationFrame(step);
    };
    this.glide = requestAnimationFrame(step);
  },

  /**
   * ペンを下ろしたとき：いま触れている指はすべて手のひらとし、離すまで使わない。指で動かしている・流れている・ピンチの途中なら
   * やめる（ピンチは元の倍率に戻す）。手を先に置いてから書き始めると、手のひらでページが動いて線がずれていた
   */
  palmOff() {
    for (const id of this.touchIds) this.palmIds.add(id);
    this.palmSoft.clear(); // ペンを下ろしたときに触れていたものは、指に戻さない
    this.stopGlide();
    if (this.pan && this.touchIds.has(this.pan.pointer)) {
      if (this.pan.frame) cancelAnimationFrame(this.pan.frame);
      this.pan = null;
    }
    if (this.pinch?.touch) this.cancelPinch();
  },

  /**
   * 書いた直後（時間だけで手のひらとみなした間）に触れた指が、はっきり動いた（払った）：手のひらは置いたまま大きくは動かない
   * ので、指に戻してページを動かし始める。ペンで書いている・ペンを浮かせて動かしている間はそのまま（字を書く手の動き）。
   * 書いてすぐ指でページを動かそうとすると、約 1 秒止まってから動いていた（v0.22.6）
   */
  palmRelease(e) {
    const s = this.palmSoft.get(e.pointerId);
    if (Math.hypot(e.clientX - s.x, e.clientY - s.y) < PALM_RELEASE_PX) return;
    this.palmSoft.delete(e.pointerId);
    const now = performance.now();
    if (this.drawing?.byPen || now - (this.hoverAt ?? -Infinity) < PAD_HOVER_MS || this.liveTouches() > 0) return;
    this.palmIds.delete(e.pointerId);
    if (!this.pan && !this.drawing && DRAW_TOOLS.includes(this.tool))
      this.pan = {pointer: e.pointerId, x: e.clientX, y: e.clientY};
  },

  /** 手のひらと決めたものを除いた、触れている指の数 */
  liveTouches() {
    let n = 0;
    for (const id of this.touchIds) if (!this.palmIds.has(id)) n++;
    return n;
  },

  /**
   * 指・タッチペンで書いている（消している・引いている）間に、もう 1 か所触れた。true なら、この触れでは何もしない。
   * - 書き始めてすぐ（TOUCH_GESTURE_MS）で動いていない：2 本指の操作の始まり。書きかけをやめる（ピンチになる）
   * - 書いている線が動いている：あとから触れたのは、書いている手の関節・手のひら。無視して書き続ける
   * - 書き始めた所で止まったまま：先に触れていたほうが関節・手のひら（点だけ書いた）。それをやめ、あとの触れで書く（false）
   * 書いていないとき（指で動かしているなど）は、これまでどおり 2 本目の指でやめる（ピンチ）
   */
  secondTouch(e) {
    const d = this.drawing;
    const f = this.firstTouch;
    if (!d || d.byPen || !f || d.pointer !== f.id || this.palmIds.has(f.id)) {
      this.cancelPointer();
      return true;
    }
    if (f.moved >= TOUCH_WRITE_PX) {
      this.palmIds.add(e.pointerId);
      if (this.penXY) this.handLearn(e.clientX, e.clientY, this.penXY);
      return true;
    }
    if (performance.now() - f.t < TOUCH_GESTURE_MS) {
      this.cancelPointer();
      return true;
    }
    this.cancelPointer();
    this.palmIds.add(f.id);
    this.handLearn(f.x, f.y, {x: e.clientX, y: e.clientY});
    this.firstTouch = {id: e.pointerId, t: performance.now(), x: e.clientX, y: e.clientY, moved: 0, size: 0};
    this.penXY = {x: e.clientX, y: e.clientY};
    return false;
  },

  // ---- タッチペン（指として届くペン）の手の見分け（iPad）----
  /** 覚えた手の位置（関節 − ペン先。この端末に覚える） */
  handOf() {
    if (!this.hand) {
      try {
        const h = JSON.parse(localStorage.getItem(HAND_KEY) ?? 'null');
        this.hand = h && Number.isFinite(h.dx) && Number.isFinite(h.dy) && Number.isFinite(h.n) ? h : null;
      } catch {
        this.hand = null;
      }
      this.hand ??= {dx: 0, dy: 0, n: 0};
    }
    return this.hand;
  },

  /** 関節（kx, ky）とそのときのペン先（p）から、手の位置を覚える（新しいものほど重く、20 回分の平均） */
  handLearn(kx, ky, p) {
    if (!api.pad || !p) return;
    const dx = kx - p.x;
    const dy = ky - p.y;
    const d = Math.hypot(dx, dy);
    if (d < HAND_MIN || d > HAND_MAX) return;
    const h = this.handOf();
    h.n = Math.min(h.n + 1, 20);
    h.dx += (dx - h.dx) / h.n;
    h.dy += (dy - h.dy) / h.n;
    try {
      localStorage.setItem(HAND_KEY, JSON.stringify(h));
    } catch {
      // 覚えられなくても、この画面の間は使える
    }
  },

  /** 手のひら（触れている・少し前まで触れていた、面の大きいもの）の位置 */
  palmSpots() {
    const now = performance.now();
    this.bigRecent = (this.bigRecent ?? []).filter((s) => now - s.t < PALM_RECENT_MS);
    return [...(this.bigSpots?.values() ?? []), ...this.bigRecent];
  },

  /**
   * そこに触れたのは関節か（触れた面が小さくても）：
   * - 手のひらの近く（PALM_NEAR）で、手のひらより下すぎない所
   * - 書いている合間（最後に書いてから STROKE_RECENT_MS）に、最後に書いた所＋覚えた手の位置の近く
   * ただし最後に書いた所のすぐ近く（続けて書いた）は、関節とみなさない
   */
  knuckleAt(x, y) {
    if (!api.pad) return false;
    const now = performance.now();
    const s = this.lastStroke;
    const recent = !!s && now - s.t < STROKE_RECENT_MS;
    if (recent && Math.hypot(x - s.x, y - s.y) < STROKE_NEAR) return false;
    for (const p of this.palmSpots()) if (Math.hypot(x - p.x, y - p.y) < PALM_NEAR && y - p.y < PALM_BELOW) return true;
    const h = this.handOf();
    return recent && h.n >= 2 && Math.hypot(x - (s.x + h.dx), y - (s.y + h.dy)) < HAND_NEAR;
  },

  /** 指・タッチペンで書き終えた：書いた所と、点だったか（関節で書いた点かもしれない）を覚える */
  noteStroke(e, a) {
    if (e.pointerType !== 'touch' || !api.pad) return;
    const f = this.firstTouch?.id === e.pointerId ? this.firstTouch : null;
    const now = performance.now();
    const dot = !!a && !!f && f.moved < DOT_MOVE && now - f.t < DOT_MS;
    this.lastStroke = {x: e.clientX, y: e.clientY, t: now, dot: dot ? a : null, size: f?.size ?? 0};
  },

  /**
   * 次の画を書き始めた所（e）から見て、直前に書いた点が関節で書いたものらしければ消す（取り消しの手にも残さない）：
   * 点を書いた触れが大きい・手のひらの近く・覚えた関節の位置に合う。書き始めた所のすぐ近くの点（「、」など）は残す
   */
  dropKnuckleDot(e) {
    const s = this.lastStroke;
    const a = s?.dot;
    if (!a || a.removed || !api.pad) return;
    this.lastStroke = {...s, dot: null};
    if (performance.now() - s.t > STROKE_RECENT_MS || Math.hypot(e.clientX - s.x, e.clientY - s.y) < STROKE_NEAR)
      return;
    const h = this.handOf();
    const byHand = h.n >= 2 && Math.hypot(s.x - (e.clientX + h.dx), s.y - (e.clientY + h.dy)) < HAND_NEAR;
    const byPalm = this.palmSpots().some((p) => Math.hypot(s.x - p.x, s.y - p.y) < PALM_NEAR && s.y - p.y < PALM_BELOW);
    const big = s.size >= DOT_BIG;
    if (!(big || byPalm || byHand)) return;
    if (big || byPalm) this.handLearn(s.x, s.y, {x: e.clientX, y: e.clientY});
    const i = this.undoStack.findLastIndex((st) => st.key === a.key && st.before === null);
    if (i >= 0) this.undoStack.splice(i, 1);
    this.removeAnno(a, false);
  },

  /** iPad：触れた面が大きい（手のひら。指よりはっきり大きい）。iPad が大きさを渡さなければ、いつも false */
  bigTouch(e) {
    return !!api.pad && contactSize(e) >= PALM_SIZE;
  },

  /**
   * 指と思って動かし始めたあとで、触れた面が大きくなった（手のひらは、置いた瞬間は端だけが触れて小さい）：手のひらにし、
   * その指で動かしている・ピンチしているのをやめる（ピンチは元の倍率に戻す）
   */
  palmLate(id, e = null) {
    this.palmIds.add(id);
    this.palmSoft.delete(id);
    if (e) this.bigSpots.set(id, {x: e.clientX, y: e.clientY});
    // 書いていた触れが大きくなった：関節・手のひらで書いていた。書きかけを消す（ペン先は 83 を超えない。ログで確かめた）
    if (this.drawing?.pointer === id) this.cancelPointer();
    if (this.pan?.pointer === id) {
      if (this.pan.frame) cancelAnimationFrame(this.pan.frame);
      this.pan = null;
    }
    if (this.pinch?.touch) this.cancelPinch();
  },

  stopGlide() {
    if (this.glide) cancelAnimationFrame(this.glide);
    this.glide = 0;
  },

  palmLikely() {
    // iPad：ペンで書いている・書いた直後・ペンを浮かせて動かした直後に触れたものは手のひら。浮かせたペンは、動きが止まると
    // すぐ数えない（ずっと数えると、ペンを持った手の指で動かす・ピンチするのが効かず、遅れて見えた。v0.22.5）
    if (api.pad) {
      const now = performance.now();
      return (
        this.penSeen &&
        (this.drawing?.byPen ||
          now - (this.penAt ?? -Infinity) < PAD_PALM_MS ||
          now - (this.hoverAt ?? -Infinity) < PAD_HOVER_MS)
      );
    }
    return this.penSeen && performance.now() - (this.penAt ?? -Infinity) < 1000;
  },

  onPointerMove(e) {
    if (e.pointerType === 'pen') {
      // 浮かせたペンの動きも数える（Surface のペンは近づけると動きが来る）。iPad は浮かせた動きを別に数える（palmLikely）
      if (!api.pad || e.buttons) this.penAt = performance.now();
      else this.hoverAt = performance.now();
    } else if (e.buttons) this.inputAt = performance.now();
    if (e.pointerType === 'touch' && !this.palmIds.has(e.pointerId) && this.bigTouch(e)) this.palmLate(e.pointerId, e);
    if (e.pointerType === 'touch' && this.bigSpots.has(e.pointerId))
      this.bigSpots.set(e.pointerId, {x: e.clientX, y: e.clientY});
    if (e.pointerType === 'touch' && this.palmSoft.has(e.pointerId)) this.palmRelease(e);
    if (e.pointerType === 'touch' && this.palmIds.has(e.pointerId)) return; // 手のひらと決めた指は、離すまで何もしない
    const f = this.firstTouch;
    if (f?.id === e.pointerId) {
      f.moved = Math.max(f.moved, Math.hypot(e.clientX - f.x, e.clientY - f.y));
      f.size = Math.max(f.size, contactSize(e));
    }
    if (this.drawing?.pointer === e.pointerId) this.penXY = {x: e.clientX, y: e.clientY};
    // パソコン（Surface など）：ペンの近くの指は動きごとに見る。iPad は触れたときに指ごとに決めている（palmIds）
    if (e.pointerType === 'touch' && !api.pad && this.palmLikely() && !this.pinch) return;
    if (this.tool === 'eraser' && !this.drawing && e.pointerType !== 'touch') this.moveRing(e);
    const pan = this.pan;
    if (pan?.pointer === e.pointerId) {
      if (this.drawing) return; // ペンで書いている間の手のひら
      return void this.panBy(pan, e);
    }
    const dr = this.drawing;
    // 書いている・消している・引いている間の、押していない合成の動き（buttons が 0）は使わない（書いていない線が出るため。v0.16.28）
    if (dr?.pointer === e.pointerId && syntheticMove(e)) return;
    if (dr?.pointer === e.pointerId && dr.kind === 'ink') {
      this.addInkPoint(dr, e);
      return this.drawInk();
    }
    if (dr?.pointer === e.pointerId && dr.kind === 'eraser') return this.eraseAt(e);
    if (dr?.pointer === e.pointerId && dr.kind === 'line') {
      const box = dr.p.el.getBoundingClientRect();
      dr.x1 = Math.min(Math.max(e.clientX - box.left, 0), box.width);
      dr.y1 = e.clientY - box.top;
      return this.drawLineDraft();
    }
    if (this.drawing?.pointer === e.pointerId) {
      const box = this.drawing.p.el.getBoundingClientRect();
      this.drawing.x1 = Math.min(Math.max(e.clientX - box.left, 0), box.width);
      this.drawing.y1 = Math.min(Math.max(e.clientY - box.top, 0), box.height);
      return this.drawDraft();
    }
    const d = this.drag;
    if (!d || d.pointer !== e.pointerId) return;
    const dx = e.clientX - d.x,
      dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < 3) return;
    d.moved = true;
    d.a.el.classList.add('is-dragging');
    if (d.resize && d.a.style.type === 'figure' && growsWithSize(d.a.style.ref)) {
      // 表・数直線・座標平面：縦に伸ばすと縦の、横に伸ばすと横のます・目盛りが増える（1 ますの大きさは変えない）
      const unit = d.width / figureSize(d.style.ref, d.style.params).w;
      const g = growFigure(d.style, unit, Math.max(16, d.width + dx), Math.max(16, d.height + dy));
      d.a.style = g.style;
      d.a.el.style.width = `${g.w}px`;
      d.a.el.style.height = `${g.h}px`;
      renderFigure(d.a.el.querySelector('.anno-stamp__fig'), g.style);
      this.showGrowTip(d.a.el, g.style);
      return;
    }
    if (d.resize) {
      // シール・図は縦横の比を保つ。紙は自由に（文字は折り返し直す）
      const w = Math.max(16, d.width + dx);
      const h = d.a.style.type === 'memo' ? Math.max(16, d.height + dy) : (w * d.height) / d.width;
      d.a.el.style.width = `${w}px`;
      d.a.el.style.height = `${h}px`;
      if (d.a.style.type === 'memo') this.placeMemo(d.a, w, this.pages[d.a.page - 1].viewport.scale);
      return;
    }
    // 付箋（インデックス）はページの端に沿って上下にだけ動かす
    if (!(d.a.kind === 'stamp' && d.a.style.type === 'index')) d.a.el.style.left = `${d.left + dx}px`;
    d.a.el.style.top = `${d.top + dy}px`;
    if (d.a.kind === 'mask') this.syncCovers();
  },

  onPointerUp(e) {
    if (this.pan?.pointer === e.pointerId) {
      this.endPan(this.pan, e);
      this.pan = null;
    }
    const dr = this.drawing;
    if (dr?.pointer === e.pointerId && dr.kind === 'ink') return void this.noteStroke(e, this.finishInk(e));
    if (dr?.pointer === e.pointerId && dr.kind === 'line') return void this.finishLine();
    if (dr?.pointer === e.pointerId && dr.kind === 'eraser') {
      this.drawing = null;
      if (this.tool !== 'eraser') this.ring?.remove();
      return void this.recordGroup(dr.steps);
    }
    if (this.drawing?.pointer === e.pointerId) return void this.finishMask();
    const t = this.tap;
    if (t?.pointer === e.pointerId) {
      this.tap = null;
      if (Math.hypot(e.clientX - t.x, e.clientY - t.y) > 10) return; // 指が動いた（スクロール）
      const box = t.p.el.getBoundingClientRect();
      return void this.createAt(this.tool, t.p, e.clientX - box.left, e.clientY - box.top);
    }
    const d = this.drag;
    if (!d || d.pointer !== e.pointerId) return;
    this.drag = null;
    const a = d.a;
    a.el.classList.remove('is-dragging', 'is-lifted');
    this.showGrowTip(null);
    if (d.moved) {
      const p = this.pages[a.page - 1];
      // ページの外へは出さない
      const left = Math.min(Math.max(parseFloat(a.el.style.left), 0), p.viewport.width - 8);
      const top = Math.min(Math.max(parseFloat(a.el.style.top), 0), p.viewport.height - 8);
      let {width, height} = this.toScreen(a.page, a.rect);
      if (d.resize) {
        // ページの外へははみ出さない（シール・図は比を保ったまま縮める）
        const maxW = p.viewport.width - left,
          maxH = p.viewport.height - top;
        width = a.el.offsetWidth;
        height = a.el.offsetHeight;
        const k = a.style.type === 'memo' ? 1 : Math.min(1, maxW / width, maxH / height);
        width = Math.min(width * k, maxW);
        height = Math.min(height * k, maxH);
      }
      a.rect = this.fromScreen(a.page, {left, top, width, height});
      this.place(a);
      this.record(a.key, d.before, this.snap(a));
      this.scheduleSave(a, 0);
    } else if (a.kind === 'note') this.openNote(a, a.el.querySelector('.anno-note__pop').hidden);
    else if (a.kind === 'text' && this.tool === 'text' && !d.lifted) this.edit(a);
    else if (a.kind === 'stamp' && a.style.type === 'figure' && (d.wasSelected || d.curve) && !d.resize)
      this.editFigure(a, d.curve ? 'formula' : null);
  }
};
