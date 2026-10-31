# 文房具の 3D モデル（GLB）を作る。Blender（Python の bpy）で形と材質を組み、src/renderer/assets/stationery へ書き出す。
# 使い方：python3 -m pip install bpy==5.2.3 のあと  python3 scripts/pens3d/build.py [--out 出力先] [--preview 画像の出力先]
#
# 品ごとではなく「形の種類（family）」ごとに 1 つ作る（ボールペン・木軸のボールペン・マーカー・太いマーカー・文字隠しペン）。
# 色は、アプリが品の色（stationery.js の body・accent・color）で材質の名前ごとに塗り替える（renderer/model3d-three.js の tint）。
#   Body（軸）・Accent（天冠・ノック）・Grip（グリップ）・Print（印字）・Chrome（クリップ・口金）・TipMetal（ペン先）・Ball（ボール）
#   Cap（キャップ）・Felt（ペン先のフェルト）・Plug（尻栓）・Ink（インクの窓）
# 字幅の印字は 4 つ入れておき、品の字幅のものだけを出す（Print_mm_038・05・07・10）。
# 向き（renderer/model3d-three.js と同じ）：ペン先が原点、軸は glTF の +y、クリップは glTF の +z。
#   Blender は z が上なので、ここでは軸を +Z、クリップを −Y に置く（glTF に書き出すと y が上になる）。
# 寸法は実物の mm で作り、最後に 1/1000 にする（メートル）。角はすべて小さな丸み（面取り）を付ける（CG の鋭い角を出さない）。
import argparse
import math
import os
import sys

import bpy  # bmesh・mathutils は bpy を読んだあとで使える
import bmesh
from mathutils import Vector

FONT_JA = '/usr/share/fonts/opentype/ipafont-gothic/ipag.ttf'
SEG = 96  # 円周の分け方


# ---- 材質 ----
def material(name, color=(0.8, 0.8, 0.8), metallic=0.0, roughness=0.4, coat=0.0, coat_rough=0.05,
             transmission=0.0, ior=1.45, texture=None, rough_map=None, normal_map=None, normal_strength=1.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    p = m.node_tree.nodes['Principled BSDF']
    p.inputs['Base Color'].default_value = (*color, 1)
    p.inputs['Metallic'].default_value = metallic
    p.inputs['Roughness'].default_value = roughness
    p.inputs['Coat Weight'].default_value = coat
    p.inputs['Coat Roughness'].default_value = coat_rough
    p.inputs['Transmission Weight'].default_value = transmission
    p.inputs['IOR'].default_value = ior
    nt = m.node_tree
    if texture:
        t = nt.nodes.new('ShaderNodeTexImage')
        t.image = texture
        nt.links.new(t.outputs['Color'], p.inputs['Base Color'])
    if rough_map:
        t = nt.nodes.new('ShaderNodeTexImage')
        t.image = rough_map
        nt.links.new(t.outputs['Color'], p.inputs['Roughness'])
    if normal_map:
        t = nt.nodes.new('ShaderNodeTexImage')
        t.image = normal_map
        nm = nt.nodes.new('ShaderNodeNormalMap')
        nm.inputs['Strength'].default_value = normal_strength
        nt.links.new(t.outputs['Color'], nm.inputs['Color'])
        nt.links.new(nm.outputs['Normal'], p.inputs['Normal'])
    return m


def srgb(h):
    """'#rrggbb' → Blender の色（リニア）"""
    h = h.lstrip('#')
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


# ---- 形 ----
def fillet(points, r, n=5):
    """折れ線（(半径, 高さ) の並び）の角を半径 r の弧でなめらかにする（両端はそのまま）"""
    out = [points[0]]
    for i in range(1, len(points) - 1):
        p0, p1, p2 = Vector(points[i - 1]), Vector(points[i]), Vector(points[i + 1])
        a, b = (p0 - p1), (p2 - p1)
        la, lb = a.length, b.length
        if la < 1e-9 or lb < 1e-9:
            continue
        rr = min(r, la * 0.45, lb * 0.45)
        s, e = p1 + a.normalized() * rr, p1 + b.normalized() * rr
        for k in range(n + 1):
            t = k / n
            q = (1 - t) ** 2 * s + 2 * (1 - t) * t * p1 + t ** 2 * e  # 2 次ベジェで角を回る
            out.append((q.x, q.y))
    out.append(points[-1])
    return out


def lathe(name, profile, mat, seg=SEG, sx=1.0, sy=1.0, smooth=True):
    """(半径, 高さ) の並びを Z 軸のまわりに回した形。半径 0 の点は極（1 点）にする。sx・sy で楕円にする"""
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new()
    rings = []
    total = sum((Vector(profile[i]) - Vector(profile[i - 1])).length for i in range(1, len(profile))) or 1
    acc = 0
    vs = []
    for i, (r, z) in enumerate(profile):
        if i:
            acc += (Vector(profile[i]) - Vector(profile[i - 1])).length
        vs.append(acc / total)
        if r < 1e-6:
            rings.append([bm.verts.new((0, 0, z))])
        else:
            rings.append([bm.verts.new((r * sx * math.cos(2 * math.pi * k / seg),
                                        r * sy * math.sin(2 * math.pi * k / seg), z)) for k in range(seg)])
    for i in range(len(rings) - 1):
        a, b = rings[i], rings[i + 1]
        for k in range(seg):
            k2 = (k + 1) % seg
            if len(a) == 1 and len(b) == 1:
                continue
            if len(a) == 1:
                f = bm.faces.new((a[0], b[k], b[k2]))
            elif len(b) == 1:
                f = bm.faces.new((a[k], a[k2], b[0]))
            else:
                f = bm.faces.new((a[k], a[k2], b[k2], b[k]))
            for loop in f.loops:
                vi = loop.vert
                ring = i if vi in a else i + 1
                ang = math.atan2(vi.co.y / sy, vi.co.x / sx) % (2 * math.pi)
                u = ang / (2 * math.pi)
                if k2 == 0 and u < 0.5 and vi in (a[0] if len(a) > 1 else None, b[0] if len(b) > 1 else None):
                    u = 1.0
                loop[uv].uv = (u, vs[ring])
    bm.normal_update()
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(mat)
    if smooth:
        for p in obj.data.polygons:
            p.use_smooth = True
    return obj


def ridged(r0, z0, z1, depth, pitch, samples=8):
    """細かな溝（グリップの輪）を刻んだ区間の点（下から上へ）"""
    pts = []
    n = max(1, int((z1 - z0) / pitch))
    for i in range(n * samples + 1):
        z = z0 + (z1 - z0) * i / (n * samples)
        phase = (z - z0) / (z1 - z0) * n
        pts.append((r0 - depth * 0.5 * (1 - math.cos(2 * math.pi * phase)), z))
    return pts


def sweep(name, path, width, thick, mat, radius_dir, round_r=0.25, n_round=3):
    """角を丸めた長方形の断面を、点の並び（path）に沿って押し出す。radius_dir(p) は断面の厚みの向き（外向き）"""
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    # 断面（幅方向 x、厚み方向 y）：角を丸めた長方形
    hw, ht = width / 2, thick / 2
    rr = min(round_r, hw * 0.9, ht * 0.9)
    prof = []
    for cx, cy, a0 in ((hw - rr, ht - rr, 0), (-hw + rr, ht - rr, 90), (-hw + rr, -ht + rr, 180), (hw - rr, -ht + rr, 270)):
        for k in range(n_round + 1):
            a = math.radians(a0 + 90 * k / n_round)
            prof.append((cx + rr * math.cos(a), cy + rr * math.sin(a)))
    rings = []
    for i, p in enumerate(path):
        p = Vector(p)
        t = (Vector(path[min(i + 1, len(path) - 1)]) - Vector(path[max(i - 1, 0)])).normalized()
        nrm = Vector(radius_dir(p))
        nrm = (nrm - t * nrm.dot(t)).normalized()
        side = t.cross(nrm).normalized()
        rings.append([bm.verts.new(p + side * x + nrm * y) for x, y in prof])
    m = len(prof)
    for i in range(len(rings) - 1):
        for k in range(m):
            bm.faces.new((rings[i][k], rings[i][(k + 1) % m], rings[i + 1][(k + 1) % m], rings[i + 1][k]))
    bm.faces.new(list(reversed(rings[0])))
    bm.faces.new(rings[-1])
    bm.normal_update()
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(mat)
    for p in obj.data.polygons:
        p.use_smooth = True
    return obj


def wrapped_text(name, text, font, size, z_start, radius, angle, mat, lift=0.03, sx=1.0, sy=1.0):
    """radius は数か、z → 半径の関数（先細りの軸に沿わせる）"""
    rad = radius if callable(radius) else (lambda z: radius)
    return _wrapped_text(name, text, font, size, z_start, rad, angle, mat, lift, sx, sy)


def _wrapped_text(name, text, font, size, z_start, rad, angle, mat, lift, sx, sy):
    """文字を軸の表面に巻き付ける（字の横方向が軸の長さ方向、縦方向が円周）。angle は字の中心の角度（ラジアン。0 が +X＝正面）。
    字の上はクリップの側（−Y）へ向ける（ペン先を左にして見たとき、左から右へ正しく読める）。sx・sy は楕円の軸"""
    cu = bpy.data.curves.new(name, 'FONT')
    cu.body = text
    cu.size = size
    if font:
        cu.font = bpy.data.fonts.load(font, check_existing=True)
    cu.align_y = 'CENTER'
    cu.extrude = 0.0
    ob = bpy.data.objects.new(name, cu)
    bpy.context.collection.objects.link(ob)
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    bpy.ops.object.convert(target='MESH')
    ob = bpy.context.view_layer.objects.active
    ob.select_set(False)
    me = ob.data
    # 長い辺は巻き付けると弦になり、円周の中ほどが軸の中へ沈む（字の一部が欠ける）。0.25 mm 以下に割ってから巻く
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    for _ in range(8):
        long_edges = [e for e in bm.edges if e.calc_length() > 0.25]
        if not long_edges:
            break
        bmesh.ops.subdivide_edges(bm, edges=long_edges, cuts=1, use_grid_fill=False)
        bmesh.ops.triangulate(bm, faces=[f for f in bm.faces if len(f.verts) > 3])
    bm.to_mesh(me)
    bm.free()
    for v in me.vertices:
        x, y = v.co.x, v.co.y
        z = z_start + x
        r = rad(z)
        a = angle - y / (r * max(sx, sy))
        n = Vector((math.cos(a) / sx, math.sin(a) / sy, 0)).normalized()  # 楕円の面の外向き
        v.co = Vector((r * sx * math.cos(a), r * sy * math.sin(a), z)) + n * lift
    me.materials.clear()
    me.materials.append(mat)
    return ob


# ---- 形の種類 ----
def ballpoint(wood=False):
    """ノック式のボールペン（大学ノートのオリジナル。長さ 144 mm・軸の太さ 10.4 mm）"""
    if wood:
        col, rough, nrm = wood_maps()
        body = material('Body', (1, 1, 1), roughness=0.5, texture=col, rough_map=rough, normal_map=nrm,
                        normal_strength=1.0)
    else:
        body = material('Body', srgb('#2c2d30'), roughness=0.16, coat=1.0)
    M = {
        'body': body,
        # 木軸の金具は、つや消しのクロム（品の色で塗り替えない名前 Trim）
        'accent': material('Trim', (0.86, 0.86, 0.86), metallic=1.0, roughness=0.28) if wood
        else material('Accent', srgb('#55575c'), roughness=0.2, coat=0.8),
        'grip': material('Grip', srgb('#2a2a2c'), roughness=0.72),
        'chrome': material('Chrome', (0.92, 0.92, 0.92), metallic=1.0, roughness=0.08),
        'tip': material('TipMetal', (0.85, 0.85, 0.86), metallic=1.0, roughness=0.18),
        'ball': material('Ball', (0.5, 0.5, 0.52), metallic=1.0, roughness=0.12),
        'print': material('Engrave', srgb('#3b2414'), roughness=0.8) if wood
        else material('Print', (0.9, 0.9, 0.9), roughness=0.45),
    }
    R = 5.2  # 軸の半径
    # ペン先（金属の口金とボール）
    lathe('Tip', fillet([(0, 0.0), (0.45, 0.05), (0.62, 0.5), (1.0, 1.6), (1.55, 3.4), (1.6, 3.6), (0, 3.6)], 0.15),
          M['tip'])
    lathe('TipBall', [(0, -0.12), (0.18, -0.08), (0.25, 0.0), (0.18, 0.08), (0, 0.12)], M['ball'])
    # 先の円すい（樹脂）とグリップ
    cone = fillet([(0, 3.4), (1.5, 3.4), (1.7, 3.6), (3.4, 9.0), (4.6, 13.0), (4.9, 14.0), (4.9, 14.2), (0, 14.2)], 0.4)
    lathe('Cone', cone, M['accent'])
    if wood:  # 木軸：グリップも同じ木（ゴムを巻かない）。持つ所はわずかにくびれる
        lathe('Grip', fillet([(0, 14.0), (4.95, 14.0), (5.1, 14.6), (4.85, 27.0), (5.1, 40.6), (4.95, 41.2), (0, 41.2)], 0.5),
              M['body'])
    else:
        grip = [(0, 14.0), (4.95, 14.0), (5.15, 14.3)] + ridged(5.15, 14.6, 40.6, 0.16, 0.85) + [(5.1, 40.9), (4.95, 41.2),
                                                                                                    (0, 41.2)]
        lathe('Grip', grip, M['grip'])
    # 継ぎ目の金属の輪
    lathe('Ring', fillet([(0, 41.0), (5.0, 41.0), (5.32, 41.2), (5.32, 42.6), (5.0, 42.8), (0, 42.8)], 0.15), M['chrome'])
    # 軸（わずかに先細り）
    barrel = fillet([(0, 42.6), (5.05, 42.6), (5.2, 42.8), (R, 60), (5.12, 100), (5.0, 126.8), (4.9, 127.2), (0, 127.2)], 0.3)
    lathe('Barrel', barrel, M['body'])
    # 天冠（クリップの付け根）とノック
    lathe('TopCap', fillet([(0, 127.0), (4.95, 127.0), (5.1, 127.4), (5.05, 133.4), (4.4, 134.2), (0, 134.2)], 0.45),
          M['accent'])
    lathe('KnockRing', fillet([(0, 134.0), (3.6, 134.0), (3.6, 134.9), (0, 134.9)], 0.2), M['chrome'])
    lathe('Knock', fillet([(0, 134.8), (3.1, 134.8), (3.15, 140.0), (2.9, 143.2), (2.1, 144.0), (0, 144.1)], 0.5),
          M['accent'])
    # クリップ（ばね鋼のめっき）：天冠の上から軸に沿って下り、先に軸へ触れるふくらみ
    path = []
    for i in range(61):
        t = i / 60
        z = 133.2 - t * 44.0
        if t < 0.08:  # 付け根：天冠の中へ曲がり込む
            off = 4.7 + (t / 0.08) * 1.55
        elif t < 0.92:
            off = 6.25 - (t - 0.08) / 0.84 * 0.55  # 先へ行くほど軸へ寄る
        else:
            off = 5.7 - math.sin((t - 0.92) / 0.08 * math.pi) * 0.25
        path.append((0, -off, z))
    sweep('Clip', path, 4.2, 0.8, M['chrome'], lambda p: (0, -1, 0), round_r=0.35)
    lathe('ClipBall', fillet([(0, 88.8), (1.1, 89.0), (1.25, 90.0), (1.1, 91.0), (0, 91.2)], 0.35), M['chrome'],
          seg=48).location = (0, -5.85, 0)
    # 印字：大学ノートと字幅（字幅は 4 つ。アプリが品の字幅だけを出す）
    ang = 0.0  # 正面（3D の表示と横からの絵で見える側）

    def br(z):  # 軸の半径（先細り：60 mm で 5.2、100 mm で 5.12、126.8 mm で 5.0）
        return 5.2 if z <= 60 else 5.2 - (z - 60) / 40 * 0.08 if z <= 100 else 5.12 - (z - 100) / 26.8 * 0.12

    lift = 0.03  # 焼き印も印刷も、面から 0.04mm 浮かせる（同じ高さだと奥行きの精度で欠ける）
    wrapped_text('Print_brand', '大学ノート', FONT_JA, 3.0, 62.0, br, ang, M['print'], lift=lift + 0.01)
    wrapped_text('Print_brand_en', 'DAIGAKU NOTE', None, 2.2, 79.0, br, ang, M['print'], lift=lift + 0.01)
    for mm in ('0.38', '0.5', '0.7', '1.0'):
        wrapped_text(f'Print_mm_{mm.replace(".", "")}', mm, None, 2.4, 106.0, br, ang, M['print'], lift=lift + 0.01)


def marker(wide=False, hider=False):
    """マーカー（太字の角芯。キャップは色の付いた半透明）と文字隠しペン（細身・丸軸）"""
    sx, sy = (1.42, 1.0) if not hider else (1.0, 1.0)
    W = 6.6 if wide else (6.0 if not hider else 5.6)
    L = 128 if not hider else 136
    M = {
        'body': material('Body', srgb('#f4f4f2'), roughness=0.22, coat=0.6),
        'cap': material('Cap', srgb('#ffe14d'), roughness=0.18, transmission=0.55, ior=1.49),
        'felt': material('Felt', srgb('#ffe14d'), roughness=0.95),
        'plug': material('Plug', srgb('#ffe14d'), roughness=0.3, coat=0.5),
        'print': material('Print', (0.25, 0.25, 0.27), roughness=0.45),
    }
    # 角芯（フェルト）：先を斜めに切った板
    fw = (5.0 if wide else 3.6) if not hider else 2.6
    me = bpy.data.meshes.new('Felt')
    bm = bmesh.new()
    pts = [(-fw / 2, -0.9, 9.0), (fw / 2, -0.9, 9.0), (fw / 2, 0.9, 9.0), (-fw / 2, 0.9, 9.0),
           (-fw / 2, -0.9, 0.6), (fw / 2, -0.9, 0.6), (fw / 2, 0.9, 2.4), (-fw / 2, 0.9, 2.4)]
    v = [bm.verts.new(p) for p in pts]
    for f in ((0, 1, 2, 3), (7, 6, 5, 4), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)):
        bm.faces.new([v[i] for i in f])
    bmesh.ops.bevel(bm, geom=list(bm.edges), offset=0.18, segments=3, affect='EDGES')
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new('Felt', me)
    bpy.context.collection.objects.link(ob)
    me.materials.append(M['felt'])
    for p in me.polygons:
        p.use_smooth = True
    # 芯の根元（白い樹脂）
    lathe('Nose', fillet([(0, 8.0), (2.6, 8.0), (3.4, 12.0), (W - 0.6, 16.0), (W - 0.6, 17.5), (0, 17.5)], 0.4),
          M['body'], sx=sx, sy=sy)
    # 軸：楕円の断面（マーカー）・丸（文字隠しペン）
    lathe('Barrel', fillet([(0, 17.0), (W - 0.2, 17.0), (W, 18.0), (W, L - 22), (W - 0.15, L - 8), (W - 0.5, L - 6.0),
                            (0, L - 6.0)], 0.5), M['body'], sx=sx, sy=sy)
    # 尻栓
    lathe('Plug', fillet([(0, L - 6.6), (W - 0.6, L - 6.6), (W - 0.55, L - 1.6), (W - 1.6, L), (0, L + 0.05)], 0.6),
          M['plug'], sx=sx, sy=sy)
    # キャップ：厚みのある殻（外側を上へ、内側を下へ。半透明なので中の芯が透けて見える）
    cl = 46.0
    outer = [(0, -1.4), (2.0, -1.4), (W - 0.2, 2.0), (W + 0.55, 6.0), (W + 0.6, cl - 2), (W + 0.4, cl)]
    inner = [(W - 0.05, cl), (W - 0.05, 6.5), (W - 1.0, 2.6), (1.6, 0.2), (0, 0.2)]
    lathe('Cap', fillet(outer, 0.8) + fillet(inner, 0.5), M['cap'], sx=sx, sy=sy)
    # キャップのクリップ（キャップと同じ樹脂。根元から先へ細くなる）
    # 根元はキャップの閉じた側（ペン先の側）。開いた側へ向かってわずかに軸へ寄り、先はふくらんで軸に触れる
    path = []
    for i in range(49):
        t = i / 48
        z = 3.0 + t * 36.0
        if t < 0.1:
            off = (W + 0.4) * sy + (t / 0.1) * 1.5
        else:
            off = (W + 0.6) * sy + 1.5 - (t - 0.1) * 0.5 - (0.35 * math.sin((t - 0.86) / 0.14 * math.pi) if t > 0.86 else 0)
        path.append((0, -off, z))
    sweep('CapClip', path, 4.0 if not hider else 3.2, 1.6, M['cap'], lambda p: (0, -1, 0), round_r=0.7)
    # 印字（軸の正面）
    wrapped_text('Print_brand', '大学ノート', FONT_JA, 3.2, 60.0 if not hider else 62.0, W, 0.0, M['print'], sx=sx, sy=sy)
    wrapped_text('Print_kind', 'HIGHLIGHTER' if not hider else 'CHECK PEN', None, 2.2, 80.0 if not hider else 82.0, W, 0.0,
                 M['print'], sx=sx, sy=sy)


def wood_maps(w=1024, h=2048, out_dir='/tmp/pens3d-wood'):
    """木軸の画像 3 枚（色・粗さ・凹凸の法線）。実物の木の作りから求める：
    - 軸は、丸太から削り出した円柱。年輪は丸太の芯のまわりの同心の筒で、芯は軸から外れ、わずかに傾いている
      → 軸の表面と年輪が交わる所が木目。ほぼまっすぐな筋（柾目）と、ところどころの山形（板目のタケノコ模様）が出る
    - 年輪の中は、春にできる早材（明るく柔らかい・大きな導管＝小さな穴が並ぶ）と、夏にできる晩材（濃く硬い）
    - 仕上げはオイル：早材はわずかにへこみ（研ぐと柔らかい所が先に削れる）、導管はくぼみで光沢が鈍い
    - 放射組織（芯から外へ向かう細い斑）、色むら、細かな繊維の筋も足す
    u は軸の円周（周 2π×5.2 mm）、v は軸の長さ（約 85 mm）"""
    import numpy as np
    rng = np.random.default_rng(20261031)
    os.makedirs(out_dir, exist_ok=True)
    R = 5.2
    L = 85.0
    th = np.linspace(0, 2 * np.pi, w, endpoint=False)[None, :]
    z = np.linspace(0, L, h)[:, None]
    X, Y = R * np.cos(th), R * np.sin(th)

    def fbm(px, py, pz, octaves, base, seed):
        """方向をばらした正弦波を重ねた、なめらかなゆらぎ（-1〜1 くらい）"""
        r = np.random.default_rng(seed)
        acc = np.zeros(np.broadcast(px, py, pz).shape)
        amp, f = 1.0, base
        for _ in range(octaves):
            for _ in range(3):
                d = r.normal(size=3)
                d /= np.linalg.norm(d)
                acc += amp * np.sin(f * (d[0] * px + d[1] * py + d[2] * pz) + r.uniform(0, 2 * np.pi))
            amp *= 0.55
            f *= 2.1
        return acc / 3

    # 丸太の芯：軸から 38 mm 外れ、長さ方向に 2.5° 傾く（年輪が軸の表面を斜めに切って山形が出る）
    cx, cy, tilt = 38.0, 9.0, np.radians(2.5)
    ax = np.array([np.sin(tilt), 0.0, np.cos(tilt)])
    PX, PY, PZ = X - cx, Y - cy, z + 0 * X
    dot = PX * ax[0] + PY * ax[1] + PZ * ax[2]
    dist = np.sqrt(np.maximum(PX ** 2 + PY ** 2 + PZ ** 2 - dot ** 2, 0))
    # 年輪の幅（1.1〜1.8 mm で年ごとに違う）とゆがみ
    warp = fbm(X, Y, z, 4, 0.08, 1) * 1.6 + fbm(X, Y, z, 3, 0.6, 2) * 0.18
    rings = dist + warp
    year_w = 1.45 + 0.35 * np.sin(rings * 0.21) + 0.15 * np.sin(rings * 0.53 + 1.0)
    phase = (rings / year_w) % 1.0  # 0：早材の始まり → 1：晩材の終わり
    late = np.clip((phase - 0.58) / 0.32, 0, 1) ** 1.4  # 晩材の割合（年輪の後ろ 4 割で濃くなる）
    late = np.where(phase > 0.93, 1 - (phase - 0.93) / 0.07 * 0.85, late)  # 年輪の境（はっきりした線）
    early_band = np.clip(1 - phase / 0.25, 0, 1)  # 早材の帯（導管が並ぶ所）

    def blur(a, r):
        """ずらして平均するぼかし（u は輪のようにつながる）"""
        out = a.copy()
        for _ in range(r):
            out = (out + np.roll(out, 1, 1) + np.roll(out, -1, 1) + np.roll(out, 1, 0) + np.roll(out, -1, 0)) / 5
        return out

    # 導管（小さな穴）：早材の帯に多く、晩材にはまばら。長さ方向に伸びた大小の楕円のくぼみ（ふちはぼかす）
    pores = np.zeros((h, w))
    n = 60000
    pu = rng.integers(0, w, n)
    pv = rng.integers(0, h, n)
    p_keep = 0.08 + 0.92 * early_band[pv, pu] ** 0.7
    keep = rng.random(n) < p_keep
    pu, pv = pu[keep], pv[keep]
    lens = np.clip(rng.gamma(2.0, 2.5, pu.size).astype(int) + 1, 1, 16)  # 長さ 0.04〜0.65 mm（短いものが多い）
    depth = rng.uniform(0.5, 1.0, pu.size)
    for k in range(16):
        m = k < lens
        taper = np.sin(np.pi * (k + 0.5) / np.maximum(lens[m], 1))  # 端ほど浅い
        vv = (pv[m] + k) % h
        pores[vv, pu[m]] = np.maximum(pores[vv, pu[m]], depth[m] * taper)
    pores = np.clip(blur(pores, 1) * 1.6, 0, 1)
    # 放射組織：年輪を横切る、ごく細く短いつやのある斑（わずかに明るい）
    ray_seed = np.clip(rng.normal(size=(h, w)) - 3.1, 0, None)
    rays = blur(np.maximum.reduce([np.roll(ray_seed, k, 0) for k in range(0, 18, 2)]), 1)
    rays = np.clip(rays * 2.5, 0, 1) * (0.4 + 0.6 * late)
    # 繊維の細かな筋：円周の向きに細かく変わり、長さ方向にはゆっくり変わる（ペーパーで研いだ木の表面の筋）
    col_noise = rng.normal(size=w)
    col_noise = (col_noise + np.roll(col_noise, 1) * 0.6 + np.roll(col_noise, -1) * 0.6) / 2.2
    fiber = col_noise[None, :] * (0.7 + 0.3 * np.sin(z / 3.0 + col_noise[None, :] * 3)) + 0.35 * fbm(X * 9, Y * 9, z * 0.35, 3, 2.8, 4)
    # 色むら：年ごとの色の濃さの違い（年輪に沿う）と、大きくゆるやかなむら
    year = np.floor(rings / year_w)
    year_tone = np.sin(year * 12.9898) * 43758.5453 % 1.0 - 0.5
    mott = fbm(X, Y, z, 2, 0.02, 5) * 0.5 + year_tone * 0.8

    # 色（sRGB）：明るい早材のはちみつ色、濃い晩材の焦げ茶、導管は暗く
    early_c = np.array([0.80, 0.62, 0.42])
    late_c = np.array([0.50, 0.32, 0.18])
    k = np.clip(late * 0.82 + mott * 0.12 + fiber * 0.035, 0, 1)[..., None]
    col = early_c * (1 - k) + late_c * k
    pore_c = np.array([0.30, 0.18, 0.09])  # 導管の中（濃い茶。灰色にしない）
    col = col * (1 - 0.75 * pores[..., None]) + pore_c * 0.75 * pores[..., None]
    col = col * (1 + 0.10 * rays[..., None])
    col = np.clip(col * (1 + 0.05 * mott[..., None]), 0, 1)

    # 高さ（mm）：早材は 4 µm へこみ、導管は 25 µm のくぼみ、繊維の筋で 1 µm のざらつき
    height = -0.004 * (1 - late) - 0.022 * pores + 0.0012 * fiber + 0.001 * rays
    du_mm = 2 * np.pi * R / w
    dv_mm = L / h
    gy, gx = np.gradient(height, dv_mm, du_mm)
    s = 18.0  # 見た目の強さ（実物の凹凸は細かいので、光で分かる程度に強める）
    nx, ny = -gx * s, -gy * s
    nz = np.ones_like(nx)
    ln = np.sqrt(nx ** 2 + ny ** 2 + nz ** 2)
    nrm = np.stack([nx / ln, ny / ln, nz / ln], -1) * 0.5 + 0.5

    # 粗さ：オイル仕上げの半つや（0.42）。晩材は少しつや、導管はつやなし
    rough = np.clip(0.44 - 0.08 * late + 0.38 * pores + 0.03 * fiber, 0.25, 0.95)

    def save(name, arr, colorspace, fmt):
        a = arr if arr.ndim == 3 else np.repeat(arr[..., None], 3, -1)
        img = bpy.data.images.new(name, w, h, alpha=False)
        rgba = np.concatenate([a, np.ones((h, w, 1))], -1).astype(np.float32)
        img.pixels.foreach_set(rgba.ravel())
        path = os.path.join(out_dir, f'{name}.{fmt.lower().replace("jpeg", "jpg")}')
        img.filepath_raw = path
        img.file_format = fmt
        img.save()
        bpy.data.images.remove(img)
        im = bpy.data.images.load(path)
        im.colorspace_settings.name = colorspace
        return im

    return (save('WoodColor', col, 'sRGB', 'JPEG'), save('WoodRough', rough, 'Non-Color', 'JPEG'),
            save('WoodNormal', nrm, 'Non-Color', 'PNG'))


FAMILIES = {
    'pen-ballpoint': lambda: ballpoint(),
    'pen-ballpoint-wood': lambda: ballpoint(wood=True),
    'marker': lambda: marker(),
    'marker-wide': lambda: marker(wide=True),
    'hider': lambda: marker(hider=True),
}


def build(name, out):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    FAMILIES[name]()
    # mm → m
    for ob in bpy.context.scene.objects:
        ob.scale = (0.001, 0.001, 0.001)
        ob.location = ob.location * 0.001
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    path = os.path.join(out, f'{name}.glb')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_yup=True, export_apply=True,
                              export_texcoords=True, export_normals=True, export_materials='EXPORT',
                              export_image_format='AUTO', export_jpeg_quality=90)
    return path


def preview(name, out, angle=0.0):
    """Cycles で描いた確かめ用の画像（スタジオの光・机の影）"""
    s = bpy.context.scene
    s.render.engine = 'CYCLES'
    s.cycles.device = 'CPU'
    s.cycles.samples = 96
    s.render.resolution_x, s.render.resolution_y = 1600, 700
    s.render.film_transparent = False
    world = bpy.data.worlds.new('W')
    s.world = world
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.9, 0.9, 0.9, 1)
    world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.25
    bpy.ops.mesh.primitive_plane_add(size=2, location=(0, 0, -0.0062))
    floor = bpy.context.object
    floor.data.materials.append(material('Floor', (0.45, 0.44, 0.42), roughness=0.7))
    # 寝かせる：軸を X に、クリップを上（+Z）へ（全体を 1 つの空の親に付けて回す）
    pivot = bpy.data.objects.new('Pivot', None)
    s.collection.objects.link(pivot)
    for ob in list(s.objects):
        if ob is floor or ob.type != 'MESH':
            continue
        ob.parent = pivot
    pivot.rotation_euler = (math.radians(90) + angle, 0, math.radians(-90))
    pivot.location = (0.072, 0, 0)
    target = bpy.data.objects.new('Target', None)
    s.collection.objects.link(target)
    def aim(ob):
        c = ob.constraints.new('TRACK_TO')
        c.target = target
        c.track_axis = 'TRACK_NEGATIVE_Z'
        c.up_axis = 'UP_Y'
    bpy.ops.object.light_add(type='AREA', location=(0.02, -0.12, 0.3))
    bpy.context.object.data.energy = 6
    bpy.context.object.data.size = 0.35
    aim(bpy.context.object)
    bpy.ops.object.light_add(type='AREA', location=(-0.3, 0.15, 0.1))
    bpy.context.object.data.energy = 2
    bpy.context.object.data.size = 0.3
    aim(bpy.context.object)
    bpy.ops.object.camera_add(location=(0.05, -0.2, 0.09))
    s.camera = bpy.context.object
    s.camera.data.lens = 60
    aim(s.camera)
    s.view_settings.view_transform = 'AgX'
    s.render.filepath = os.path.join(out, f'{name}.png')
    bpy.ops.render.render(write_still=True)


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default=os.path.join(os.path.dirname(__file__), '../../src/renderer/assets/stationery'))
    ap.add_argument('--preview', default=None)
    ap.add_argument('--only', default=None)
    a = ap.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:])
    for name in FAMILIES:
        if a.only and name != a.only:
            continue
        print('build', name, build(name, a.out))
        if a.preview:
            preview(name, a.preview)
