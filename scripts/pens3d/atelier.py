# 有料の棚のペン「アトリエ」の 3D モデル（GLB）。すべてパレットノートのオリジナルの形（実在の製品の形・名前・ロゴは使わない）。
# build.py の部品（lathe・sweep・wrapped_text など）で、mm の寸法で組む。build.py の FAMILIES に足して使う
# （python3 scripts/pens3d/build.py --only atelier-line など）。
# 向きと決まりは build.py と同じ：ペン先が原点、軸は +Z、クリップは −Y（正面 +X に印字）。
#
# シリーズの印：クリップの付け根の近くに、インクの色の小さなエナメルの粒（Ink）。どの品にも同じ位置に入れる。
# 材質の名前：品の色で塗るもの（Body・Accent・Print・Ink。renderer/model3d-three.js の tint）と、
# 塗らないもの（Chrome・StainlessBrushed・Brass・…）を分ける。透明の部品は ClearBarrel など（アプリが半透明で描く）
import math

import bmesh
import bpy
import numpy as np
from mathutils import Vector

from build import (fillet, lathe, lathe_fn, material, normal_map, obj_from_bm, pnoise, ridged, save_image, srgb,
                   sweep, wood_maps, wrapped_text)

FONT_SANS = '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf'
FONT_SANS_B = '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf'
FONT_SERIF_B = '/usr/share/fonts/truetype/liberation/LiberationSerif-Bold.ttf'
FONT_SCRIPT = '/usr/share/fonts/truetype/freefont/FreeSerifBoldItalic.ttf'
CLIP = -math.pi / 2  # クリップの向き（−Y）


# ---- 共通の部品 ----
def hairline_maps(name, rough_base, amp=0.02, seed=7, px=512):
    """長さの向きのヘアライン（ブラッシュ仕上げの金属）。lathe の UV（u が円周・v が長さ）で筋が長さに沿う"""
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
    """円周に沿って横に並ぶ字（軸を立てて見ると横書き）。a_start は字の始まりの角度"""
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



# ---- アトリエの共通の部品 ----
def spline(zs, rs, n=64):
    """点（z, 半径）をなめらかに結ぶ（行き過ぎない 3 次の補間）。戻りは lathe の (半径, 高さ) の並び"""
    zs, rs = np.array(zs, float), np.array(rs, float)
    d = np.diff(rs) / np.diff(zs)
    m = np.zeros_like(rs)
    m[0], m[-1] = d[0], d[-1]
    for i in range(1, len(rs) - 1):
        m[i] = 0.0 if d[i - 1] * d[i] <= 0 else 2 * d[i - 1] * d[i] / (d[i - 1] + d[i])
    out = []
    for z in np.linspace(zs[0], zs[-1], n):
        i = min(int(np.searchsorted(zs, z, 'right')) - 1, len(zs) - 2)
        h = zs[i + 1] - zs[i]
        t = (z - zs[i]) / h
        r = ((2 * t ** 3 - 3 * t ** 2 + 1) * rs[i] + (t ** 3 - 2 * t ** 2 + t) * h * m[i]
             + (-2 * t ** 3 + 3 * t ** 2) * rs[i + 1] + (t ** 3 - t ** 2) * h * m[i + 1])
        out.append((float(r), float(z)))
    return out


def weighted(ob):
    """平らな面の陰影をまっすぐにする（丸めた角だけがなめらかに回る）"""
    for p in ob.data.polygons:
        p.use_smooth = True
    md = ob.modifiers.new('wn', 'WEIGHTED_NORMAL')
    md.keep_sharp = True
    md.weight = 100
    return ob


def ribbon(name, line, width, thick, mat, corner=0.3, step=0.3):
    """ばね鋼の板のクリップ。line は中心線（(軸からの距離, 高さ) の並び。付け根 → 先。−Y の面の中）。
    width は幅（数か、付け根からの長さ → 幅の関数）。断面は角を丸めた長方形で、先は半円に丸める"""
    pts = [Vector(p) for p in line]
    acc = [0.0]
    for i in range(1, len(pts)):
        acc.append(acc[-1] + (pts[i] - pts[i - 1]).length)
    L = acc[-1]
    wf = width if callable(width) else (lambda s: width)
    w_end = wf(L)
    ss = [L * i / max(1, int(L / step)) for i in range(int(L / step) + 1)]
    ss = [s for s in ss if s < L - w_end / 2] + [L - w_end / 2 * math.cos(math.pi / 2 * k / 14) for k in range(15)]

    def at(s):
        s = min(max(s, 0.0), L)
        i = min(max(int(np.searchsorted(acc, s, 'right')) - 1, 0), len(pts) - 2)
        t = (s - acc[i]) / max(1e-9, acc[i + 1] - acc[i])
        return pts[i].lerp(pts[i + 1], t)

    bm = bmesh.new()
    rings = []
    ht = thick / 2
    for s in ss:
        p = at(s)
        tan = (at(s + 0.15) - at(s - 0.15)).normalized()
        nrm = Vector((-tan.y, tan.x))  # 外向き（付け根では上、まっすぐな所では軸から離れる向き）
        e = L - s
        hw = wf(s) / 2
        if e < w_end / 2:
            hw = math.sqrt(max(0.0, (w_end / 2) ** 2 - (w_end / 2 - e) ** 2))
        hw = max(hw, 0.04)
        c = min(corner, hw * 0.95, ht * 0.95)
        ring = []
        for cu, ch, a0 in ((hw - c, ht - c, 0), (-hw + c, ht - c, 90), (-hw + c, -ht + c, 180), (hw - c, -ht + c, 270)):
            for k in range(5):
                a = math.radians(a0 + 90 * k / 4)
                u, h = cu + c * math.cos(a), ch + c * math.sin(a)
                ring.append(bm.verts.new((u, -(p.x + h * nrm.x), p.y + h * nrm.y)))
        rings.append(ring)
    m = len(rings[0])
    for i in range(len(rings) - 1):
        for k in range(m):
            bm.faces.new((rings[i][k], rings[i][(k + 1) % m], rings[i + 1][(k + 1) % m], rings[i + 1][k]))
    bm.faces.new(rings[0])
    bm.faces.new(list(reversed(rings[-1])))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    return weighted(obj_from_bm(name, bm, mat))


def clip_line(z_top, z_tip, r_in, off, off_tip, rise=2.4, bend=2.0):
    """クリップの中心線：付け根は天の部品の中（半径 r_in）から水平に出て下へ折れ、まっすぐ下りて、先で軸へ触れてから少し反る。
    off はまっすぐな所の、off_tip は軸に触れる所の、中心線の軸からの距離"""
    ctrl = [(r_in, z_top + rise), (off, z_top + rise), (off, z_top - 8.0), (off_tip + 0.75, z_tip + 9.0),
            (off_tip, z_tip + 2.6), (off_tip + 0.5, z_tip)]
    return fillet(ctrl, bend, n=10)


def ink_dot(z, off, r, M):
    """シリーズの印：クリップの表の、インクの色のエナメルの粒（Ink）と、それを囲む細い金属の縁"""
    dome = lathe('InkDot', [(0, -0.2), (r, -0.2), (r, 0.0), (r * 0.9, 0.13), (r * 0.62, 0.25), (r * 0.3, 0.31),
                            (0, 0.33)], M['ink'], seg=48)
    rim = lathe('InkDotRim', fillet([(r - 0.02, -0.25), (r + 0.2, -0.25), (r + 0.2, 0.07), (r - 0.02, 0.07)], 0.06),
                M['rim'], seg=48)
    for ob in (dome, rim):
        ob.rotation_euler = (math.pi / 2, 0, 0)
        ob.location = (0, -off, z)


def mark(name, z, radius, angle, r, mat, h=0.1):
    """軸の面の小さな丸い印（多機能ペンの芯の色の印）。angle は印の向き（0 が正面 +X）"""
    ob = lathe(name, [(0, -0.15), (r, -0.15), (r, h * 0.4), (r * 0.8, h * 0.85), (0, h)], mat, seg=40)
    ob.rotation_euler = (0, math.pi / 2, angle)
    ob.location = (radius * math.cos(angle), radius * math.sin(angle), z)
    return ob


def spaced(text, gap=' '):
    """字の間を空けた刻印（細い字を広く組む）"""
    return gap.join(text)


def atelier_metals(ink='#1f1f22'):
    M = metals()
    M['print'] = material('Print', (0.9, 0.9, 0.9), roughness=0.45)
    M['engrave'] = material('Engrave', (0.11, 0.11, 0.12), metallic=0.4, roughness=0.7)
    M['ink'] = material('Ink', srgb(ink), roughness=0.08, coat=1.0)
    M['rim'] = M['chrome']
    return M


def grooves(r, zs, depth=0.18, half=0.42):
    """輪の溝（浅い V）を刻んだ区間の点。zs は溝の中心の高さ（下から）"""
    pts = []
    for z in zs:
        pts += [(r, z - half), (r - depth, z - half * 0.35), (r - depth, z + half * 0.35), (r, z + half)]
    return pts


# ---- アトリエ ライン：細身のアルミ軸のノック式 ----
def atelier_line():
    """アルマイトの細い軸（径 9.2・全長 138）。握る所に細い輪の溝が 5 本、口金と天の輪は鏡面、ノックは差し色"""
    M = atelier_metals()
    rough, nrm = grain_maps('Line', 0.36, amp=0.04)
    M['body'] = material('Body', srgb('#26282c'), metallic=0.92, roughness=0.36, rough_map=rough, normal_map=nrm,
                         normal_strength=0.12)
    M['accent'] = material('Accent', srgb('#26282c'), metallic=0.92, roughness=0.3)
    R = 4.6
    tip(M, z_end=3.4, r_end=1.2)
    lathe('Nose', fillet([(0, 3.2), (1.2, 3.2), (1.4, 3.5)], 0.1)[:-1] + spline([3.5, 8.0, 13.5, 18.4],
                                                                                [1.4, 2.5, 3.6, 4.35], 24)
          + fillet([(4.35, 18.4), (4.5, 19.4), (4.5, 20.3), (0, 20.3)], 0.25)[1:], M['chrome'])
    body = [(0, 20.1), (4.25, 20.1), (R, 20.55)] + grooves(R, [25.0 + 2.3 * i for i in range(5)])
    body += [(R + 0.02, 60.0), (R, 100.0), (R - 0.04, 116.3), (R - 0.3, 116.7), (0, 116.7)]
    ob = lathe('Barrel', fillet(body, 0.1), M['body'])
    lathe('Collar', fillet([(0, 116.5), (4.3, 116.5), (R + 0.04, 116.9), (R + 0.04, 121.3), (4.2, 121.8), (0, 121.8)],
                           0.22), M['chrome'])
    lathe('Knock', fillet([(0, 121.5), (3.15, 121.5), (3.15, 136.2), (2.7, 137.6), (1.6, 138.0), (0, 138.05)], 0.5),
          M['accent'])
    lathe('KnockRing', fillet([(3.1, 133.0), (3.24, 133.1), (3.24, 133.7), (3.1, 133.8)], 0.04), M['chrome'], seg=64)
    th = 0.85
    ribbon('Clip', clip_line(118.4, 82.0, 3.6, R + 1.45, R + th / 2 + 0.04), lambda s: 3.7 - 0.9 * min(1, s / 38), th,
           M['chrome'])
    ink_dot(113.2, R + 1.45 + th / 2, 1.1, M)
    wrapped_text('Print_brand', spaced('PALETTE NOTE'), FONT_SANS, 1.25, 84.0, R, 0.0, M['print'], lift=0.03)


# ---- アトリエ クリア：中の見える透明の軸 ----
def atelier_clear():
    """スモークの透明の軸（径 10.8・全長 141）。金属の口金、中に替え芯のインクとばね。天の部品とノックは差し色"""
    M = atelier_metals()
    M['clear'] = material('ClearBarrel', (0.62, 0.68, 0.74), roughness=0.04, transmission=1.0, ior=1.5)
    M['refill'] = material('ClearRefill', (0.95, 0.95, 0.95), roughness=0.15, transmission=1.0, ior=1.45)
    M['accent'] = material('Accent', srgb('#1b1b1b'), roughness=0.22, coat=0.8)
    M['spring'] = material('Spring', (0.8, 0.8, 0.82), metallic=1.0, roughness=0.25)
    M['white'] = material('PrintW', (0.96, 0.96, 0.96), roughness=0.4)
    tip(M, z_end=4.0, r_end=1.25)
    lathe('Nose', fillet([(0, 3.8), (1.25, 3.8), (1.5, 4.2)], 0.1)[:-1]
          + spline([4.2, 8.0, 12.0, 15.6], [1.5, 2.9, 4.1, 4.85], 24)
          + fillet([(4.85, 15.6), (5.05, 16.6), (5.05, 17.6), (0, 17.6)], 0.25)[1:], M['chrome'])
    R = 5.3
    barrel = [(0, 17.3), (4.8, 17.3), (R, 17.9), (R + 0.1, 70.0), (R + 0.1, 108.4), (R - 0.2, 108.9), (0, 108.9)]
    lathe('Barrel', fillet(barrel, 0.12), M['clear'])
    lathe('Refill', fillet([(0, 4.6), (0.9, 4.6), (1.2, 9.0), (1.2, 16.0), (1.9, 18.0), (1.9, 108.0), (0, 108.0)], 0.2),
          M['refill'], seg=48)
    lathe('Ink', [(0, 26.0), (1.74, 26.0), (1.74, 96.0), (0, 96.0)], M['ink'], seg=48)
    lathe('RefillPlug', [(0, 96.0), (1.74, 96.0), (1.74, 99.0), (0, 99.0)],
          material('Follower', (0.92, 0.9, 0.82), roughness=0.5), seg=48)
    coil = []
    for i in range(260):  # ばね（握る所の中。軸ごしに見える）
        t = i / 259
        a = t * 2 * math.pi * 9
        coil.append((2.5 * math.cos(a), 2.5 * math.sin(a), 18.4 + t * 9.0))
    sweep('Spring', coil, 0.4, 0.4, M['spring'], lambda p: (p.x, p.y, 0), round_r=0.18, n_round=2)
    lathe('Band', fillet([(0, 108.6), (5.0, 108.6), (R + 0.16, 109.0), (R + 0.16, 111.4), (5.0, 111.8), (0, 111.8)], 0.2),
          M['chrome'])
    lathe('TopCap', fillet([(0, 111.5), (5.0, 111.5), (R + 0.1, 112.0), (R, 127.6), (4.5, 128.5), (0, 128.5)], 0.5),
          M['accent'])
    lathe('Knock', fillet([(0, 128.2), (3.5, 128.2), (3.5, 139.4), (3.0, 140.7), (0, 141.0)], 0.6), M['accent'])
    th = 0.9
    ribbon('Clip', clip_line(124.2, 84.0, 4.2, R + 1.6, R + 0.1 + th / 2 + 0.04), lambda s: 4.4 - 1.0 * min(1, s / 42), th,
           M['chrome'])
    ink_dot(118.6, R + 1.6 + th / 2, 1.1, M)
    wrapped_text('Print_brand', spaced('PALETTE NOTE'), FONT_SANS, 1.2, 113.6, R + 0.06, 0.0, M['white'], lift=0.04)


# ---- アトリエ ファセット：12 角の金属軸 ----
def atelier_facet():
    """12 角の金属の軸（辺から辺まで 9.6・全長 134）。握る所は綾目のローレット。軸・口金・ノックは品の色（Body）の金属"""
    M = atelier_metals()
    rough, nrm = hairline_maps('Facet', 0.3, amp=0.05, seed=11)
    M['body'] = material('Body', srgb('#c4a25a'), metallic=1.0, roughness=0.3, rough_map=rough, normal_map=nrm,
                         normal_strength=0.5)
    M['solid'] = material('Body', srgb('#c4a25a'), metallic=1.0, roughness=0.28)
    M['accent'] = material('Accent', (0.80, 0.80, 0.81), metallic=1.0, roughness=0.16)
    ap = 4.8
    phase = 0.0
    tip(M, z_end=3.6, r_end=1.15)
    lathe('Nose', fillet([(0, 3.4), (1.15, 3.4), (1.35, 3.7), (3.95, 15.2), (4.15, 15.8), (4.15, 16.4), (4.6, 16.8),
                          (4.6, 17.6), (0, 17.6)], 0.14), M['body'])

    def kb(z):
        return float(np.interp(z, [17.4, 17.9, 39.6, 40.1], [4.35, 4.78, 4.78, 4.35]))

    zk = [17.4 + i * 0.1135 for i in range(201)]
    lathe_fn('Grip', zk, knurl(kb, 0.2, 40, 1.0), M['solid'], seg=320)
    lathe('Neck', fillet([(0, 39.9), (4.25, 39.9), (4.25, 41.0), (0, 41.0)], 0.1), M['solid'], seg=64)
    zb = [40.8, 41.1, 41.6] + [41.6 + (117.4 - 41.6) * i / 30 for i in range(1, 30)] + [117.4, 117.9, 118.2]

    def ends(z):
        if z < 41.6:
            return 0.93 + 0.07 * (z - 40.8) / 0.8
        if z > 117.4:
            return 1.0 - 0.07 * (z - 117.4) / 0.8
        return 1.0

    polygon_barrel('Barrel', 12, ap, 0.22, 40.8, 118.2, M['solid'], phase, ends=ends, zs=zb, seg=240)
    lathe('Collar', fillet([(0, 118.0), (4.3, 118.0), (4.62, 118.4), (4.62, 122.6), (4.2, 123.0), (0, 123.0)], 0.2),
          M['body'])
    lathe('KnockNeck', fillet([(0, 122.8), (2.6, 122.8), (2.6, 124.4), (0, 124.4)], 0.1), M['solid'], seg=64)

    def nb(z):
        return float(np.interp(z, [124.2, 124.6, 130.6, 131.0], [2.7, 3.1, 3.1, 2.7]))

    lathe_fn('Knock', [124.2 + i * 0.1 for i in range(69)], knurl(nb, 0.16, 28, 0.9), M['solid'], seg=224)
    lathe('KnockTop', fillet([(0, 130.8), (2.75, 130.8), (2.95, 131.3), (2.95, 132.6), (2.4, 133.6), (1.2, 134.0),
                              (0, 134.05)], 0.4), M['solid'], seg=64)
    th = 0.9
    ribbon('Clip', clip_line(119.6, 86.0, 3.6, ap + 1.75, ap + th / 2 + 0.25), lambda s: 3.4 - 0.8 * min(1, s / 36), th,
           M['accent'])
    ink_dot(114.6, ap + 1.75 + th / 2, 1.05, M)
    face_text('Print_brand', spaced('PALETTE NOTE'), FONT_SANS, 1.15, 88.0, ap, 0.0, M['print'], lift=0.03)


# ---- アトリエ フルート：縦の溝の軸 ----
def atelier_flute():
    """漆のようなつやの軸（径 10.4・全長 136）。下の軸は 14 本の縦の溝（柱の溝彫り）。真ん中に鏡面の帯、上の軸を回して芯を出す"""
    M = atelier_metals()
    M['body'] = material('Body', srgb('#1e2a44'), roughness=0.14, coat=1.0, coat_rough=0.03)
    R, N, D = 5.2, 14, 0.42
    tip(M, z_end=3.4, r_end=1.2)
    lathe('Nose', fillet([(0, 3.2), (1.2, 3.2), (1.4, 3.5)], 0.1)[:-1]
          + spline([3.5, 7.5, 12.0, 16.4], [1.4, 2.9, 4.1, 4.8], 24)
          + fillet([(4.8, 16.4), (4.95, 17.3), (4.95, 18.2), (0, 18.2)], 0.25)[1:], M['chrome'])

    def fade(z):  # 溝は両端でなだらかに消える
        t = min((z - 19.2) / 5.0, (83.2 - z) / 5.0, 1.0)
        t = max(t, 0.0)
        return t * t * (3 - 2 * t)

    def rf(z, a):
        c = abs(math.cos(N * a / 2))
        edge = min((z - 18.0) / 0.5, (84.0 - z) / 0.5, 1.0)  # 端の面取り
        return (R - D * (2 * c - c * c) * fade(z)) * (0.94 + 0.06 * max(0.0, edge))

    zs = sorted(set([18.0, 18.25, 18.5, 83.5, 83.75, 84.0] + [19.0 + 0.5 * i for i in range(12)]
                    + [25.0 + 2.0 * i for i in range(27)] + [78.0 + 0.5 * i for i in range(12)]))
    lathe_fn('Barrel', zs, rf, M['body'], seg=N * 24)
    lathe('Waist', fillet([(0, 83.8), (4.9, 83.8), (R + 0.12, 84.2), (R + 0.12, 85.0), (R - 0.02, 85.25),
                           (R - 0.02, 85.55), (R + 0.12, 85.8), (R + 0.12, 87.4), (4.9, 87.8), (0, 87.8)], 0.08),
          M['chrome'])
    lathe('Upper', fillet([(0, 87.6), (4.9, 87.6), (R, 88.0)], 0.1)[:-1]
          + spline([88.0, 105.0, 118.0, 126.4], [R, R - 0.03, R - 0.2, R - 0.5], 24)
          + [(4.4, 126.8), (0, 126.8)], M['body'])
    lathe('Crown', fillet([(0, 126.6), (4.45, 126.6), (4.78, 126.9), (4.78, 129.6), (4.5, 129.9), (4.5, 130.3),
                           (4.3, 131.6), (3.4, 134.4), (2.0, 135.7), (0, 136.0)], 0.3), M['chrome'])
    th = 0.9
    ribbon('Clip', clip_line(126.4, 92.0, 3.8, R + 1.4, R - 0.03 + th / 2 + 0.04), lambda s: 3.6 - 0.8 * min(1, s / 36),
           th, M['chrome'])
    ink_dot(121.0, R + 1.4 + th / 2, 1.1, M)
    wrapped_text('Print_brand', spaced('PALETTE NOTE'), FONT_SANS, 1.25, 94.0, R - 0.02, 0.0, M['print'], lift=0.03)


# ---- アトリエ ドロップ：葉巻の形の軸 ----
def atelier_drop():
    """真ん中が太い葉巻の形（最大径 12.4・全長 140）。つやのある軸に、金具は差し色（Accent。金）。真ん中に 2 本の輪と細い軸の色の帯"""
    M = atelier_metals()
    M['body'] = material('Body', srgb('#5a1220'), roughness=0.08, coat=1.0, coat_rough=0.02)
    M['accent'] = material('Accent', srgb('#d9b45a'), metallic=1.0, roughness=0.14)
    M['rim'] = M['accent']
    tip(M, z_end=3.4, r_end=1.15)
    lathe('Nose', fillet([(0, 3.2), (1.15, 3.2), (1.35, 3.5)], 0.1)[:-1]
          + spline([3.5, 7.0, 11.0, 14.6], [1.35, 2.3, 3.15, 3.7], 20)
          + fillet([(3.7, 14.6), (3.9, 15.3), (3.9, 16.1), (0, 16.1)], 0.2)[1:], M['accent'])
    lathe('Lower', [(0, 15.9), (3.55, 15.9)] + spline([16.2, 24.0, 36.0, 50.0, 62.0, 70.0],
                                                      [3.8, 4.5, 5.3, 5.85, 6.12, 6.18], 48)
          + [(5.9, 70.4), (0, 70.4)], M['body'])
    lathe('RingA', fillet([(0, 70.2), (5.9, 70.2), (6.3, 70.5), (6.3, 71.5), (6.1, 71.75), (0, 71.75)], 0.12),
          M['accent'])
    lathe('Band', [(0, 71.6), (6.14, 71.6), (6.16, 72.3), (6.14, 73.0), (0, 73.0)], M['body'])
    lathe('RingB', fillet([(0, 72.85), (6.1, 72.85), (6.3, 73.1), (6.3, 77.2), (5.95, 77.5), (0, 77.5)], 0.12),
          M['accent'])
    lathe('Upper', [(0, 77.3), (5.9, 77.3)] + spline([77.6, 90.0, 104.0, 116.0, 126.0, 131.0],
                                                     [6.16, 6.0, 5.6, 5.05, 4.45, 4.1], 48)
          + [(3.85, 131.3), (0, 131.3)], M['body'])
    lathe('TopRing', fillet([(0, 131.1), (3.9, 131.1), (4.28, 131.4), (4.28, 133.6), (3.9, 133.9), (0, 133.9)], 0.12),
          M['accent'])
    lathe('Finial', [(0, 133.7), (3.8, 133.7)] + spline([134.0, 136.5, 138.4, 139.6], [3.95, 3.5, 2.5, 1.2], 20)
          + [(0.6, 139.9), (0, 140.0)], M['body'])
    th = 0.95

    def upper_r(z):
        return float(np.interp(z, [90.0, 104.0, 116.0, 126.0, 131.0], [6.0, 5.6, 5.05, 4.45, 4.1]))

    ribbon('Clip', clip_line(130.2, 94.0, 3.4, 6.95, upper_r(96.6) + th / 2 + 0.05, rise=2.3),
           lambda s: 3.9 - 0.9 * min(1, s / 36), th, M['accent'])
    ink_dot(124.6, 6.95 + th / 2, 1.15, M)
    circ_text('Print_brand', spaced('PALETTE NOTE'), FONT_SANS, 1.25, 75.15, 6.3, math.radians(40), M['engrave'],
              lift=0.02)


def walnut(img):
    """木目の色の画像を、くるみ材の濃い茶に染める（木目の明暗はそのまま、濃い所をより濃く）"""
    w, h = img.size
    a = np.empty(w * h * 4, np.float32)
    img.pixels.foreach_get(a)
    a = a.reshape(h, w, 4)[..., :3]
    lum = a.mean(-1, keepdims=True)
    t = np.clip((lum - lum.min()) / (lum.max() - lum.min() + 1e-9), 0, 1) ** 1.5
    dark, light = np.array([0.16, 0.085, 0.05]), np.array([0.50, 0.31, 0.19])
    return save_image('WalnutColor', dark + (light - dark) * t, 'sRGB', 'JPEG')


# ---- アトリエ ウッド：木の軸 ----
def atelier_wood():
    """木の軸（径 11.0・全長 139）。口金から握る所までと天の部品はヘアラインのステンレス、木との境に真ちゅうの細い輪"""
    M = atelier_metals()
    col, wrough, wnrm = wood_maps()
    col = walnut(col)
    M['wood'] = material('Body', (1, 1, 1), roughness=0.5, texture=col, rough_map=wrough, normal_map=wnrm,
                         normal_strength=1.0)
    rough, nrm = hairline_maps('Wood', 0.3, amp=0.05, seed=5)
    M['ss'] = material('StainlessBrushed', (0.78, 0.78, 0.79), metallic=1.0, roughness=0.3, rough_map=rough,
                       normal_map=nrm, normal_strength=0.6)
    M['brass'] = material('Brass', srgb('#cfa85a'), metallic=1.0, roughness=0.2)
    tip(M, z_end=3.6, r_end=1.25)
    front = fillet([(0, 3.4), (1.25, 3.4), (1.45, 3.7)], 0.1)[:-1] + spline([3.7, 8.0, 13.0, 18.0], [1.45, 2.8, 4.0, 4.9],
                                                                           24)
    front += fillet([(4.9, 18.0), (5.0, 19.0)] + grooves(5.0, [21.5 + 2.4 * i for i in range(6)], depth=0.2)
                    + [(5.05, 36.0), (5.2, 37.4), (4.9, 37.8), (0, 37.8)], 0.1)[1:]
    lathe('Front', front, M['ss'])
    lathe('BrassA', fillet([(0, 37.6), (5.0, 37.6), (5.36, 37.8), (5.36, 38.5), (5.0, 38.7), (0, 38.7)], 0.08),
          M['brass'])
    lathe('Barrel', [(0, 38.5), (5.0, 38.5), (5.28, 38.8)] + spline([38.8, 60.0, 80.0, 100.0, 112.2],
                                                                   [5.28, 5.46, 5.5, 5.42, 5.28], 40)
          + [(5.0, 112.5), (0, 112.5)], M['wood'])
    lathe('BrassB', fillet([(0, 112.3), (5.0, 112.3), (5.36, 112.5), (5.36, 113.2), (5.0, 113.4), (0, 113.4)], 0.08),
          M['brass'])
    lathe('Top', fillet([(0, 113.2), (4.9, 113.2), (5.2, 113.6), (5.1, 126.4), (4.5, 127.0), (0, 127.0)], 0.3), M['ss'])
    lathe('Knock', fillet([(0, 126.7), (3.4, 126.7), (3.4, 137.4), (2.9, 138.7), (0, 139.0)], 0.55), M['ss'])
    th = 0.9
    ribbon('Clip', clip_line(123.0, 86.0, 4.0, 5.5 + 1.25, 5.47 + th / 2 + 0.04), lambda s: 3.8 - 0.8 * min(1, s / 36),
           th, M['chrome'])
    ink_dot(117.6, 5.5 + 1.25 + th / 2, 1.15, M)
    wrapped_text('Print_brand', spaced('PALETTE NOTE'), FONT_SANS, 1.15, 114.6, 5.17, 0.0, M['engrave'], lift=0.02)


# ---- アトリエ トリオ：2 色のボールペンとシャープの多機能ペン ----
def atelier_trio():
    """太めの軸（径 12.6・全長 147）。下の軸はつやを抑えた塗り（Body）、上の軸はヘアラインの金属（Accent）。
    境の刻みの輪を回して芯を選ぶ（上の軸に芯の色の印：黒・赤・シャープ）。天は消しゴムのふた"""
    M = atelier_metals()
    M['body'] = material('Body', srgb('#22304a'), roughness=0.3, coat=0.5, coat_rough=0.2)
    rough, nrm = hairline_maps('Trio', 0.28, amp=0.05, seed=9)
    M['accent'] = material('Accent', srgb('#c9b68f'), metallic=1.0, roughness=0.28, rough_map=rough, normal_map=nrm,
                           normal_strength=0.5)
    tip(M, z_end=3.0, r_end=1.05)
    lathe('Nose', fillet([(0, 2.6), (1.25, 2.6), (1.5, 3.0)], 0.1)[:-1]
          + spline([3.0, 8.0, 14.0, 20.0, 24.0], [1.5, 2.9, 4.25, 5.2, 5.6], 30)
          + fillet([(5.6, 24.0), (5.75, 25.0), (5.75, 26.0), (0, 26.0)], 0.25)[1:], M['chrome'])
    lathe('Lower', [(0, 25.8), (5.4, 25.8), (5.72, 26.2)] + spline([26.2, 45.0, 65.0, 79.6], [5.72, 6.05, 6.25, 6.3], 40)
          + [(6.0, 80.0), (0, 80.0)], M['body'])

    def coin(z, a):  # 縦の刻み（コインの縁）
        base = float(np.interp(z, [79.8, 80.3, 84.9, 85.4], [6.0, 6.46, 6.46, 6.0]))
        return base - 0.13 * 0.5 * (1 - math.cos(72 * a))

    lathe_fn('Selector', [79.8, 80.05, 80.3, 81.5, 82.6, 83.7, 84.9, 85.15, 85.4], coin, M['chrome'], seg=576)
    lathe('Upper', [(0, 85.2), (6.0, 85.2), (6.3, 85.6)] + spline([85.6, 100.0, 115.0, 128.2], [6.3, 6.26, 6.1, 5.8], 40)
          + [(5.5, 128.6), (0, 128.6)], M['accent'])
    lathe('Crown', fillet([(0, 128.4), (5.5, 128.4), (5.86, 128.7), (5.86, 132.4), (5.4, 132.9), (4.2, 133.6),
                           (0, 133.6)], 0.25), M['chrome'])
    cap = [(0, 133.3), (4.0, 133.3)] + grooves(4.0, [136.0, 137.6, 139.2], depth=0.16, half=0.4)
    cap += [(4.0, 144.9), (3.5, 146.4), (2.0, 146.95), (0, 147.0)]
    lathe('EraserCap', fillet(cap, 0.3), M['accent'])
    # 芯の色の印（上の軸の下の縁）：正面が黒、左右に赤とシャープ。下の軸には合わせる線
    def ur(z):
        return float(np.interp(z, [85.6, 100.0], [6.3, 6.26]))

    mark('MarkBlack', 88.6, ur(88.6), 0.0, 0.7, material('MarkBlack', srgb('#1a1a1c'), roughness=0.2, coat=1.0))
    mark('MarkRed', 88.6, ur(88.6), math.radians(120), 0.7, material('MarkRed', srgb('#d0202e'), roughness=0.2, coat=1.0))
    mark('MarkSharp', 88.6, ur(88.6), math.radians(240), 0.7, material('MarkSharp', srgb('#8a8d92'), metallic=1.0,
                                                                      roughness=0.3))
    mark('Print_index', 77.4, 6.29, 0.0, 0.42, M['print'], h=0.05)
    th = 1.0
    ribbon('Clip', clip_line(129.2, 94.0, 4.6, 6.3 + 1.5, ur(96.6) + th / 2 + 0.04), lambda s: 4.6 - 1.0 * min(1, s / 36),
           th, M['chrome'])
    ink_dot(123.2, 6.3 + 1.5 + th / 2, 1.15, M)
    wrapped_text('Print_brand', spaced('PALETTE NOTE'), FONT_SANS, 1.3, 96.0, ur, 0.0, M['engrave'], lift=0.02)


ATELIER_FAMILIES = {
    'atelier-line': atelier_line,
    'atelier-clear': atelier_clear,
    'atelier-facet': atelier_facet,
    'atelier-flute': atelier_flute,
    'atelier-drop': atelier_drop,
    'atelier-wood': atelier_wood,
    'atelier-trio': atelier_trio,
}
