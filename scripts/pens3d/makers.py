# 既製品のペンの 3D モデル（GLB）。build.py の部品（lathe・sweep・wrapped_text など）で、実物の寸法（mm）に合わせて組む。
# build.py の FAMILIES に足して使う（python3 scripts/pens3d/build.py --only jetstream など）。
# 向きと決まりは build.py と同じ：ペン先が原点、軸は +Z、クリップは −Y（正面 +X に印字）。
#
# 寸法は各社・販売店の仕様（2026 年 11 月に確かめた）から。載っていない細部（口金の形・クリップの長さなど）は写真の比率から決めた：
#   ジェットストリーム（SXN-150-05）：全長 139.6・軸径 11.3（クリップを含む厚さ 14.8）
#   サラサクリップ 0.5（JJ15）：最大径 11.0・全長 およそ 141（長さの公表値は見つからず、写真の比率から）
#   カランダッシュ 849：全長 128（収納時）・軸径 9（六角）
#   パーカー ジョッター：全長 およそ 129・軸径 およそ 9.7
#   LAMY 2000 ボールペン：全長 140（クリップまで）・最大径 11.9・握るところ 10.0
#   カヴェコ スペシャル ボールペン：全長 144・径 10（八角・アルミ）
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


def face_text(name, text, font, size, z_start, apothem, face, mat, lift=0.04):
    """多角形の軸の平らな面（中心からの距離 apothem・向き face）に置く印字。
    円柱に巻くと面の端で字が面の中へ沈むので、巻いたあと面の平面へ移す（弧の長さはそのまま）"""
    ob = wrapped_text(name, text, font, size, z_start, apothem, face, mat, lift=0.0)
    c, s = math.cos(face), math.sin(face)
    for v in ob.data.vertices:
        x, y = v.co.x, v.co.y
        n, t = x * c + y * s, -x * s + y * c
        arc = apothem * math.atan2(t, n)
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
    lathe('TopCap', fillet([(0, 114.6), (5.5, 114.6), (5.75, 115.4), (5.75, 128.6), (5.3, 130.2), (0, 130.2)], 0.6),
          M['body'])
    # ノック：なめらかな筒で、天はわずかに丸い
    lathe('Knock', fillet([(0, 129.8), (3.5, 129.8), (3.55, 130.4), (3.5, 137.6), (3.2, 138.9), (2.2, 139.5), (0, 139.6)],
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
def caran_849():
    """六角形のアルミ軸（辺から辺まで 9。品の色 Body の塗装）。先は六角のまま細って小さな金属の先へ。
    天は軸と同じ色の六角のノック（白い四角のロゴ）。クリップは付け根が山形に広い板ばね。全長 128（収納時）"""
    M = metals()
    M['body'] = material('Body', srgb('#c8102e'), roughness=0.2, coat=0.8, coat_rough=0.04)
    M['print'] = material('PrintW', (0.96, 0.96, 0.96), roughness=0.4)
    M['steel'] = material('Steel', (0.88, 0.88, 0.88), metallic=1.0, roughness=0.24)
    tip(M, z_end=2.2, r_end=0.85, ball=0.3)
    lathe('TipCollar', fillet([(0, 2.0), (0.85, 2.0), (1.05, 2.6), (1.15, 3.6), (0, 3.6)], 0.15), M['chrome'], seg=96)
    ap = 4.5
    phase = math.radians(-90)  # 辺の 1 つがクリップ（−Y）を向く
    rf = poly_radius(6, ap, 0.55, phase)
    # 軸：先の 28 mm は六角のまま細る（細長い円すいの六角）。天の端は少し面取り
    zf = [3.4, 4.2, 5.5, 7.5, 10.0, 13.0, 16.5, 20.0, 24.0, 28.0, 31.5]
    kf = [0.25, 0.29, 0.34, 0.42, 0.52, 0.63, 0.75, 0.86, 0.94, 0.99, 1.0]
    zs = zf + [31.5 + (115.0 - 31.5) * i / 40 for i in range(1, 41)] + [115.5, 115.9, 116.2]

    def k(z):
        if z <= 31.5:
            return float(np.interp(z, zf, kf))
        if z > 115.0:
            return 1.0 - 0.05 * (z - 115.0) / 1.2
        return 1.0

    lathe_fn('Barrel', zs, lambda z, a: rf(a) * k(z), M['body'], seg=192)
    # ノック：軸と同じ色の、ひと回り細い六角（角が丸い）。天は面取り
    rk = poly_radius(6, 3.75, 0.6, phase)
    zk = [116.0, 116.4, 126.8, 127.5, 127.9, 128.0]
    kk = [0.93, 1.0, 1.0, 0.94, 0.8, 0.62]
    lathe_fn('Knock', zk, lambda z, a: rk(a) * float(np.interp(z, zk, kk)), M['body'], seg=192)
    # クリップ：軸の平らな面（−Y）の上に乗る板ばね。付け根は幅の広い四角の頭（幅 5.2）で、肩で細り、細い棒（幅 2.2）が下りる
    outline = [(117.2, -2.6), (117.2, 2.6), (112.0, 2.6), (108.6, 1.1)]
    outline += [(81.8 + 1.1 * math.sin(math.radians(a)), 1.1 * math.cos(math.radians(a))) for a in range(0, -181, -15)]
    outline += [(108.6, -1.1), (112.0, -2.6)]

    def inner(z):
        return float(np.interp(z, [80.6, 82.0, 108.0, 116.0, 117.2], [ap + 0.02, ap + 0.06, ap + 0.32, ap + 0.06, ap]))

    bent_plate('Clip', outline, 0.75, M['steel'], inner)
    # 付け根は天の端で内へ折れ、ノックの下に入る
    sweep('ClipBend', [(0, -3.0, 116.85), (0, -(ap + 0.4), 116.85)], 5.2, 0.7, M['steel'], lambda p: (0, 0, 1),
          round_r=0.25)
    # 印字（クリップの隣の面＝正面寄りの面）：社名と SWISS MADE。ノックの同じ向きの面に白い四角のロゴ
    face = math.radians(-30)
    face_text('Print_brand', "CARAN d'ACHE", FONT_SERIF_B, 2.2, 62.0, ap, face, M['print'], lift=0.05)
    face_text('Print_swiss', 'SWISS MADE', FONT_SANS, 1.2, 88.0, ap, face, M['print'], lift=0.05)
    c, s = math.cos(face), math.sin(face)
    flat_plate('Logo', rounded_rect(119.6, 123.0, -1.7, 1.7, 0.3), 0.06, M['print'], (c * 3.8, s * 3.8, 0), face)


# ---- パーカー ジョッター ステンレススチール CT ----
def parker_jotter():
    """ヘアラインのステンレスの軸（先へ細る）と上の部品、つやのある銀の継ぎ目の輪・天冠・ノック。
    矢のクリップ（付け根に矢羽根、先に矢じり）。全長 およそ 129"""
    M = metals()
    rough, nrm = hairline_maps('Jotter', 0.3, amp=0.05)
    M['ss'] = material('StainlessBrushed', (0.78, 0.78, 0.79), metallic=1.0, roughness=0.3, rough_map=rough,
                       normal_map=nrm, normal_strength=0.6)
    M['print'] = material('Engrave', (0.32, 0.32, 0.34), metallic=0.6, roughness=0.6)
    tip(M, z_end=2.2, r_end=0.9)
    # 先の小さな銀の口
    lathe('Nose', fillet([(0, 2.0), (0.9, 2.0), (1.1, 2.4), (1.25, 3.6), (1.3, 4.0), (0, 4.0)], 0.12), M['chrome'],
          seg=96)
    # 下の軸（ステンレス）：先の 20 mm で口へ細る
    lathe('Barrel', fillet([(0, 3.8), (1.2, 3.8), (1.35, 4.1), (2.4, 8.0), (3.6, 13.0), (4.45, 18.0), (4.78, 22.0),
                            (4.85, 25.0), (4.85, 84.6), (4.7, 85.0), (0, 85.0)], 0.4), M['ss'])
    # 継ぎ目の輪（つやのある銀）
    lathe('Ring', fillet([(0, 84.8), (4.75, 84.8), (4.95, 85.0), (4.95, 86.4), (4.75, 86.6), (0, 86.6)], 0.12),
          M['chrome'])
    # 上の部品（ステンレス）
    lathe('Upper', fillet([(0, 86.4), (4.75, 86.4), (4.85, 86.8), (4.85, 119.0), (0, 119.0)], 0.3), M['ss'])
    # 天冠（つやのある銀）：クリップの付け根を押さえ、肩で細くなる
    lathe('TopCap', fillet([(0, 118.6), (4.9, 118.6), (4.98, 119.0), (4.98, 120.0), (4.6, 121.3), (3.75, 122.2),
                            (0, 122.2)], 0.35), M['chrome'])
    # ノック：なめらかな銀の筒（根元に細い溝）。天は平らで縁が丸い
    lathe('Knock', fillet([(0, 121.8), (3.25, 121.8), (3.3, 122.4), (3.3, 123.0), (3.12, 123.2), (3.12, 123.4), (3.3, 123.6),
                           (3.3, 128.0), (3.0, 128.9), (2.0, 129.2), (0, 129.25)], 0.2), M['chrome'], seg=96)
    # 矢のクリップ（1 枚の板）：付け根は幅の広い矢羽根、細い軸、ペン先の向きの矢じり。付け根は天冠の下に入る
    outline = [(87.4, 0.0), (91.6, 1.9), (92.7, 1.55), (92.2, 0.95), (106.6, 0.95), (108.4, 1.85), (120.4, 1.85),
               (120.4, -1.85), (108.4, -1.85), (106.6, -0.95), (92.2, -0.95), (92.7, -1.55), (91.6, -1.9)]

    def inner(z):
        return float(np.interp(z, [87.0, 89.0, 104.0, 116.0, 118.4, 120.4], [4.86, 4.95, 5.25, 5.3, 4.88, 4.86]))

    bent_plate('Clip', outline, 0.85, M['chrome'], inner)
    # 矢羽根の筋（山形の溝が 5 本）と軸の中の稜線
    for i in range(6):  # 矢羽根：中心の筋から斜め上へ開く山形の溝
        u0 = 108.8 + 1.6 * i
        for side in (1, -1):  # 山形の左右の腕（凸の四角 2 枚。凹んだ 1 枚の形は三角に割るとき埋まる）
            arm = [(u0, 0.0), (u0 + 1.45, 1.6 * side), (u0 + 1.8, 1.6 * side), (u0 + 0.35, 0.0)]
            bent_plate(f'ClipFeather{i}{"LR"[side < 0]}', arm if side > 0 else arm[::-1], 0.05, M['print'],
                       lambda z: inner(z) + 0.86)
    bent_plate('ClipShaftLine', [(89.4, 0.16), (119.0, 0.16), (119.0, -0.16), (89.4, -0.16)], 0.05, M['print'],
               lambda z: inner(z) + 0.86)
    # 矢じりの中の山形の筋
    for side in (1, -1):
        arm = [(88.6, 0.0), (89.1, 0.0), (91.3, 0.95 * side), (91.3, 1.3 * side)]
        bent_plate(f'ClipHeadLine{"LR"[side < 0]}', arm if side < 0 else arm[::-1], 0.05, M['print'],
                   lambda z: inner(z) + 0.86)
    # 刻印：上の部品の下の端の近く、クリップの右横から円周に沿って PARKER
    circ_text('Print_brand', 'PARKER', FONT_SANS, 1.45, 89.4, 4.85, math.radians(-76), M['print'], lift=0.02)


# ---- LAMY 2000 ボールペン ----
def lamy_2000():
    """マクロロン（ガラス繊維入りの樹脂）のヘアラインの黒い軸。真ん中がふくらむ葉巻の形（最大 11.9・握る所 10.0）。
    先はヘアラインのステンレスの円すい、天はステンレスの細い筒のノック。クリップはステンレスのむくの幅広の板で先が四角。
    全長 140（クリップまで）"""
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
    lathe('Dome', fillet([(0, 140.9), (2.8, 140.9), (2.85, 141.6), (2.5, 143.2), (1.5, 143.85), (0, 144.0)], 0.35),
          M['alu'], seg=96)
    # 印字（正面の面）：筆記体のロゴと Germany
    face_text('Print_brand', 'KawecoSpecial', FONT_SCRIPT, 3.0, 96.0, ap, 0.0, M['print'], lift=0.05)
    face_text('Print_made', 'Germany', FONT_SANS, 1.3, 120.0, ap, 0.0, M['print'], lift=0.05)


MAKER_FAMILIES = {
    'jetstream': jetstream,
    'sarasa-clip': sarasa_clip,
    'caran-849': caran_849,
    'parker-jotter': parker_jotter,
    'lamy-2000': lamy_2000,
    'kaweco-special': kaweco_special,
}
