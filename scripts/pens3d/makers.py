# 既製品のペンの 3D モデル（GLB）。build.py の部品（lathe・sweep・wrapped_text など）で、実物の寸法（mm）に合わせて組む。
# build.py の FAMILIES に足して使う（python3 scripts/pens3d/build.py --only jetstream など）。
# 向きと決まりは build.py と同じ：ペン先が原点、軸は +Z、クリップは −Y（正面 +X に印字）。
#
# 寸法は各社・販売店の仕様（2026 年 11 月に確かめた）から。公表値は下の PUBLISHED にまとめ、書き出すたびに 0.1 mm まで照合する
# （全長はボールの先から天まで）。公表されていない細部（口金の形・クリップの厚みなど）は写真の比率から決めた推定で、
# 実測で差し替える（MEASURE.md の表）
# 材質の名前：品の色で塗るもの（Body・Accent・Grip・Print・Ink。renderer/model3d-three.js の tint）と、
# 塗らないもの（Chrome・Steel・Makrolon・…）を分ける。透明の部品は ClearBarrel など（アプリが半透明で描く）
import math

import bmesh
import bpy
import numpy as np
from mathutils import Vector

from build import (fillet, lathe, lathe_fn, material, normal_map, obj_from_bm, pnoise, ridged, save_image, srgb,
                   sweep, wrapped_text)

FONT_SANS = '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf'
FONT_SANS_B = '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf'
FONT_SERIF_B = '/usr/share/fonts/truetype/liberation/LiberationSerif-Bold.ttf'
FONT_SCRIPT = '/usr/share/fonts/truetype/freefont/FreeSerifBoldItalic.ttf'  # 筆記体に近い字（カヴェコのロゴの代わり）
CLIP = -math.pi / 2  # クリップの向き（−Y）


# ---- 共通の部品 ----
def hairline_maps(name, rough_base, amp=0.02, seed=7, px=512):
    """長さの向きのヘアライン（ブラッシュ仕上げのステンレス・マクロロン）。lathe の UV（u が円周・v が長さ）で筋が長さに沿う"""
    rng = np.random.default_rng(seed)
    lines = pnoise(px, px, 60, 0.6, rng)  # 行（v＝長さ）に沿って伸び、列（u＝円周）で変わる筋
    rough = np.clip(rough_base + amp * lines, 0, 1)
    height = 0.0006 * lines
    return (save_image(f'{name}Rough', rough, 'Non-Color', 'JPEG'),
            save_image(f'{name}Normal', normal_map(height, 0.08, 1.0), 'Non-Color', 'PNG'))


def poly_radius(n, apothem, rc, phase=0.0):
    """正 n 角形（中心から辺までの距離 apothem・角の丸み rc）の、角度 → 中心から縁までの距離の関数。
    phase は辺の 1 つの向き（その辺の真ん中が phase の方向を向く）"""
    a_in = apothem - rc  # 丸める前の小さな多角形（それを rc だけふくらませると、角の丸い多角形）
    R_in = a_in / math.cos(math.pi / n)
    verts = [(R_in * math.cos(phase + math.pi / n + 2 * math.pi * k / n),
              R_in * math.sin(phase + math.pi / n + 2 * math.pi * k / n)) for k in range(n)]

    def dist(px, py):
        best = 1e9
        for k in range(n):
            ax, ay = verts[k]
            bx, by = verts[(k + 1) % n]
            dx, dy = bx - ax, by - ay
            t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
            qx, qy = ax + t * dx - px, ay + t * dy - py
            best = min(best, math.hypot(qx, qy))
        return best

    cache = {}

    def r(theta):
        key = round(theta % (2 * math.pi), 6)
        if key in cache:
            return cache[key]
        c, s = math.cos(theta), math.sin(theta)
        lo, hi = 0.0, apothem / math.cos(math.pi / n) + rc
        for _ in range(40):  # 縁は内側の多角形から rc の距離：二分法で求める
            mid = (lo + hi) / 2
            inside = mid <= a_in / max(1e-9, max(math.cos(theta - (phase + 2 * math.pi * k / n)) for k in range(n)))
            if inside or dist(mid * c, mid * s) < rc:
                lo = mid
            else:
                hi = mid
        cache[key] = lo
        return lo

    return r


def polygon_barrel(name, n, apothem, rc, z0, z1, mat, phase, ends=None, seg=192, zs=None):
    """角の丸い多角形の軸（z0〜z1）。ends(z) は端の面取り（0〜1 の縮み）。縁の丸みは lathe_fn の点で表す"""
    rf = poly_radius(n, apothem, rc, phase)
    zs = zs or ([z0 + (z1 - z0) * i / 40 for i in range(41)])
    return lathe_fn(name, zs, lambda z, a: rf(a) * (ends(z) if ends else 1.0), mat, seg=seg)


def ccw(outline):
    """輪郭 (u, v) を、(v, u) の面で左回りにそろえる（面の表が外を向く）"""
    area = sum(outline[k][1] * outline[(k + 1) % len(outline)][0] - outline[(k + 1) % len(outline)][1] * outline[k][0]
               for k in range(len(outline)))
    return outline if area > 0 else outline[::-1]


def flat_plate(name, outline, z_thick, mat, center, normal_axis):
    """平らな板（輪郭 outline は (u, v) の並び。u は長さ方向 z、v は円周の向き）。軸の面の上に置く札・旗など"""
    outline = ccw(outline)
    bm = bmesh.new()
    top = [bm.verts.new((0, v, u)) for u, v in outline]
    bot = [bm.verts.new((-z_thick, v, u)) for u, v in outline]
    bm.faces.new(top)
    bm.faces.new(list(reversed(bot)))
    m = len(outline)
    for k in range(m):
        bm.faces.new((top[k], bot[k], bot[(k + 1) % m], top[(k + 1) % m]))
    bm.normal_update()
    ob = obj_from_bm(name, bm, mat, smooth=False)
    ob.location = center
    ob.rotation_euler = (0, 0, normal_axis)
    return ob


def rounded_rect(u0, u1, v0, v1, r, n=4):
    pts = []
    for cu, cv, a0 in ((u1 - r, v1 - r, 0), (u0 + r, v1 - r, 90), (u0 + r, v0 + r, 180), (u1 - r, v0 + r, 270)):
        for k in range(n + 1):
            a = math.radians(a0 + 90 * k / n)
            pts.append((cu + r * math.cos(a), cv + r * math.sin(a)))
    return pts


def clip_path(z_top, z_bottom, off_root, off_mid, off_end, n=60, bump=0.0):
    """軸に沿って下りるクリップの中心線（−Y の向き）。付け根で軸へ曲がり込み、先へ行くほど軸へ寄る。bump は先の玉のふくらみ"""
    pts = []
    for i in range(n + 1):
        t = i / n
        z = z_top - t * (z_top - z_bottom)
        if t < 0.08:
            off = off_root + (t / 0.08) * (off_mid - off_root)
        elif t < 0.9:
            off = off_mid - (t - 0.08) / 0.82 * (off_mid - off_end)
        else:
            off = off_end - math.sin((t - 0.9) / 0.1 * math.pi) * bump
        pts.append((0, -off, z))
    return pts


def face_text(name, text, font, size, z_start, apothem, face, mat, lift=0.04, shift=0.0):
    """多角形の軸の平らな面（中心からの距離 apothem・向き face）に置く印字。
    円柱に巻くと面の端で字が面の中へ沈むので、巻いたあと面の平面へ移す（弧の長さはそのまま）。
    shift は面の上で横（角度の増える向き）へずらす量（mm。2 行の字に使う）"""
    ob = wrapped_text(name, text, font, size, z_start, apothem, face, mat, lift=0.0)
    c, s = math.cos(face), math.sin(face)
    for v in ob.data.vertices:
        x, y = v.co.x, v.co.y
        n, t = x * c + y * s, -x * s + y * c
        arc = apothem * math.atan2(t, n) + shift
        v.co.x = c * (apothem + lift) - s * arc
        v.co.y = s * (apothem + lift) + c * arc
    return ob


def circ_text(name, text, font, size, z_center, radius, a_start, mat, lift=0.03):
    """円周に沿って横に並ぶ字（軸を立てて見ると横書き。ジョッターの PARKER など）。a_start は字の始まりの角度"""
    ob = wrapped_text(name, text, font, size, 0.0, radius, 0.0, mat, lift=0.0)
    for v in ob.data.vertices:
        along, up = v.co.z, -math.atan2(v.co.y, v.co.x) * radius
        a = a_start + along / radius
        v.co.x, v.co.y, v.co.z = (radius + lift) * math.cos(a), (radius + lift) * math.sin(a), z_center + up
    return ob


def bent_plate(name, outline, thick, mat, inner, toward=CLIP, limit=0.45):
    """軸に沿って曲がる板（クリップ）。outline は (u=z, v=横) の輪郭（凹んだ形でもよい）。
    inner(z) は板の内側の面の、軸の中心からの距離。toward は板が乗る向き"""
    outline = ccw(outline)
    bm = bmesh.new()
    top = [bm.verts.new((v, u, 1.0)) for u, v in outline]
    bot = [bm.verts.new((v, u, 0.0)) for u, v in outline]
    bm.faces.new(top)
    bm.faces.new(list(reversed(bot)))
    m = len(outline)
    for k in range(m):
        bm.faces.new((bot[k], bot[(k + 1) % m], top[(k + 1) % m], top[k]))
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    for _ in range(10):  # 曲げるので、長い辺を割っておく（厚みの向きの辺は割らない）
        long_edges = [e for e in bm.edges
                      if math.hypot(e.verts[0].co.x - e.verts[1].co.x, e.verts[0].co.y - e.verts[1].co.y) > limit]
        if not long_edges:
            break
        bmesh.ops.subdivide_edges(bm, edges=long_edges, cuts=1, use_grid_fill=False)
        bmesh.ops.triangulate(bm, faces=[f for f in bm.faces if len(f.verts) > 3])
    c, s = math.cos(toward), math.sin(toward)
    for v in bm.verts:
        lat, z, w = v.co.x, v.co.y, v.co.z
        d = inner(z) + w * thick
        v.co = Vector((c * d - s * lat, s * d + c * lat, z))
    bm.normal_update()
    return obj_from_bm(name, bm, mat, smooth=False)


def knurl(base, depth, n, pitch):
    """綾目のローレット（ひし形の山）の半径の関数。base(z) は山の頂の半径"""
    def tri(x):
        return 1.0 - 2.0 * abs((x % 1.0) - 0.5)

    def r(z, a):
        u = n * a / (2 * math.pi)
        h = min(tri(u + z / pitch), tri(u - z / pitch))
        return base(z) - depth * (1.0 - h)

    return r


def tip(M, z_end=3.6, r_end=1.6, ball=0.25):
    """ペン先：金属の口金とボール"""
    lathe('Tip', fillet([(0, 0.0), (0.45, 0.05), (0.62, 0.5), (1.0, 1.6), (r_end - 0.05, z_end - 0.2), (r_end, z_end),
                         (0, z_end)], 0.15), M['tip'])
    lathe('TipBall', [(0, -ball * 0.5), (ball * 0.7, -ball * 0.3), (ball, 0.0), (ball * 0.7, ball * 0.3), (0, ball * 0.5)],
          M['ball'])


def metals():
    return {
        'tip': material('TipMetal', (0.85, 0.85, 0.86), metallic=1.0, roughness=0.18),
        'ball': material('Ball', (0.5, 0.5, 0.52), metallic=1.0, roughness=0.12),
        'chrome': material('Chrome', (0.93, 0.93, 0.93), metallic=1.0, roughness=0.06),
    }


# ---- ジェットストリーム（三菱鉛筆 SXN-150-05）----
def jetstream():
    """全長 139.6・軸径 11.3。軸と天冠・ノックは品の色（Body）、ラバーのグリップ（Grip）、銀色の樹脂のクリップ"""
    M = metals()
    M['body'] = material('Body', srgb('#1d1e21'), roughness=0.22, coat=0.6)
    M['grip'] = material('Grip', srgb('#1b1b1d'), roughness=0.78)
    M['clip'] = material('ClipSilver', srgb('#c4c7cc'), metallic=0.85, roughness=0.3)  # 銀色に塗った樹脂
    M['print'] = material('Print', (0.92, 0.92, 0.92), roughness=0.45)
    R = 5.65
    tip(M, z_end=3.4, r_end=1.45)
    # 先の円すい（軸と同じ色の樹脂）
    lathe('Cone', fillet([(0, 3.2), (1.4, 3.2), (1.55, 3.5), (3.2, 8.5), (4.7, 13.4), (5.05, 14.4), (5.05, 14.8),
                          (0, 14.8)], 0.4), M['body'])
    # ラバーのグリップ：わずかにふくらみ、細かな輪の溝
    grip = [(0, 14.6), (5.0, 14.6), (5.35, 15.2)]
    for i in range(0, 241):
        z = 15.2 + (40.6 - 15.2) * i / 240
        bulge = 0.18 * math.sin(math.pi * (z - 15.2) / 25.4)
        ph = (z - 15.2) / 0.9
        grip.append((5.38 + bulge - 0.07 * (1 - math.cos(2 * math.pi * ph)) * 0.5, z))
    grip += [(5.42, 41.0), (5.25, 41.6), (0, 41.6)]
    lathe('Grip', grip, M['grip'])
    # 軸：グリップの上で少し細くなり、上へ向けてわずかに太る
    lathe('Barrel', fillet([(0, 41.2), (5.3, 41.2), (5.45, 41.9), (5.5, 46), (R, 80), (R, 112), (5.55, 114.2), (5.2, 115),
                            (0, 115)], 0.4), M['body'])
    # 天冠（クリップの付け根。少し太い）とノック
    lathe('TopCap', fillet([(0, 114.6), (5.5, 114.6), (5.65, 115.4), (5.65, 128.6), (5.25, 130.2), (0, 130.2)], 0.6),
          M['body'])
    # ノック：なめらかな筒で、天はわずかに丸い
    lathe('Knock', fillet([(0, 129.8), (3.5, 129.8), (3.55, 130.4), (3.5, 137.5), (3.2, 138.8), (2.2, 139.4), (0, 139.475)],
                          0.5), M['body'])
    # クリップ：幅 4.8、天冠の上から 44 mm 下りる。先は軸へ触れる玉
    # 樹脂の厚いクリップ（成形品：幅 5.0・厚み 2.2。付け根は天冠に埋まり、表に細い稜線、先は軸へ触れるふくらみ）
    cp = clip_path(128.0, 86.0, 4.6, 7.1, 6.55, bump=0.35)
    sweep('Clip', cp, 5.0, 2.2, M['clip'], lambda p: (0, -1, 0), round_r=0.8)
    sweep('ClipRib', [(x, y - 1.15, z) for x, y, z in cp[6:-6]], 1.2, 0.35, M['clip'], lambda p: (0, -1, 0), round_r=0.15)
    lathe('ClipTipBall', fillet([(0, 84.6), (1.5, 84.8), (1.75, 86.4), (1.5, 88.0), (0, 88.2)], 0.45), M['clip'],
          seg=48).location = (0, -6.0, 0)
    # 印字（軸の正面）：商品名・会社名・字幅
    wrapped_text('Print_name', 'JETSTREAM', FONT_SANS_B, 2.6, 50.0, R, 0.0, M['print'], lift=0.04)
    wrapped_text('Print_maker', 'uni  MITSUBISHI PENCIL', FONT_SANS, 1.5, 84.0, R, 0.0, M['print'], lift=0.04)
    wrapped_text('Print_mm', '0.5', FONT_SANS_B, 2.0, 106.0, R, 0.0, M['print'], lift=0.04)


# ---- サラサクリップ 0.5（ゼブラ JJ15）----
def sarasa_clip():
    """最大径 11.0。透明の軸の中に替え芯（JF-0.5）が見える。クリップ・ノックは品の色（Accent）、
    グリップは半透明のラバー。クリップは大きなばねのクリップ（付け根の上から下りる）"""
    M = metals()
    M['clear'] = material('ClearBarrel', (0.95, 0.97, 0.98), roughness=0.05, transmission=1.0, ior=1.5)
    M['grip'] = material('ClearGrip', (0.86, 0.9, 0.92), roughness=0.35, transmission=1.0, ior=1.45)
    M['accent'] = material('Accent', srgb('#1b1b1b'), roughness=0.3, coat=0.4)
    M['ink'] = material('Ink', srgb('#141414'), roughness=0.4)
    M['refill'] = material('ClearRefill', (0.95, 0.95, 0.95), roughness=0.15, transmission=1.0, ior=1.45)
    M['spring'] = material('Spring', (0.8, 0.8, 0.82), metallic=1.0, roughness=0.25)
    M['print'] = material('PrintW', (0.97, 0.97, 0.97), roughness=0.4)
    tip(M, z_end=4.2, r_end=1.35)
    # 透明の先の円すい
    lathe('Cone', fillet([(0, 4.0), (1.3, 4.0), (1.5, 4.4), (3.0, 8.0), (4.4, 12.0), (4.8, 13.0), (0, 13.0)], 0.4),
          M['clear'])
    # 半透明のラバーグリップ：太めで、細い輪の溝
    grip = [(0, 12.8), (4.8, 12.8), (5.3, 13.6)]
    grip += ridged(5.5, 14.0, 38.6, 0.12, 0.7)
    grip += [(5.35, 39.2), (5.0, 39.6), (0, 39.6)]
    lathe('Grip', grip, M['grip'])
    # 透明の軸（中が見える）
    lathe('Barrel', fillet([(0, 39.2), (5.0, 39.2), (5.15, 39.8), (5.2, 60), (5.25, 112), (5.0, 113), (0, 113)], 0.4),
          M['clear'])
    # 中の替え芯（インクの色の筒・先の口金）とばね
    lathe('Refill', fillet([(0, 4.6), (0.9, 4.6), (1.2, 9.0), (1.2, 12.0), (1.9, 13.0), (1.9, 120.0), (0, 120.0)], 0.2),
          M['refill'])
    lathe('Ink', [(0, 22.0), (1.75, 22.0), (1.75, 92.0), (0, 92.0)], M['ink'], seg=48)
    coil = []
    for i in range(200):  # ばね（先の円すいの中）
        t = i / 199
        a = t * 2 * math.pi * 7
        coil.append((2.2 * math.cos(a), 2.2 * math.sin(a), 5.6 + t * 6.0))
    sweep('Spring', coil, 0.35, 0.35, M['spring'], lambda p: (p.x, p.y, 0), round_r=0.15, n_round=2)
    # 上の部品（品の色）：クリップの付け根とノック
    lathe('TopCap', fillet([(0, 112.6), (5.05, 112.6), (5.3, 113.6), (5.3, 130.4), (4.6, 131.4), (0, 131.4)], 0.6),
          M['accent'])
    lathe('Knock', fillet([(0, 131.0), (3.6, 131.0), (3.65, 139.2), (3.2, 140.6), (0, 140.8)], 0.5), M['accent'])
    # 大きなばねのクリップ（幅 6.0、天冠の上から 50 mm 下りる。先は少し反り返る）
    path = clip_path(130.0, 82.0, 5.0, 7.4, 6.0, bump=0.0)
    path += [(0, -6.2, 81.0), (0, -6.6, 80.0)]
    sweep('Clip', path, 6.6, 1.9, M['accent'], lambda p: (0, -1, 0), round_r=0.7)
    # クリップの表の印字（白）：クリップの外の面の高さ（中心線から厚みの半分＋α）に沿わせる
    zz = [p[2] for p in path][::-1]
    oo = [-p[1] for p in path][::-1]
    wrapped_text('Print_clip', 'SARASA', FONT_SANS_B, 2.3, 95.0, lambda z: float(np.interp(z, zz, oo)) + 0.97, CLIP,
                 M['print'], lift=0.02)
    wrapped_text('Print_mm', '0.5', FONT_SANS_B, 1.8, 120.0, 5.3, 0.0, M['print'], lift=0.04)


# ---- カランダッシュ 849 ボールペン ----
def grain_maps(name, rough_base, amp=0.08, seed=13, px=512, tile=6.0):
    """細かい粒のつや消し（ブラストのアルマイト）。粒は 0.03〜0.05 mm。つなぎ目なく繰り返す（1 枚が tile mm 四方）"""
    rng = np.random.default_rng(seed)
    n = rng.normal(size=(px, px))
    from build import gblur
    h = gblur(n, 0.9)
    h /= h.std() + 1e-12
    rough = np.clip(rough_base + amp * h, 0, 1)
    return (save_image(f'{name}Rough', rough, 'Non-Color', 'JPEG'),
            save_image(f'{name}Normal', normal_map(0.0012 * h, tile / px, 1.0), 'Non-Color', 'PNG'))


def wrap_uv(ob, tile):
    """回転体（lathe_fn）に UV を付ける：u は円周の長さ、v は z（どちらも tile mm で 1）。角度のつなぎ目をまたぐ面は直す"""
    me = ob.data
    uv = me.uv_layers.new(name='UVMap')
    for p in me.polygons:
        us = []
        for li in p.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            a = math.atan2(co.y, co.x) % (2 * math.pi)
            us.append((li, a, co.z, math.hypot(co.x, co.y)))
        amax = max(a for _, a, _, _ in us)
        for li, a, z, r in us:
            if amax - a > math.pi:
                a += 2 * math.pi
            uv.data[li].uv = (a * 4.6 / tile, z / tile)


def channel(name, z0, z1, off, width, prof, mat):
    """クリップの板（断面 prof＝(横, 高さ) の閉じた形）を z0〜z1 に沿って押し出す。off(z) は板の下の面の中心からの距離、
    width(z) は横の倍率。クリップは −Y の向き"""
    bm = bmesh.new()
    n = 90
    rings = []
    for i in range(n + 1):
        z = z0 + (z1 - z0) * i / n
        o, w = off(z), width(z)
        rings.append([bm.verts.new((v * w, -(o + h), z)) for v, h in prof])
    m = len(prof)
    for i in range(n):
        for k in range(m):
            bm.faces.new((rings[i][k], rings[i][(k + 1) % m], rings[i + 1][(k + 1) % m], rings[i + 1][k]))
    f0 = bm.faces.new(list(reversed(rings[0])))
    f1 = bm.faces.new(rings[-1])
    bmesh.ops.triangulate(bm, faces=[f0, f1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    return obj_from_bm(name, bm, mat, smooth=False)


def caran_849(premium=False):
    """カランダッシュ 849。角の丸い六角のアルミ軸（辺から辺まで 9）。先は円すいに削られ、六角の面と円すいの境が
    鉛筆を削ったときのような波の形になる。天の端は大きく面取りし、丸い金属のノック（周りに CARAN d'ACHE の刻印）。
    クリップは、軸の半周に巻き付く板（サドル。ペン先側の縁は山形）から U 字に折り返す、山形の屋根の断面の板。
    印字は「849 CARAN d'ACHE」と枠で囲んだ「SWISS / MADE」。全長 128（販売店の表記）。
    寸法の比率は、カランダッシュの 3D ビュー（849 プレミアム）の画面から取った（軸の辺から辺 9 mm を物差しにした推定）。
    premium（ブリュットロゼなど）：軸は細かい粒のつや消しのアルマイト、クリップとノックはつやのある金属の品の色（Accent）。
    ふつう（クラシック）：つやのある塗装の軸、銀のクリップ"""
    M = metals()
    if premium:
        rough, nrm = grain_maps('Caran', 0.46, amp=0.1)
        M['body'] = material('Body', srgb('#d7b4a0'), metallic=0.6, roughness=0.46, rough_map=rough, normal_map=nrm,
                             normal_strength=0.6)
        M['clip'] = material('Accent', srgb('#d9a88c'), metallic=0.85, roughness=0.28)
        M['cap'] = M['clip']
        M['engrave'] = material('Engrave', srgb('#6e4f40'), metallic=0.8, roughness=0.5)
    else:
        M['body'] = material('Body', srgb('#c8102e'), roughness=0.2, coat=0.8, coat_rough=0.04)
        M['clip'] = material('Steel', (0.88, 0.88, 0.88), metallic=1.0, roughness=0.2)
        M['cap'] = M['body']
    M['print'] = material('PrintW', (0.96, 0.96, 0.96), roughness=0.4)
    M['pin'] = material('Pin', (0.05, 0.04, 0.04), roughness=0.6)
    # 芯：ゴリアット（ISO 12757-2 の G2 の形。中字 M は線の太さ 1.0 mm）。軸の先の穴から、径 2.3 の筒と円すいの金属の先が出て、
    # 先に径 1.0 のボール（線の太さ 1.0 mm から決めた推定）。ボールの先が z = −0.05
    lathe('RefillTip', fillet([(0, 0.3), (0.42, 0.32), (0.6, 0.62), (1.15, 2.7), (1.15, 6.0), (0, 6.0)], 0.12), M['tip'],
          seg=96)
    lathe('TipBall', [(0, -0.05), (0.35, 0.1), (0.5, 0.45), (0.35, 0.8), (0, 0.95)], M['ball'], seg=48)
    ap = 4.5
    E = 124.95  # 軸の天の端（ノックの頭 3.0 mm と合わせて、ボールの先から 128.0）
    phase = math.radians(-90)  # 辺の 1 つがクリップ（−Y）を向く
    rf = poly_radius(6, ap, 0.55, phase)
    # 先：六角の軸を円すい（1 mm 進むごとに半径が 0.142 mm 太る）で削る。円すいの半径が辺までの距離（4.5）を超えると
    # 面の真ん中から六角が現れ、角までの距離（5.1）を超えると全部が六角になる。その間、境は面ごとの弧＝波の形
    k_cone = 0.142

    def cone(z):
        return 1.2 + (z - 3.4) * k_cone

    def end(z):  # 天の端の面取り（1.3 mm で辺の距離が 0.84 倍に）
        return 1.0 - 0.16 * ((z - (E - 1.3)) / 1.3) ** 1.6 if z > E - 1.3 else 1.0

    def r(z, a):
        return min(rf(a) * end(z), cone(z))

    z_wave0, z_wave1 = 3.4 + (ap - 0.15 - 1.2) / k_cone, 3.4 + (5.25 - 1.2) / k_cone
    zs = [3.4 + (z_wave0 - 3.4) * i / 24 for i in range(24)]
    zs += [z_wave0 + (z_wave1 - z_wave0) * i / 100 for i in range(100)]
    zs += [z_wave1 + (E - 1.3 - z_wave1) * i / 40 for i in range(40)] + [E - 1.3 + 1.3 * i / 8 for i in range(9)]
    ob = lathe_fn('Barrel', zs, r, M['body'], seg=384)
    if premium:
        wrap_uv(ob, 6.0)
    # 六角の面と円すいの境を角として描く（なめらかにつながないので、波の線がくっきり出る）
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    for f in bm.faces:
        c = f.calc_center_median()
        f.tag = cone(c.z) < rf(math.atan2(c.y, c.x)) * end(c.z) - 1e-4
    for e in bm.edges:
        if len(e.link_faces) == 2 and e.link_faces[0].tag != e.link_faces[1].tag:
            e.smooth = False
    bm.to_mesh(ob.data)
    bm.free()
    # ノック：丸い金属の頭（径 6.9・出ている長さ 3.0。天の縁は丸く、天は平ら）。周りに CARAN d'ACHE の刻印
    lathe('KnockCap', fillet([(0, E - 0.6), (3.45, E - 0.6), (3.45, E + 2.45), (3.2, E + 3.0), (0, E + 3.0)], 0.45),
          M['cap'], seg=128)
    if premium:
        circ_text('Print_knock', "CARAN d'ACHE", FONT_SERIF_B, 1.9, E + 1.25, 3.45, math.radians(-60), M['engrave'],
                  lift=0.01)
    # クリップの付け根（サドル）：クリップの面と両隣の面（軸の半周）に巻き付く厚さ 0.5 の板。
    # ノック側の縁は E−9.4 でまっすぐ、ペン先側の縁は山形（クリップの面の真ん中で E−14.0、半周の端で E−20.8）。端の角は丸い耳
    z_hi = E - 9.4

    def z_lo(a):  # a はクリップの向きからの角度（ラジアン、0〜π/2）
        return E - 14.0 - (20.8 - 14.0) * abs(a) / (math.pi / 2)

    bm = bmesh.new()
    na, nz, t = 120, 10, 0.5
    grid = []
    for i in range(na + 1):
        a = -math.pi / 2 + math.pi * (i / na - 0.5)  # −π〜0（クリップは −π/2）
        rel = a + math.pi / 2
        d_end = min(i, na - i) / na * math.pi * ap  # 端からの弧の長さ（mm）
        rr = 0.9  # 耳の角の丸み
        cut = rr - math.sqrt(max(0.0, rr * rr - (rr - d_end) ** 2)) if d_end < rr else 0.0
        lo, hi = z_lo(rel) + cut, z_hi - cut
        row = []
        for j in range(nz + 1):
            z = lo + (hi - lo) * j / nz
            base = rf(a) - 0.02
            row.append((bm.verts.new((base * math.cos(a), base * math.sin(a), z)),
                        bm.verts.new(((base + t) * math.cos(a), (base + t) * math.sin(a), z))))
        grid.append(row)
    for i in range(na):
        for j in range(nz):
            bm.faces.new((grid[i][j][1], grid[i + 1][j][1], grid[i + 1][j + 1][1], grid[i][j + 1][1]))
            bm.faces.new((grid[i][j + 1][0], grid[i + 1][j + 1][0], grid[i + 1][j][0], grid[i][j][0]))
    for i in range(na):  # ペン先側とノック側の縁
        for j in (0, nz):
            q = (grid[i][j][0], grid[i + 1][j][0], grid[i + 1][j][1], grid[i][j][1])
            bm.faces.new(q if j == 0 else tuple(reversed(q)))
    for i in (0, na):  # 両端の縁
        for j in range(nz):
            q = (grid[i][j][0], grid[i][j][1], grid[i][j + 1][1], grid[i][j + 1][0])
            bm.faces.new(q if i == 0 else tuple(reversed(q)))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    obj_from_bm('ClipSaddle', bm, M['clip'], smooth=True)
    # クリップの板：厚さ 0.22 の板を、山形の屋根（幅 3.2・高さ 0.9）にし、両側を下へ曲げてさらに内側へ折り込んだ断面
    # （裏から見ると、両側に幅 0.7 の折り込みが並び、真ん中が溝）。軸と平行ではなく、U 字の折り返し（E−9.0）では
    # 板の下の面が軸の面から 1.9 浮き、ペン先へ向けてまっすぐ下りて先（E−45.5）で軸に触れる。傾きは約 2.9°
    # （カランダッシュの 3D ビューの横からの画面で測った推定）。先の 3.5 mm は幅が細る
    prof = [(-0.9, 0.0), (-1.48, 0.0), (-1.58, 0.04), (-1.6, 0.14), (-1.6, 0.55), (0.0, 0.9), (1.6, 0.55), (1.6, 0.14),
            (1.58, 0.04), (1.48, 0.0), (0.9, 0.0), (0.9, 0.22), (1.38, 0.22), (1.38, 0.48), (0.0, 0.68),
            (-1.38, 0.48), (-1.38, 0.22), (-0.9, 0.22)]
    z_tip, z_root = E - 45.5, E - 9.0
    lift_root = 1.9

    def off(z):  # 板の下の面の、軸の中心からの距離（まっすぐな傾き）
        return ap + 0.03 + (lift_root - 0.03) * (z - z_tip) / (z_root - z_tip)

    def wid(z):
        return float(np.interp(z, [z_tip, z_tip + 3.5, z_root], [0.45, 1.0, 1.0]))

    channel('Clip', z_tip, z_root, off, wid, prof, M['clip'])
    # U 字の折り返し：板の根元（厚みの真ん中 ap+1.9+0.45）から丸く曲がってサドルの上（ap+0.5+0.15）へ下りる
    cz = z_root
    y_top, y_bot = ap + lift_root + 0.45, ap + 0.65
    cy, rad = (y_top + y_bot) / 2, (y_top - y_bot) / 2
    path = [(0, -(cy + rad * math.cos(math.pi * k / 16)), cz + rad * math.sin(math.pi * k / 16)) for k in range(17)]
    sweep('ClipBend', path, 3.2, 0.3, M['clip'], lambda p: (0, p.y + cy, p.z - cz), round_r=0.12)
    # 折り返しの軸（ばねのピン）の穴：両横に小さな暗い丸（U 字の中心）
    for sgn in (1, -1):
        pin = lathe(f'ClipPin{"LR"[sgn < 0]}', [(0, -0.05), (0.32, -0.05), (0.32, 0.05), (0, 0.05)], M['pin'], seg=24)
        pin.rotation_euler = (0, math.pi / 2, 0)
        pin.location = (sgn * 1.62, -cy, cz)
    # 印字（クリップの隣の面＝正面寄りの面）：849 CARAN d'ACHE、天の近くに枠で囲んだ SWISS / MADE
    face = math.radians(-30)
    face_text('Print_849', '849', FONT_SANS, 1.15, E - 34.7, ap, face, M['print'], lift=0.04)
    face_text('Print_brand', "CARAN d'ACHE", FONT_SERIF_B, 1.6, E - 31.5, ap, face, M['print'], lift=0.04)
    zc, half, lw = E - 5.3, 1.45, 0.11
    c, s = math.cos(face), math.sin(face)
    for k, (u0, u1, v0, v1) in enumerate(((zc - half, zc + half, half - lw, half), (zc - half, zc + half, -half, -half + lw),
                                          (zc - half, zc - half + lw, -half, half), (zc + half - lw, zc + half, -half, half))):
        flat_plate(f'Print_box{k}', rounded_rect(u0, u1, v0, v1, 0.0, 1), 0.04, M['print'], (c * (ap + 0.04), s * (ap + 0.04), 0),
                   face)
    # 2 行（字の箱の中心が 0.08 mm 下へずれるので、その分を引いて ±0.45 mm に置く）
    face_text('Print_swiss', 'SWISS', FONT_SANS, 0.86, zc - 1.15, ap, face, M['print'], lift=0.04, shift=-0.53)
    face_text('Print_made', 'MADE', FONT_SANS, 0.86, zc - 1.0, ap, face, M['print'], lift=0.04, shift=0.37)


# ---- パーカー ジョッター コアライン（ボンドストリートブラック CT）----
def parker_jotter():
    """パーカー ジョッター コアライン（ボンドストリートブラック CT）。つや消しの黒い塗装の下の軸（品の色 Body。長い葉巻の形で
    ペン先へ細る）、ヘアラインのステンレスの上の部品（継ぎ目に輪はなく、上の部品の下の縁が軸にかぶさる）、肩で細る銀の天冠、
    天の近くに溝が 2 本の銀のノック。矢のクリップ（付け根に矢羽根、細い軸、中を抜いた矢じり）。芯はパーカーの G2 の形。
    全長 129・軸径 9.7（販売店の表記）。各部の位置は写真の比率から決めた推定（全長 129 を物差し）"""
    M = metals()
    rough, nrm = hairline_maps('Jotter', 0.3, amp=0.05)
    M['ss'] = material('StainlessBrushed', (0.78, 0.78, 0.79), metallic=1.0, roughness=0.3, rough_map=rough,
                       normal_map=nrm, normal_strength=0.6)
    M['body'] = material('Body', srgb('#2a2a2c'), roughness=0.5, coat=0.25, coat_rough=0.35)
    M['print'] = material('Engrave', (0.32, 0.32, 0.34), metallic=0.6, roughness=0.6)
    # 芯の先（G2 の形）：径 2.3 の筒と円すいの金属の先と、径 1.0 のボール（ボールの先が z = −0.05）
    lathe('RefillTip', fillet([(0, 0.3), (0.42, 0.32), (0.6, 0.62), (1.15, 2.7), (1.15, 6.0), (0, 6.0)], 0.12), M['tip'],
          seg=96)
    lathe('TipBall', [(0, -0.05), (0.35, 0.1), (0.5, 0.45), (0.35, 0.8), (0, 0.95)], M['ball'], seg=48)
    # 下の軸（黒）：先の穴（径 2.6）から長い葉巻の形で太り、継ぎ目の手前（z 70）で 9.7 になる
    zs = [3.4, 3.6, 6.0, 12.0, 20.0, 30.0, 40.0, 55.0, 70.0, 80.5]
    rs = [1.18, 1.3, 1.75, 2.55, 3.35, 3.95, 4.35, 4.68, 4.83, 4.83]
    lathe('Barrel', [(0, 3.4)] + list(zip(rs, zs)) + [(0, 80.5)], M['body'])
    # 上の部品（ステンレス）：下の縁（z 79）は丸く、黒い軸にかぶさる
    lathe('Upper', fillet([(0, 79.0), (4.6, 79.0), (4.85, 79.3), (4.85, 115.4), (0, 115.4)], 0.25), M['ss'])
    # 天冠（つやのある銀）：クリップの付け根を押さえる帯（z 115〜116.6）から、肩で細ってノックへ
    lathe('TopCap', fillet([(0, 115.0), (4.8, 115.0), (4.85, 115.3), (4.85, 116.6), (4.55, 117.6), (3.75, 119.3),
                            (3.6, 119.6), (0, 119.6)], 0.35), M['chrome'])
    # ノック：銀の筒（径 6.5）。天の近くに細い溝が 2 本、天は平らで縁が丸い
    lathe('Knock', fillet([(0, 119.2), (3.25, 119.2), (3.25, 126.4), (3.1, 126.55), (3.1, 126.75), (3.25, 126.9),
                           (3.25, 127.3), (3.1, 127.45), (3.1, 127.65), (3.25, 127.8), (3.25, 128.5), (2.9, 128.9),
                           (0, 128.95)], 0.08), M['chrome'], seg=96)
    # 矢のクリップ（1 枚の板）：付け根（天冠の下）から、矢羽根（幅 3.0）・細い軸（幅 1.9）・矢じり（幅 3.6）。
    # 矢じりの先（z 82）は上の部品の下の縁の少し上で、軸から少し浮いてから先で触れる
    outline = [(82.0, 0.0), (85.6, 1.8), (86.6, 1.5), (86.2, 0.95), (100.6, 0.95), (101.6, 1.5), (116.6, 1.5),
               (116.6, -1.5), (101.6, -1.5), (100.6, -0.95), (86.2, -0.95), (86.6, -1.5), (85.6, -1.8)]

    def inner(z):
        return float(np.interp(z, [81.8, 83.5, 100.0, 112.0, 114.6, 116.6], [4.88, 5.02, 5.28, 5.3, 4.9, 4.86]))

    bent_plate('Clip', outline, 0.85, M['chrome'], inner)
    for i in range(5):  # 矢羽根：中心の筋から斜め上へ開く山形の溝（左右 5 本ずつ）
        u0 = 102.2 + 2.0 * i
        for side in (1, -1):  # 山形の左右の腕（凸の四角 2 枚）
            arm = [(u0, 0.0), (u0 + 1.25, 1.3 * side), (u0 + 1.6, 1.3 * side), (u0 + 0.35, 0.0)]
            bent_plate(f'ClipFeather{i}{"LR"[side < 0]}', arm, 0.05, M['print'], lambda z: inner(z) + 0.86)
    bent_plate('ClipShaftLine', [(84.0, 0.15), (113.0, 0.15), (113.0, -0.15), (84.0, -0.15)], 0.05, M['print'],
               lambda z: inner(z) + 0.86)
    # 矢じりの中を抜いた形：外の縁に沿う山形の溝
    for side in (1, -1):
        arm = [(83.0, 0.0), (83.5, 0.0), (85.9, 1.2 * side), (85.5, 1.45 * side)]
        bent_plate(f'ClipHeadLine{"LR"[side < 0]}', arm, 0.05, M['print'], lambda z: inner(z) + 0.86)
    # 刻印：上の部品の下の縁の近く、クリップの右横から円周に沿って PARKER
    circ_text('Print_brand', 'PARKER', FONT_SANS, 1.35, 81.0, 4.85, math.radians(-74), M['print'], lift=0.02)


# ---- LAMY 2000 ボールペン ----
def lamy_2000():
    """マクロロン（ガラス繊維入りの樹脂）のヘアラインの黒い軸。真ん中がふくらむ葉巻の形（最大 11.9・握る所 10.0）。
    先はヘアラインのステンレスの円すい、天はステンレスの細い筒のノック。クリップはステンレスの幅広の板で先が四角。
    全長 137.4（販売店の表記は 136〜138）"""
    M = metals()
    rough, nrm = hairline_maps('Makrolon', 0.58, amp=0.03, seed=3)
    M['mak'] = material('Makrolon', srgb('#1c1c1d'), roughness=0.58, rough_map=rough, normal_map=nrm,
                        normal_strength=0.35)
    srough, snrm = hairline_maps('Lamy', 0.32, amp=0.05, seed=5)
    M['ss'] = material('StainlessBrushed', (0.76, 0.76, 0.77), metallic=1.0, roughness=0.32, rough_map=srough,
                       normal_map=snrm, normal_strength=0.6)
    M['print'] = material('Engrave', (0.3, 0.3, 0.32), metallic=0.5, roughness=0.6)
    tip(M, z_end=2.8, r_end=1.05)
    # 先の円すい（ステンレス）：ペン先から 19 mm、軸の握る所の太さへつながる
    lathe('Nose', fillet([(0, 2.6), (1.05, 2.6), (1.3, 3.0), (2.2, 6.0), (3.2, 10.0), (4.1, 14.5), (4.75, 18.4),
                          (4.85, 19.6), (0, 19.6)], 0.4), M['ss'])
    # 軸：握る所（半径 5.0）・真ん中のふくらみ（5.95）・上へ向けて細り、天は丸い肩
    zs = [19.4, 19.6, 20.0, 24.0, 32.0, 42.0, 55.0, 70.0, 85.0, 100.0, 110.0, 118.0, 124.0, 128.0, 130.2, 131.4, 132.0]
    rs = [0.0, 4.8, 4.92, 5.0, 5.2, 5.6, 5.92, 5.95, 5.85, 5.68, 5.55, 5.42, 5.25, 5.05, 4.75, 4.2, 0.0]
    lathe('Body', list(zip(rs, zs)), M['mak'])
    # ノック：ステンレスの細い筒（天は平らで縁が丸い）
    lathe('Knock', fillet([(0, 130.8), (3.3, 130.8), (3.35, 131.4), (3.35, 136.6), (3.0, 137.3), (0, 137.3)], 0.45),
          M['ss'], seg=96)
    # クリップ：ステンレスの平らな板（幅 5.0・厚み 1.3）。付け根は天の端で軸へ折れ込み、軸から少し離れて下り、先は四角。
    # 真ん中に細長い窓（ばねのすき間）が抜けている。表の付け根の近くに LAMY の刻印
    def inner(z):
        return 6.3 - 0.35 * (127.6 - z) / 34.6

    sweep('ClipRoot', [(0, -6.95, 127.2), (0, -6.6, 130.0), (0, -5.6, 131.6), (0, -5.0, 132.4)], 5.0, 1.3, M['ss'],
          lambda p: (0, -1, 0), round_r=0.3)
    bent_plate('Clip', rounded_rect(93.0, 101.2, -2.5, 2.5, 0.35), 1.3, M['ss'], inner)
    bent_plate('ClipBridge', rounded_rect(99.0, 101.4, -2.5, 2.5, 0.02, 1), 1.3, M['ss'], inner)
    bent_plate('ClipRailL', rounded_rect(100.8, 121.4, 1.25, 2.5, 0.05, 1), 1.3, M['ss'], inner)
    bent_plate('ClipRailR', rounded_rect(100.8, 121.4, -2.5, -1.25, 0.05, 1), 1.3, M['ss'], inner)
    bent_plate('ClipHead', rounded_rect(121.0, 127.6, -2.5, 2.5, 0.05, 1), 1.3, M['ss'], inner)
    # 刻印：表（クリップの外の面）の付け根の近く
    wrapped_text('Print_brand', 'LAMY', FONT_SANS, 1.05, 122.3, lambda z: inner(z) + 1.3, CLIP, M['print'], lift=0.02)


# ---- カヴェコ スペシャル ボールペン（アルミ・ブラック）----
def kaweco_special():
    """八角形のアルミ軸（つや消しの黒のアルマイト。辺から辺まで 10）。先はなめらかな丸い円すい、
    天は細い首と綾目のローレットのつまみ、小さな丸い頭。全長 144。クリップなし（別売り）"""
    M = metals()
    M['alu'] = material('KawecoAlu', srgb('#1e1e20'), metallic=0.9, roughness=0.32)
    M['cone'] = material('KawecoCone', srgb('#1b1b1d'), metallic=0.6, roughness=0.62)  # 先の円すいはつや消し
    M['print'] = material('PrintW', (0.88, 0.88, 0.88), roughness=0.45)
    tip(M, z_end=4.4, r_end=0.75)
    ap = 5.0
    phase = 0.0  # 辺の 1 つが正面（+X）
    # 口金：まっすぐな円すい（つや消しの黒。長さ 16）。先は平らに切れて、穴からペン先が出る。根元は八角の内側の円より少し細い
    lathe('Nose', fillet([(0.8, 6.0), (0.8, 4.0), (1.3, 4.0), (1.4, 4.15), (4.5, 19.6), (4.6, 20.2), (0, 20.2)], 0.12),
          M['cone'])
    zb = [19.9, 20.3, 20.9] + [20.9 + (130.8 - 20.9) * i / 36 for i in range(1, 36)] + [130.8, 131.2, 131.5]

    def ends(z):
        if z < 20.9:
            return 0.93 + 0.07 * (z - 19.9) / 1.0
        if z > 130.8:
            return 1.0 - 0.06 * (z - 130.8) / 0.7
        return 1.0

    polygon_barrel('Barrel', 8, ap, 0.35, 19.9, 131.5, M['alu'], phase, ends=ends, zs=zb)
    # 天：細い首・綾目のローレットのつまみ・小さな丸い頭
    lathe('Neck', fillet([(0, 131.3), (3.4, 131.3), (2.5, 132.0), (2.5, 133.6), (0, 133.6)], 0.2), M['alu'], seg=96)

    def kb(z):
        return float(np.interp(z, [133.4, 133.9, 140.5, 141.0], [3.0, 3.5, 3.5, 3.0]))

    zk = [133.4 + i * 0.07 for i in range(109)]
    lathe_fn('Knob', zk, knurl(kb, 0.22, 40, 0.9), M['alu'], seg=480)
    lathe('Dome', fillet([(0, 140.9), (2.8, 140.9), (2.85, 141.6), (2.5, 143.1), (1.5, 143.73), (0, 143.875)], 0.35),
          M['alu'], seg=96)
    # 印字（正面の面）：筆記体のロゴと Germany
    face_text('Print_brand', 'KawecoSpecial', FONT_SCRIPT, 3.0, 96.0, ap, 0.0, M['print'], lift=0.05)
    face_text('Print_made', 'Germany', FONT_SANS, 1.3, 120.0, ap, 0.0, M['print'], lift=0.05)


MAKER_FAMILIES = {
    'jetstream': jetstream,
    'sarasa-clip': sarasa_clip,
    'caran-849': caran_849,
    'caran-849-premium': lambda: caran_849(premium=True),
    'parker-jotter': parker_jotter,
    'lamy-2000': lamy_2000,
    'kaweco-special': kaweco_special,
}


# ---- 公表された寸法との照合（書き出すたびに確かめる）----
# 値は (下限, 上限) mm。出所が 1 つの値は幅なし。公表されていない部位は scripts/pens3d/MEASURE.md の実測の表で決める
PUBLISHED = {
    'jetstream': {'length': (139.6, 139.6), 'diameter': (11.3, 11.3)},  # 三菱鉛筆 SXN-150-05 の仕様
    'sarasa-clip': {'diameter': (11.0, 11.0)},  # ゼブラ JJ15 の仕様（最大径）
    'caran-849': {'length': (128.0, 128.0), 'flats': (9.0, 9.0)},  # 販売店の表記（収納時 128 mm・軸径 9 mm）
    'caran-849-premium': {'length': (128.0, 128.0), 'flats': (9.0, 9.0)},
    'parker-jotter': {'length': (129.0, 129.0), 'diameter': (9.7, 9.7)},  # 販売店の表記
    'lamy-2000': {'length': (136.0, 138.0), 'diameter': (11.9, 11.9), 'grip': (10.0, 10.0)},  # 販売店の表記
    'kaweco-special': {'length': (144.0, 144.0), 'flats': (10.0, 10.0)},  # 販売店の表記（八角の辺から辺）
}


GRIP_Z = {'lamy-2000': 24.0}  # 握る所の径を測る高さ（ペン先から）


def radius_at(z):
    """高さ z での軸の半径（クリップと印字を除く。外から軸へ向けて 24 方向から光線を当て、いちばん外の当たり）"""
    from mathutils.bvhtree import BVHTree
    dg = bpy.context.evaluated_depsgraph_get()
    best = 0.0
    for ob in bpy.context.scene.objects:
        if ob.type != 'MESH' or ob.name.startswith(('Clip', 'Print', 'Logo', 'Flag')):
            continue
        bvh = BVHTree.FromObject(ob, dg)
        for k in range(24):
            a = 2 * math.pi * k / 24
            o = Vector((30 * math.cos(a), 30 * math.sin(a), z))
            hit = bvh.ray_cast(o, -Vector((math.cos(a), math.sin(a), 0)))[0]
            if hit is not None:
                best = max(best, math.hypot(hit.x, hit.y))
    return best


def measure(name):
    """組み上がったモデルの寸法（mm）：全長（ボールの先から天まで）・最大径（クリップと印字を除く）・握る所の径・八角の辺から辺"""
    zs, rmax, flats = [], 0.0, []
    for ob in bpy.context.scene.objects:
        if ob.type != 'MESH':
            continue
        M = ob.matrix_world
        body = not ob.name.startswith(('Clip', 'Print', 'Logo', 'Flag'))
        for v in ob.data.vertices:
            p = M @ v.co
            zs.append(p.z)
            if body:
                r = math.hypot(p.x, p.y)
                rmax = max(rmax, r)
                if ob.name == 'Barrel' and abs(p.z - 70.0) < 2.0:
                    flats.append(r)
    return {'length': max(zs) - min(zs), 'diameter': 2 * rmax, 'grip': 2 * radius_at(GRIP_Z.get(name, 25.0)),
            'flats': 2 * min(flats) if flats else None}


def check(name, tol=0.1):
    """公表値と比べる。外れていれば止める（0.1 mm まで）"""
    got = measure(name)
    bad = []
    for key, (lo, hi) in PUBLISHED.get(name, {}).items():
        v = got[key]
        ok = v is not None and lo - tol <= v <= hi + tol
        print(f'  {name} {key}: {v:.2f} mm（公表 {lo}' + (f'〜{hi}' if hi != lo else '') + f'）{"" if ok else " ← 外れ"}')
        if not ok:
            bad.append(key)
    if bad:
        raise SystemExit(f'{name}: 公表値から外れている：{", ".join(bad)}')
