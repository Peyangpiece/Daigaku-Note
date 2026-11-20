// パステルの品（art: 'cute'。shared/stationery.js）の 3D モデルを、three.js でその場で組み立てる（v0.27.10。GLB のファイルはない）。
// 詳細ページの 3D 表示（model3d-three.js の mount）で使う。一覧・持ち物・ポーチの隅は 2D の絵のまま。
// 形は 2D の絵と同じつくり：どうぶつの筆箱（耳・顔・ファスナー）・まるポーチ（キルティング・ワッペン・チャーム）・
// どうぶつタイマー（角の丸い本体・耳・顔・液晶・「分」「秒」「▶」のボタン）。
// 組み立ては「見る向き」（X が右・Y が上・Z が手前。机に置いた形）で行い、最後に GLB と同じ向き
// （長さが y・上が z・手前が x。model3d-three.js の loadNow がペンと同じに回す）へ並べ替える
import * as THREE from 'three';
import {CHEEK_COLOR, EYE_COLOR, shade} from '../shared/stationery.js';

/** 3D で組み立てる品の形（品の model3d）。model3d-three.js はこの名前のとき GLB を読まずに buildCute を使う */
export const CUTE_MODELS = ['case-cute', 'pouch-cute', 'tool-timer-cute'];

const col = (hex) => new THREE.Color(hex);
/** つやのある樹脂（タイマー）・やわらかい布（筆箱・ポーチ） */
// パステルの色が暗い所でくすまないよう、自分の色を少しだけ光らせる（emissive）
const plastic = (hex, extra = {}) =>
  new THREE.MeshPhysicalMaterial({
    color: col(hex),
    emissive: col(hex),
    emissiveIntensity: 0.12,
    roughness: 0.42,
    clearcoat: 0.35,
    clearcoatRoughness: 0.35,
    ...extra
  });
const fabric = (hex, extra = {}) =>
  new THREE.MeshPhysicalMaterial({
    color: col(hex),
    emissive: col(hex),
    emissiveIntensity: 0.22,
    roughness: 0.9,
    sheen: 0.5,
    sheenRoughness: 0.8,
    sheenColor: col('#ffffff'),
    ...extra
  });

/** 角の丸い四角の板（足もとの形が w × d、厚さ t）。机に置いた向き（厚さが上）。bevel で縁を丸める */
function slab(w, d, t, r, bevel, mat) {
  const s = new THREE.Shape();
  const x = -w / 2,
    y = -d / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + d - r);
  s.quadraticCurveTo(x + w, y + d, x + w - r, y + d);
  s.lineTo(x + r, y + d);
  s.quadraticCurveTo(x, y + d, x, y + d - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  const geo = new THREE.ExtrudeGeometry(s, {
    depth: Math.max(0.001, t - 2 * bevel),
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 8,
    curveSegments: 24
  });
  geo.rotateX(-Math.PI / 2); // 押し出しの向き（+Z）を上（+Y）へ。形の上（+Y）は奥（−Z）へ
  geo.translate(0, bevel, 0); // 底が y = 0
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, mat);
}

/** canvas に描いた絵の面（透明のところは透ける）。w × h の大きさ、draw(ctx, W, H) で描く */
function decal(w, h, draw, {px = 1024} = {}) {
  const c = document.createElement('canvas');
  c.width = px;
  c.height = Math.round((px * h) / w);
  const ctx = c.getContext('2d');
  draw(ctx, c.width, c.height);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const mat = new THREE.MeshBasicMaterial({map: tex, transparent: true, depthWrite: false});
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
}
/** 上を向けて置く（机に平らに置いた面の上） */
const faceUp = (m, y) => {
  m.rotation.x = -Math.PI / 2;
  m.position.y = y;
  return m;
};

/** 顔（目・口・ほお）を canvas に描く。cx・cy・s は中心と大きさ（目の間隔の半分） */
function drawFace(ctx, motif, cx, cy, s, {cheeks = true, muzzle = null} = {}) {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.fillStyle = EYE_COLOR;
  ctx.strokeStyle = EYE_COLOR;
  ctx.lineWidth = s * 0.09;
  const dot = (x) => {
    ctx.beginPath();
    ctx.ellipse(x, cy, s * 0.085, s * 0.11, 0, 0, Math.PI * 2);
    ctx.fill();
  };
  if (motif === 'cat') {
    // 左目はウインク
    ctx.beginPath();
    ctx.moveTo(cx - s * 1.12, cy);
    ctx.lineTo(cx - s * 0.88, cy);
    ctx.moveTo(cx - s * 0.97, cy - s * 0.12);
    ctx.lineTo(cx - s * 0.88, cy);
    ctx.stroke();
  } else dot(cx - s);
  dot(cx + s);
  if (cheeks) {
    ctx.fillStyle = CHEEK_COLOR;
    ctx.globalAlpha = 0.7;
    for (const x of [cx - s * 1.35, cx + s * 1.35]) {
      ctx.beginPath();
      ctx.ellipse(x, cy + s * 0.32, s * 0.22, s * 0.13, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  if (muzzle) {
    ctx.fillStyle = muzzle;
    ctx.beginPath();
    ctx.ellipse(cx, cy + s * 0.32, s * 0.36, s * 0.26, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  if (motif === 'chick') {
    ctx.fillStyle = '#ffc9a3';
    ctx.lineWidth = s * 0.05;
    ctx.beginPath();
    ctx.moveTo(cx, cy - s * 0.12);
    ctx.lineTo(cx + s * 0.16, cy + s * 0.06);
    ctx.lineTo(cx, cy + s * 0.24);
    ctx.lineTo(cx - s * 0.16, cy + s * 0.06);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    return;
  }
  // ω の口
  ctx.strokeStyle = EYE_COLOR;
  ctx.lineWidth = s * 0.07;
  const y = cy + s * 0.12;
  ctx.beginPath();
  ctx.moveTo(cx - s * 0.2, y);
  ctx.quadraticCurveTo(cx - s * 0.1, y + s * 0.2, cx, y + s * 0.03);
  ctx.quadraticCurveTo(cx + s * 0.1, y + s * 0.2, cx + s * 0.2, y);
  ctx.stroke();
}

/** 飾りの形（ハート・ほし・リボン・くも）を canvas に描く */
function drawMotif(ctx, motif, cx, cy, r, fill, line) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(r, r);
  ctx.fillStyle = fill;
  ctx.strokeStyle = line;
  ctx.lineWidth = 0.08;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  if (motif === 'heart') {
    ctx.moveTo(0, 0.82);
    ctx.bezierCurveTo(-0.95, 0.18, -1.02, -0.55, -0.52, -0.78);
    ctx.bezierCurveTo(-0.22, -0.9, 0, -0.68, 0, -0.45);
    ctx.bezierCurveTo(0, -0.68, 0.22, -0.9, 0.52, -0.78);
    ctx.bezierCurveTo(1.02, -0.55, 0.95, 0.18, 0, 0.82);
  } else if (motif === 'star') {
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const k = i % 2 ? 0.45 : 1;
      ctx[i ? 'lineTo' : 'moveTo'](Math.cos(a) * k, Math.sin(a) * k + 0.08);
    }
  } else if (motif === 'ribbon') {
    ctx.moveTo(0, 0);
    ctx.lineTo(-0.95, -0.55);
    ctx.quadraticCurveTo(-1.05, 0, -0.95, 0.55);
    ctx.closePath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0.95, -0.55);
    ctx.quadraticCurveTo(1.05, 0, 0.95, 0.55);
    ctx.closePath();
    ctx.moveTo(0.24, 0);
    ctx.arc(0, 0, 0.24, 0, Math.PI * 2);
  } else {
    // くも
    ctx.moveTo(-0.62, 0.5);
    ctx.bezierCurveTo(-1.05, 0.5, -1.05, -0.08, -0.62, -0.1);
    ctx.bezierCurveTo(-0.6, -0.58, 0.02, -0.72, 0.22, -0.32);
    ctx.bezierCurveTo(0.6, -0.5, 1.02, -0.2, 0.86, 0.14);
    ctx.bezierCurveTo(1.08, 0.3, 0.98, 0.5, 0.7, 0.5);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

/** 耳（どうぶつの筆箱・タイマーの上）。at は耳の根元の場所、size は大きさ。机に置いた本体の上の面から生やす */
function ears(motif, base, {xs, y, z, size, mat}) {
  const g = new THREE.Group();
  const inner = new THREE.MeshPhysicalMaterial({color: col(shade(CHEEK_COLOR, 0.25)), roughness: 0.8});
  for (const [i, x] of xs.entries()) {
    const side = i === 0 ? -1 : 1;
    if (motif === 'bear') {
      // 丸い耳：上の面から半分ほど出る
      const e = new THREE.Mesh(new THREE.SphereGeometry(size, 32, 20), mat);
      e.scale.set(1, 1, 0.6);
      e.position.set(x, y + size * 0.15, z);
      g.add(e);
    } else if (motif === 'cat') {
      const e = new THREE.Mesh(new THREE.ConeGeometry(size, size * 1.9, 28), mat);
      e.scale.set(1, 1, 0.55);
      e.rotation.z = -side * 0.22;
      e.position.set(x, y + size * 0.55, z);
      const p = new THREE.Mesh(new THREE.ConeGeometry(size * 0.55, size * 1.2, 24), inner);
      p.scale.set(1, 1, 0.3);
      p.rotation.z = -side * 0.22;
      p.position.set(x + side * 0.01, y + size * 0.5, z + size * 0.3);
      g.add(e, p);
    }
  }
  if (motif === 'chick') {
    const t = new THREE.Mesh(new THREE.ConeGeometry(size * 0.35, size * 0.9, 20), mat);
    t.position.set(0, y + size * 0.4, z);
    t.rotation.z = 0.25;
    const t2 = t.clone();
    t2.rotation.z = -0.35;
    t2.position.x = size * 0.25;
    g.add(t, t2);
  }
  return g;
}

/**
 * うさぎの垂れた耳：根元は本体の上の奥の角に埋め、手前へ向かって本体の横の縁にかかって垂れる（2D の絵と同じく、
 * 根元は本体と同じ色の中に入り、生え際に段や線が出ない）。side は −1（左）か 1（右）
 */
function lopEar(base, side, {x, top, back, len, w, mat}) {
  const g = new THREE.Group();
  const ear = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 24), mat);
  ear.scale.set(w, w * 0.42, len);
  const pink = new THREE.Mesh(
    new THREE.SphereGeometry(1, 32, 20),
    new THREE.MeshPhysicalMaterial({color: col(shade(CHEEK_COLOR, 0.3)), roughness: 0.85})
  );
  pink.scale.set(w * 0.55, w * 0.2, len * 0.72);
  pink.position.set(0, w * 0.3, len * 0.08);
  g.add(ear, pink);
  // 根元（奥の端）を本体の角に埋め、手前ほど外側・下へ
  g.position.set(x, top - w * 0.05, back + len * 0.72);
  g.rotation.set(-0.12, side * 0.18, side * -0.55);
  return g;
}

/** どうぶつタイマー：角の丸い本体（一段高い面）・耳・顔・液晶・ボタン（2D の絵 cuteTimerDevice と同じ並び） */
function timer(item) {
  const g = new THREE.Group();
  const {base, motif} = item;
  const W = 1.4,
    D = 1.0,
    T = 0.34;
  const body = plastic(base);
  g.add(slab(W, D, T, 0.3, 0.09, body));
  const plateTop = T + 0.035;
  const plate = slab(W - 0.12, D - 0.12, 0.05, 0.24, 0.02, plastic(shade(base, 0.18)));
  plate.position.y = T - 0.015;
  g.add(plate);
  // 2D の絵の場所（viewBox 140 × 104。本体は x 4〜136・y 14〜100）→ 上の面の場所
  const X = (u) => ((u - 70) / 132) * W;
  const Z = (v) => ((v - 57) / 86) * D;
  // 顔と液晶：上の面に刷った絵
  const top = decal(W - 0.16, D - 0.16, (ctx, w, h) => {
    const px = (u) => ((X(u) + (W - 0.16) / 2) / (W - 0.16)) * w;
    const py = (v) => ((Z(v) + (D - 0.16) / 2) / (D - 0.16)) * h;
    drawFace(ctx, motif, px(70), py(27.5), px(88) - px(70), {cheeks: false});
    const x0 = px(29),
      y0 = py(38),
      x1 = px(111),
      y1 = py(74);
    const r = (x1 - x0) * 0.1;
    ctx.beginPath();
    ctx.roundRect(x0, y0, x1 - x0, y1 - y0, r);
    ctx.fillStyle = '#f6f7f2';
    ctx.fill();
    ctx.lineWidth = w * 0.006;
    ctx.strokeStyle = '#a5a3a8';
    ctx.stroke();
    ctx.fillStyle = '#2c2d30';
    ctx.font = `700 ${(y1 - y0) * 0.66}px "SF Pro Rounded","Hiragino Maru Gothic ProN","Arial Rounded MT Bold",Arial,sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('25:00', (x0 + x1) / 2, (y0 + y1) / 2 + (y1 - y0) * 0.04);
  });
  g.add(faceUp(top, plateTop + 0.002));
  // ボタン：白い丸いボタン。上に字（分・秒・▶）
  const btnMat = plastic('#ffffff', {roughness: 0.35});
  for (const [u, label] of [
    [42, '分'],
    [70, '秒'],
    [102, '▶']
  ]) {
    const r = (7.5 / 132) * W;
    const b = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.04, 0.07, 40), btnMat);
    b.position.set(X(u), plateTop + 0.03, Z(88));
    const cap = decal(
      r * 2,
      r * 2,
      (ctx, w, h) => {
        ctx.fillStyle = EYE_COLOR;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        if (label === '▶') {
          ctx.beginPath();
          ctx.moveTo(w * 0.4, h * 0.3);
          ctx.lineTo(w * 0.68, h * 0.5);
          ctx.lineTo(w * 0.4, h * 0.7);
          ctx.closePath();
          ctx.fill();
        } else {
          ctx.font = `${h * 0.48}px "Hiragino Sans","Noto Sans JP","Yu Gothic",sans-serif`;
          ctx.fillText(label, w / 2, h / 2 + h * 0.03);
        }
      },
      {px: 256}
    );
    g.add(b, faceUp(cap, plateTop + 0.066));
    cap.position.x = X(u);
    cap.position.z = Z(88);
  }
  // 耳：奥の縁から上へ
  if (motif === 'bunny') {
    for (const side of [-1, 1])
      g.add(lopEar(base, side, {x: side * (W / 2 - 0.2), top: T, back: -D / 2 + 0.02, len: 0.34, w: 0.15, mat: body}));
  } else g.add(ears(motif, base, {xs: [X(26), X(114)], y: T, z: -D / 2 + 0.1, size: 0.11, mat: body}));
  return g;
}

/** どうぶつの筆箱：ふっくらした横長の袋（フェルト）・上の耳・手前の面の顔・上のファスナー */
function pencase(item) {
  const g = new THREE.Group();
  const {base, trim, motif} = item;
  const W = 2,
    D = 0.62,
    T = 0.66;
  const felt = fabric(base);
  g.add(slab(W, D, T, 0.3, 0.2, felt));
  // ファスナー：上の真ん中に、横に長く
  // ファスナー：上の面に、細いファスナーの歯（少し濃い色）と引き手
  const coil = new THREE.Mesh(new THREE.BoxGeometry(W * 0.8, 0.008, 0.016), plastic(shade(base, -0.18)));
  coil.position.set(0, T + 0.004, 0);
  const pull = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.016, 0.1), plastic(trim));
  pull.position.set(W * 0.36, T + 0.012, 0.05);
  g.add(coil, pull);
  // 顔：手前の面
  const face = decal(1.2, 0.4, (ctx, w, h) =>
    drawFace(ctx, motif, w / 2, h * 0.42, w * 0.2, {muzzle: motif === 'bear' ? trim : null})
  );
  face.position.set(0, T / 2, D / 2 + 0.2 + 0.003);
  g.add(face);
  if (motif === 'bunny')
    for (const side of [-1, 1])
      g.add(lopEar(base, side, {x: side * 0.45, top: T, back: -0.1, len: 0.32, w: 0.14, mat: felt}));
  else g.add(ears(motif, base, {xs: [-0.62, 0.62], y: T - 0.03, z: 0, size: 0.14, mat: felt}));
  return g;
}

/** まるポーチ：キルティングの袋・上のファスナー・手前のワッペン・ファスナーのチャーム */
function pouch(item) {
  const g = new THREE.Group();
  const {base, trim, motif} = item;
  const W = 1.6,
    D = 0.5,
    T = 0.9;
  // キルティング：斜めの点線の格子を描いた布
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 256, 256);
  ctx.strokeStyle = trim;
  ctx.globalAlpha = 0.9;
  ctx.lineWidth = 7;
  ctx.setLineDash([16, 12]);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(256, 256);
  ctx.moveTo(256, 0);
  ctx.lineTo(0, 256);
  ctx.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(5, 5);
  const quilt = fabric('#ffffff', {map: tex, emissiveMap: tex});
  g.add(slab(W, D, T, 0.24, 0.22, quilt));
  const coil = new THREE.Mesh(new THREE.BoxGeometry(W * 0.8, 0.008, 0.016), plastic(shade(base, -0.18)));
  coil.position.set(0, T + 0.004, 0);
  g.add(coil);
  // ワッペン：手前の面の真ん中
  const patch = decal(0.42, 0.42, (cx, w, h) => {
    cx.fillStyle = trim;
    cx.beginPath();
    cx.arc(w / 2, h / 2, w * 0.46, 0, Math.PI * 2);
    cx.fill();
    cx.setLineDash([w * 0.05, w * 0.04]);
    cx.lineWidth = w * 0.02;
    cx.strokeStyle = shade(base, -0.25);
    cx.stroke();
    cx.setLineDash([]);
    drawMotif(cx, motif, w / 2, h / 2, w * 0.3, shade(base, -0.06), shade(base, -0.3));
  });
  patch.position.set(0, T * 0.5, D / 2 + 0.22 + 0.003);
  g.add(patch);
  // チャーム：右端の引き手から下がる、飾りの形の小さな札（両面）
  const pull = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.02, 0.12), plastic(trim));
  pull.position.set(W * 0.4, T + 0.02, 0.07);
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.03, 0.006, 8, 24),
    plastic('#e8e6e2', {metalness: 0.6, roughness: 0.3})
  );
  ring.position.set(W * 0.4, T - 0.01, D / 2 + 0.24);
  const charm = decal(0.2, 0.2, (cx, w, h) => drawMotif(cx, motif, w / 2, h / 2, w * 0.42, trim, shade(base, -0.3)), {
    px: 256
  });
  charm.material.side = THREE.DoubleSide;
  charm.position.set(W * 0.4, T - 0.14, D / 2 + 0.25);
  g.add(pull, ring, charm);
  return g;
}

/**
 * 品の 3D の形を組み立てる。戻りは GLB の scene と同じ向き（長さ y・上 z・手前 x）の Group。
 * 回す軸を決めるため、クリップに当たる部品はない（全体の中心で回る）
 */
export function buildCute(id, item) {
  const view =
    id === 'tool-timer-cute'
      ? timer(item)
      : id === 'pouch-cute'
        ? pouch(item)
        : id === 'case-cute'
          ? pencase(item)
          : null;
  if (!view) throw new Error(`3D の形がありません：${id}`);
  view.traverse((o) => {
    if (o.isMesh && !o.material.transparent) o.castShadow = true;
  });
  // 見る向き（X 右・Y 上・Z 手前）→ GLB の向き（x 手前・y 右・z 上）
  view.applyMatrix4(new THREE.Matrix4().set(0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1));
  const root = new THREE.Group();
  root.add(view);
  return root;
}
