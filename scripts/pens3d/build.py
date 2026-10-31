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
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree
import numpy as np

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


# ---- ペンケース ----
# 形は自然な向き（長さ X・奥行き Y〔正面は −Y〕・高さ Z〔底が 0〕）で作り、最後にペンと同じ向き
# （長さ → Blender の +Z、上 → −Y、正面 → +X）へ回す（renderer/model3d-three.js はペンと同じ読み方で寝かせる）。
# 材質の名前（アプリが品の色で塗る）：CaseBase 本体（base）・CaseTrim 縁・タブ・ステッチ・ファスナーのテープ（trim）・
#   CaseZipCoil 樹脂のファスナーの歯（trim を暗く）・CaseZipTape 革のファスナーのテープ（base を暗く）・
#   CaseDeboss 型押しの字（base を暗く）・CaseLabelText 織りネームの字（base）。ZipMetal・Brass は塗らない
TEX_DIR = '/tmp/pens3d-tex'
TO_PEN = Matrix(((0, -1, 0), (0, 0, -1), (1, 0, 0))).to_4x4()  # X→Z・Y→−X・Z→−Y


def save_image(name, arr, colorspace, fmt):
    """numpy の配列（行 0 が画像の下）を画像にし、書き出して読み直す（GLB に入るように）"""
    os.makedirs(TEX_DIR, exist_ok=True)
    h, w = arr.shape[:2]
    a = arr if arr.ndim == 3 else np.repeat(arr[..., None], 3, -1)
    img = bpy.data.images.new(name, w, h, alpha=False)
    img.pixels.foreach_set(np.concatenate([a, np.ones((h, w, 1))], -1).astype(np.float32).ravel())
    path = os.path.join(TEX_DIR, f'{name}.{"jpg" if fmt == "JPEG" else "png"}')
    img.filepath_raw = path
    img.file_format = fmt
    img.save()
    bpy.data.images.remove(img)
    im = bpy.data.images.load(path)
    im.colorspace_settings.name = colorspace
    return im


def pnoise(h, w, sy, sx, rng):
    """つなぎ目なく繰り返すなめらかなゆらぎ（標準偏差 1）。sy・sx はぼかしの大きさ（画素）"""
    n = rng.normal(size=(h, w))
    fy = np.fft.fftfreq(h)[:, None]
    fx = np.fft.fftfreq(w)[None, :]
    g = np.exp(-2 * np.pi ** 2 * ((fy * sy) ** 2 + (fx * sx) ** 2))
    out = np.real(np.fft.ifft2(np.fft.fft2(n) * g))
    return out / (out.std() + 1e-12)


def normal_map(height, px_mm, strength=1.0):
    """高さ（mm）→ 法線（つなぎ目なく）。行が v（上）、列が u（右）"""
    gx = (np.roll(height, -1, 1) - np.roll(height, 1, 1)) / (2 * px_mm)
    gy = (np.roll(height, -1, 0) - np.roll(height, 1, 0)) / (2 * px_mm)
    nx, ny, nz = -gx * strength, -gy * strength, np.ones_like(gx)
    ln = np.sqrt(nx ** 2 + ny ** 2 + nz ** 2)
    return np.stack([nx / ln, ny / ln, nz / ln], -1) * 0.5 + 0.5


def canvas_maps(tile_mm=9.6, n=16, px=768):
    """帆布（太い綿糸の平織り）：たて糸とよこ糸が 1 本ずつ上下に交わる。糸ごとの太さ・色のむら、毛羽、
    織り目の谷の影。色は灰色（アプリが品の色を掛ける）"""
    rng = np.random.default_rng(7)
    c = px / n  # 1 本の幅（画素）
    y, x = np.mgrid[0:px, 0:px].astype(float)
    i, j = np.floor(x / c), np.floor(y / c)
    fx, fy = (x % c) / c, (y % c) / c
    slub_w = 1 + 0.10 * pnoise(px, n, 40, 0.01, rng)[:, i[0].astype(int)]  # たて糸の太さ（長さに沿ってゆっくり変わる）
    slub_f = 1 + 0.10 * pnoise(n, px, 0.01, 40, rng)[j[:, 0].astype(int)][:, :]
    prof = lambda f, k: np.sqrt(np.clip(1 - ((f - 0.5) / (0.47 * k)) ** 2, 0, 1))  # 糸の断面（丸）
    warp = prof(fx, slub_w) * (0.45 + 0.55 * (0.5 + 0.5 * np.cos(np.pi * (y / c - 0.5 + i))))
    weft = prof(fy, slub_f) * (0.45 + 0.55 * (0.5 + 0.5 * np.cos(np.pi * (x / c - 0.5 + j + 1))))
    top = np.maximum(warp, weft)
    # 糸の撚り（斜めの細い筋）と毛羽
    twist_w = 0.06 * np.sin(2 * np.pi * (y / c * 3 + fx * 1.2))
    twist_f = 0.06 * np.sin(2 * np.pi * (x / c * 3 + fy * 1.2))
    twist = np.where(warp >= weft, twist_w, twist_f) * top
    fuzz = 0.05 * pnoise(px, px, 0.8, 0.8, rng)
    height = 0.16 * (top + twist + fuzz)  # mm（糸の太さ 0.3 mm くらい）
    tone_w = rng.normal(0, 0.035, n)[i.astype(int)]
    tone_f = rng.normal(0, 0.035, n)[j.astype(int)]
    tone = np.where(warp >= weft, tone_w, tone_f)
    mott = 0.025 * pnoise(px, px, 60, 60, rng)
    col = np.clip(0.70 + 0.30 * top ** 0.7 + tone + mott + 0.5 * fuzz * top, 0, 1)
    rough = np.clip(0.93 - 0.08 * top, 0, 1)
    return (save_image('CanvasColor', col, 'sRGB', 'JPEG'), save_image('CanvasRough', rough, 'Non-Color', 'JPEG'),
            save_image('CanvasNormal', normal_map(height, tile_mm / px, 1.0), 'Non-Color', 'PNG'), tile_mm)


def gblur(a, sigma):
    """つなぎ目なくぼかす（画素）"""
    h, w = a.shape
    fy = np.fft.fftfreq(h)[:, None]
    fx = np.fft.fftfreq(w)[None, :]
    return np.real(np.fft.ifft2(np.fft.fft2(a) * np.exp(-2 * np.pi ** 2 * sigma ** 2 * (fx ** 2 + fy ** 2))))


def voronoi(px, k, rng, warp=0.0):
    """つなぎ目なく繰り返すボロノイ（いちばん近い種までの距離 f1 と 2 番目 f2。画素）。
    warp：位置をなめらかにゆがめる量（画素。境がまっすぐな多角形に見えないように）"""
    seeds = rng.random((k, 2)) * px
    y, x = np.mgrid[0:px, 0:px].astype(float)
    if warp:
        x = (x + warp * pnoise(px, px, px / 40, px / 40, rng)) % px
        y = (y + warp * pnoise(px, px, px / 40, px / 40, rng)) % px
    f1 = np.full((px, px), 1e9)
    f2 = np.full((px, px), 1e9)
    for sx, sy in seeds:
        dx = np.abs(x - sx)
        dx = np.minimum(dx, px - dx)
        dy = np.abs(y - sy)
        dy = np.minimum(dy, px - dy)
        d = np.sqrt(dx * dx + dy * dy)
        f2 = np.where(d < f1, f1, np.minimum(f2, d))
        f1 = np.minimum(f1, d)
    return f1, f2


def leather_maps(tile_mm=16.0, px=1024):
    """シボ革（自然なシボ）：大小の丸い粒のゆるいふくらみと、そのあいだの浅くやわらかな谷、毛穴、大きなゆるいしわ。
    谷はわずかに暗くつやが鈍く、粒の頭はなでられてつやが出る（コントラストは低く、近くで見て分かる程度）"""
    rng = np.random.default_rng(11)
    mm = tile_mm / px
    # 大きな粒（1.4 mm くらい）と小さな粒（0.6 mm くらい）を重ねる。位置を少しゆがめて、多角形に見えないようにする
    f1a, f2a = voronoi(px, int((tile_mm / 1.3) ** 2), rng, warp=9)
    f1b, f2b = voronoi(px, int((tile_mm / 0.55) ** 2), rng, warp=4)
    valley_a = np.exp(-((f2a - f1a) * mm) / 0.06)  # 粒のあいだの細い谷
    valley_b = np.exp(-((f2b - f1b) * mm) / 0.035)
    dome = 1 - np.clip(f1a * mm / 1.0, 0, 1) ** 2  # 粒のふくらみ
    wrinkle = pnoise(px, px, 40, 110, rng)
    pores = np.clip(rng.normal(size=(px, px)) - 3.0, 0, None)
    pores = np.clip(gblur(pores, 0.6) * 3, 0, 1)
    height = gblur(0.020 * dome - 0.028 * valley_a - 0.008 * valley_b - 0.008 * pores, 1.0) + 0.012 * wrinkle
    mott = pnoise(px, px, 70, 70, rng)
    col = np.clip(0.92 + 0.03 * dome - 0.07 * valley_a - 0.025 * valley_b - 0.03 * pores + 0.02 * mott, 0, 1)
    rough = np.clip(0.46 - 0.06 * dome + 0.16 * valley_a + 0.05 * valley_b + 0.15 * pores, 0.2, 1)
    return (save_image('LeatherColor', col, 'sRGB', 'JPEG'), save_image('LeatherRough', rough, 'Non-Color', 'JPEG'),
            save_image('LeatherNormal', normal_map(height, mm, 1.0), 'Non-Color', 'PNG'), tile_mm)


def brushed_maps(tile_mm=24.0, px=512):
    """缶の塗装：長さの向きにごく細いヘアラインと、わずかなゆず肌"""
    rng = np.random.default_rng(13)
    lines = pnoise(px, px, 0.5, 80, rng)  # 横（長さ）に伸びた筋（ごく弱く。塗装の下の地肌がうっすら見える程度）
    peel = pnoise(px, px, 5, 5, rng)
    height = 0.0004 * lines + 0.0012 * peel
    rough = np.clip(0.30 + 0.015 * lines, 0, 1)
    return (None, save_image('TinRough', rough, 'Non-Color', 'JPEG'),
            save_image('TinNormal', normal_map(height, tile_mm / px, 1.0), 'Non-Color', 'PNG'), tile_mm)


def obj_from_bm(name, bm, mat, smooth=True):
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    ob = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(ob)
    ob.data.materials.append(mat)
    if smooth:
        for p in ob.data.polygons:
            p.use_smooth = True
    return ob


def pouch_surface(L, D, H, nu=161, nv=128, end='pinch', end_frac=0.12, n_top=2.6, n_bot=4.5, top_narrow=0.35,
                  wrinkle=0.0, seed=1):
    """袋の形の点（nu×nv×3）。s は長さ（−1〜1）、t は断面の角（0 が奥 +Y、π/2 が上、π が正面 −Y）。
    end='pinch'：端は縫い目（奥行きが 0 になる・高さは残る）、'round'：端を丸く閉じる"""
    s = np.sin(np.linspace(-1, 1, nu) * np.pi / 2)[:, None]  # 端ほど細かく（端の丸みをなめらかに）
    t = np.linspace(0, 2 * np.pi, nv, endpoint=False)[None, :]
    a_s = np.abs(s)
    if end == 'pinch':
        fa = np.clip(1 - a_s ** 3.2, 0, 1) ** 0.5
        z1 = H * (1 - 0.14 * s ** 4)
        z0 = H * 0.10 * a_s ** 6
        kk = np.ones_like(s)
    else:
        e = end_frac
        q = np.clip((a_s - (1 - e)) / e, 0, 1)
        kk = np.sqrt(np.clip(1 - q ** 2, 0, 1))
        fa = kk
        z1 = np.full_like(s, H)
        z0 = np.zeros_like(s)
    zc = (z0 + z1) / 2
    b = (z1 - z0) / 2 * kk
    c, sn = np.cos(t), np.sin(t)
    n = np.where(sn > 0, n_top, n_bot)
    cy = np.sign(c) * np.abs(c) ** (2 / n)
    cz = np.sign(sn) * np.abs(sn) ** (2 / n)
    yy = (D / 2) * fa * cy * (1 - top_narrow * np.clip(sn, 0, None) ** 2)
    zz = zc + b * cz
    xx = np.broadcast_to(s * L / 2, yy.shape).copy()
    P = np.stack([xx, yy, zz], -1)
    if wrinkle:
        r = np.random.default_rng(seed)
        w = np.zeros_like(yy)
        for _ in range(7):
            w += r.normal() * np.sin(r.uniform(4, 16) * s + r.integers(1, 5) * t + r.uniform(0, 6.3))
        w *= wrinkle / 3 * np.clip(1 - a_s ** 2, 0, 1) * (0.4 + 0.6 * np.clip(-sn, 0, 1) + 0.6 * np.clip(sn, 0, 1))
        nrm = np.stack(np.broadcast_arrays(np.zeros_like(yy), cy, cz), -1).astype(float)
        nrm /= np.linalg.norm(nrm, axis=-1, keepdims=True) + 1e-9
        P += nrm * w[..., None]
    return P


def grid_object(name, P, mat, tile_mm, poles=False):
    """点の格子（u：長さ・v：円周〔つながる〕）から面を作る。UV は長さに沿った mm ÷ 模様の大きさ。
    poles：両端の輪の真ん中に 1 点を足してふさぐ"""
    nu, nv = P.shape[:2]
    du = np.linalg.norm(np.diff(P, axis=0), axis=-1).mean(axis=1)
    U = np.concatenate([[0], np.cumsum(du)]) / tile_mm
    seg = np.linalg.norm(np.roll(P, -1, axis=1) - P, axis=-1)
    V = np.concatenate([np.zeros((nu, 1)), np.cumsum(seg, axis=1)], axis=1) / tile_mm
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new()
    vs = [[bm.verts.new(P[i, j]) for j in range(nv)] for i in range(nu)]
    for i in range(nu - 1):
        for j in range(nv):
            j2 = (j + 1) % nv
            f = bm.faces.new((vs[i][j], vs[i][j2], vs[i + 1][j2], vs[i + 1][j]))
            for loop, (ii, jj) in zip(f.loops, ((i, j), (i, j + 1), (i + 1, j + 1), (i + 1, j))):
                loop[uvl].uv = (U[ii], V[ii, jj])
    if poles:
        for i, rev in ((0, True), (nu - 1, False)):
            cpos = P[i].mean(axis=0)
            cv = bm.verts.new(cpos)
            for j in range(nv):
                j2 = (j + 1) % nv
                tri = (vs[i][j], vs[i][j2], cv) if not rev else (vs[i][j2], vs[i][j], cv)
                try:
                    f = bm.faces.new(tri)
                except ValueError:
                    continue
                for loop in f.loops:
                    co = loop.vert.co
                    loop[uvl].uv = (co.y / tile_mm, co.z / tile_mm)
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1e-4)
    bm.normal_update()
    return obj_from_bm(name, bm, mat)


def surf_at(P, s, t):
    """格子の点を (s: 0〜1, t: 0〜2π) で引く（近い格子の点を線形にまぜる）"""
    nu, nv = P.shape[:2]
    fi = s * (nu - 1)
    fj = (t % (2 * np.pi)) / (2 * np.pi) * nv
    i0, j0 = int(min(fi, nu - 2)), int(fj) % nv
    di, dj = fi - i0, fj - int(fj)
    j1 = (j0 + 1) % nv
    p = (P[i0, j0] * (1 - di) * (1 - dj) + P[i0 + 1, j0] * di * (1 - dj) + P[i0, j1] * (1 - di) * dj +
         P[i0 + 1, j1] * di * dj)
    return Vector(p)


def surf_normal(P, s, t):
    e = 1e-3
    a = surf_at(P, min(s + e, 1), t) - surf_at(P, max(s - e, 0), t)
    b = surf_at(P, s, t + 0.02) - surf_at(P, s, t - 0.02)
    n = b.cross(a)  # 外向き（grid_object と同じ回り）
    return n.normalized() if n.length > 1e-9 else Vector((0, 0, 1))


def blocks(name, items, mat, smooth=False):
    """小さな直方体をまとめた 1 つの形。items：(中心, 長さの向き, 上の向き, 長さ, 幅, 高さ)"""
    bm = bmesh.new()
    for c, ax, up, l, w, h in items:
        ax = Vector(ax).normalized()
        up = (Vector(up) - ax * Vector(up).dot(ax)).normalized()
        sd = ax.cross(up)
        vs = []
        for dz in (-0.5, 0.5):
            for dy in (-0.5, 0.5):
                for dx in (-0.5, 0.5):
                    k = 0.8 if dz > 0 else 1.0  # 上を少しすぼめる（丸みに見せる）
                    vs.append(bm.verts.new(Vector(c) + ax * (dx * l * k) + sd * (dy * w * k) + up * (dz * h)))
        for f in ((0, 2, 3, 1), (4, 5, 7, 6), (0, 1, 5, 4), (2, 6, 7, 3), (0, 4, 6, 2), (1, 3, 7, 5)):
            bm.faces.new([vs[i] for i in f])
    bm.normal_update()
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    return obj_from_bm(name, bm, mat, smooth)


def rbox(name, sx, sy, sz, z0, r_v, r_e, mat, seg_v=10, seg_e=4, tile_mm=None):
    """角を丸めた箱（縦の角は r_v、ほかの角は r_e）"""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co = Vector((v.co.x * sx, v.co.y * sy, v.co.z * sz + z0 + sz / 2))
    vert_edges = [e for e in bm.edges if abs(e.verts[0].co.x - e.verts[1].co.x) < 1e-6 and
                  abs(e.verts[0].co.y - e.verts[1].co.y) < 1e-6]
    bmesh.ops.bevel(bm, geom=vert_edges, offset=r_v, offset_type='OFFSET', segments=seg_v, profile=0.5,
                    affect='EDGES', clamp_overlap=True)
    bm.edges.ensure_lookup_table()
    sharp = [e for e in bm.edges if e.is_manifold and e.calc_face_angle(0) > 0.6]
    bmesh.ops.bevel(bm, geom=sharp, offset=r_e, offset_type='OFFSET', segments=seg_e, profile=0.5,
                    affect='EDGES', clamp_overlap=True)
    bm.normal_update()
    if tile_mm:
        uvl = bm.loops.layers.uv.new()
        for f in bm.faces:
            n = f.normal
            for loop in f.loops:
                co = loop.vert.co
                loop[uvl].uv = ((co.x / tile_mm, co.y / tile_mm) if abs(n.z) > 0.7 else
                                (co.x / tile_mm, co.z / tile_mm) if abs(n.y) >= abs(n.x) else (co.y / tile_mm, co.z / tile_mm))
    ob = obj_from_bm(name, bm, mat)
    ob.data.set_sharp_from_angle(angle=math.radians(35))
    return ob


def flat_text(name, text, font, size, mat, align='CENTER'):
    """字の形（XY 面・字の中心が原点）。長い辺は細かく割る（あとで面に沿わせるため）"""
    cu = bpy.data.curves.new(name, 'FONT')
    cu.body = text
    cu.size = size
    cu.align_x = align
    cu.align_y = 'CENTER'
    if font:
        cu.font = bpy.data.fonts.load(font, check_existing=True)
    ob = bpy.data.objects.new(name, cu)
    bpy.context.collection.objects.link(ob)
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    bpy.ops.object.convert(target='MESH')
    ob = bpy.context.view_layer.objects.active
    ob.select_set(False)
    subdivide_long(ob.data, 0.6)
    ob.data.materials.clear()
    ob.data.materials.append(mat)
    return ob


def subdivide_long(me, limit):
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    for _ in range(8):
        long_edges = [e for e in bm.edges if e.calc_length() > limit]
        if not long_edges:
            break
        bmesh.ops.subdivide_edges(bm, edges=long_edges, cuts=1, use_grid_fill=False)
        bmesh.ops.triangulate(bm, faces=[f for f in bm.faces if len(f.verts) > 3])
    bm.to_mesh(me)
    bm.free()


def rounded_plate(name, w, h, r, mat):
    """角を丸めた平らな板（XY 面・中心が原点。織りネームや札）"""
    bm = bmesh.new()
    pts = []
    for cx, cy, a0 in ((w / 2 - r, h / 2 - r, 0), (-w / 2 + r, h / 2 - r, 90), (-w / 2 + r, -h / 2 + r, 180),
                       (w / 2 - r, -h / 2 + r, 270)):
        for k in range(7):
            a = math.radians(a0 + 90 * k / 6)
            pts.append(bm.verts.new((cx + r * math.cos(a), cy + r * math.sin(a), 0)))
    bm.faces.new(pts)
    ob = obj_from_bm(name, bm, mat, smooth=False)
    subdivide_long(ob.data, 0.8)
    return ob


def place_on(ob, target, origin_of, direction, lift):
    """平らな形（XY 面）の点を、origin_of(x, y) から direction へ飛ばして target の面に当て、面から lift だけ浮かせる"""
    dg = bpy.context.evaluated_depsgraph_get()
    bvh = BVHTree.FromObject(target, dg)
    d = Vector(direction).normalized()
    for v in ob.data.vertices:
        o = Vector(origin_of(v.co.x, v.co.y))
        hit, nrm, _, _ = bvh.ray_cast(o, d)
        if hit is not None:
            if nrm.dot(d) > 0:
                nrm = -nrm
            v.co = hit + nrm * lift
    for p in ob.data.polygons:
        p.use_smooth = True


def zipper(P, s0, s1, tape_mat, teeth_mat, metal_mat, pull_mat, tape_w=10.0, tooth=(1.6, 5.2, 1.3), pitch=1.9,
           slider_s=0.78, pull_len=20.0, pull_w=6.5, pull_thick=1.2, leather_pull=False):
    """袋の上（t=π/2）に沿ったファスナー：テープ・歯（左右からかみ合う）・スライダー・引き手（正面へ垂れる）"""
    n = 400
    path, ups = [], []
    for k in range(n + 1):
        s = s0 + (s1 - s0) * k / n
        p = surf_at(P, s, math.pi / 2)
        nrm = surf_normal(P, s, math.pi / 2)
        path.append(p + nrm * 0.45)
        ups.append(nrm)
    sweep('ZipTape', [tuple(p) for p in path], tape_w, 0.9, tape_mat,
          lambda p: tuple(ups[min(range(len(path)), key=lambda i: (path[i] - Vector(p)).length_squared)]),
          round_r=0.4)
    # 歯：テープの真ん中に、左右から交互に（かみ合う形）
    items = []
    acc, last = 0.0, path[0]
    side = 1
    for k in range(1, len(path)):
        acc += (path[k] - last).length
        last = path[k]
        if acc >= pitch:
            acc = 0.0
            ax = (path[min(k + 1, n)] - path[k - 1]).normalized()
            up = ups[k]
            sd = ax.cross(up).normalized()
            c = path[k] + up * (0.45 + tooth[2] / 2) + sd * (0.35 * side)
            items.append((tuple(c), tuple(ax), tuple(up), tooth[0], tooth[1], tooth[2]))
            side = -side
    blocks('ZipTeeth', items, teeth_mat, smooth=True)
    # スライダー（角を丸めた金属の塊）と引き手
    ks = int(slider_s * n)
    c, ax, up = path[ks], (path[ks + 1] - path[ks - 1]).normalized(), ups[ks]
    sl = rbox('ZipSlider', 11.0, 8.6, 3.6, 0, 1.6, 0.8, metal_mat, seg_v=4, seg_e=2)
    sd = ax.cross(up).normalized()
    m = Matrix((ax, sd, up)).transposed().to_4x4()
    sl.data.transform(m)
    sl.data.transform(Matrix.Translation(c + up * 0.6))
    # 引き手：スライダーの正面側のふちから、袋の面に沿って正面（−Y）へ垂れる
    s_mid = s0 + (s1 - s0) * slider_s
    pts = []
    t0 = math.pi / 2 + 0.12
    for k in range(25):
        tt = t0 + (0.72 if leather_pull else 0.55) * k / 24
        p = surf_at(P, s_mid, tt)
        nr = surf_normal(P, s_mid, tt)
        pts.append(p + nr * (pull_thick / 2 + 0.9 + 2.0 * max(0, 1 - k / 6)))
    lim, out, acc = pull_len, [pts[0]], 0.0
    for k in range(1, len(pts)):
        acc += (pts[k] - pts[k - 1]).length
        out.append(pts[k])
        if acc >= lim:
            break
    sweep('ZipPull', [tuple(p) for p in out], pull_w, pull_thick, pull_mat,
          lambda p, s_mid=s_mid: tuple(Vector((0, -1, 0.6)).normalized()), round_r=0.5)
    return path


def stitches(name, curve_pts, normals, mat, length=2.3, gap=1.2, w=0.75, h=0.5):
    """縫い目の糸（面に沿った点の並びに、短い糸を一定の間隔で置く）"""
    items = []
    acc, on, start = 0.0, True, curve_pts[0]
    for k in range(1, len(curve_pts)):
        acc += (curve_pts[k] - curve_pts[k - 1]).length
        if on and acc >= length:
            mid = (start + curve_pts[k]) / 2
            ax = curve_pts[k] - start
            items.append((tuple(mid + normals[k] * (h * 0.35)), tuple(ax), tuple(normals[k]), ax.length, w, h))
            acc, on = 0.0, False
        elif not on and acc >= gap:
            acc, on, start = 0.0, True, curve_pts[k]
    return blocks(name, items, mat, smooth=True)


def case_materials(base=None, trim=None):
    """材質をそろえる（名前で塗るので、同じ名前を 2 度作らない）。base・trim は material() に渡す引数"""
    M = {}
    M['base'] = material('CaseBase', (1, 1, 1), **(base or {}))
    M['trim'] = material('CaseTrim', (1, 1, 1), **(trim or {'roughness': 0.8}))
    M['coil'] = material('CaseZipCoil', (0.6, 0.6, 0.6), roughness=0.45)
    M['ztape'] = material('CaseZipTape', (0.3, 0.3, 0.3), roughness=0.85)
    M['deboss'] = material('CaseDeboss', (0.4, 0.3, 0.2), roughness=0.75)
    M['label_text'] = material('CaseLabelText', (0.2, 0.2, 0.3), roughness=0.8)
    M['metal'] = material('ZipMetal', srgb('#a8a9a6'), metallic=1.0, roughness=0.3)
    M['brass'] = material('Brass', srgb('#c09a52'), metallic=1.0, roughness=0.28)
    return M


def maps_kw(maps, roughness):
    col, rough, nrm, _ = maps
    return dict(roughness=roughness, texture=col, rough_map=rough, normal_map=nrm)


def to_pen_axes():
    for ob in bpy.context.scene.objects:
        if ob.type == 'MESH':
            ob.data.transform(TO_PEN)


def case_pouch():
    """帆布の筆箱：舟形（両端は縫い目で閉じる）。上にコイルのファスナー、両端に縁取り、片方の端に輪のタブ、
    正面に織りネーム。L 200 × D 72 × H 62 mm"""
    cv = canvas_maps()
    M = case_materials(maps_kw(cv, 0.9), maps_kw(cv, 0.9))
    L, D, H = 200.0, 72.0, 62.0
    P = pouch_surface(L, D, H, end='pinch', n_top=2.4, n_bot=4.5, top_narrow=0.42, wrinkle=0.9, seed=3)
    body = grid_object('Body', P, M['base'], cv[3])
    zipper(P, 0.075, 0.925, M['trim'], M['coil'], M['metal'], M['metal'], tooth=(1.2, 4.6, 1.2), pitch=1.6)
    # 両端の縁取り（縫い目を包むテープ）
    for sgn in (-1, 1):
        z0 = H * 0.10 + 0.5
        z1 = H * (1 - 0.14) + 0.5
        path = [(sgn * (L / 2 - 0.5), 0, z0 - 1.2 + (z1 - z0 + 2.4) * k / 40) for k in range(41)]
        sweep(f'Binding_{"L" if sgn < 0 else "R"}', path, 9.0, 3.2, M['trim'], lambda p, sgn=sgn: (sgn, 0, 0),
              round_r=1.2)
    # 輪のタブ（右の端。テープを折って縫い込んだもの）
    zt = H * 0.62
    tab = [(L / 2 + 0.5, -1.4, zt), (L / 2 + 9, -1.4, zt), (L / 2 + 12, -0.8, zt), (L / 2 + 12.6, 0, zt),
           (L / 2 + 12, 0.8, zt), (L / 2 + 9, 1.4, zt), (L / 2 + 0.5, 1.4, zt)]
    sweep('LoopTab', tab, 11.0, 1.3, M['trim'],
          lambda p: (1, 0, 0) if p[0] > L / 2 + 11 else (0, -1 if p[1] < 0 else 1, 0), round_r=0.5)
    # 正面の織りネーム（右寄り）
    lab = rounded_plate('Label', 34, 12, 1.2, M['trim'])
    place_on(lab, body, lambda x, y: (52 + x, -200, H * 0.45 + y), (0, 1, 0), 0.5)
    txt = flat_text('LabelText', '大学ノート', FONT_JA, 5.6, M['label_text'])
    place_on(txt, body, lambda x, y: (52 + x, -200, H * 0.45 + y), (0, 1, 0), 0.75)
    to_pen_axes()


def case_leather():
    """革のペンケース：ふっくらした箱形（端は丸く閉じる）。真ちゅうのファスナー、両側に生成りのステッチ、
    革の引き手、正面に型押しの「大学ノート」。L 195 × D 60 × H 50 mm"""
    lv = leather_maps()
    M = case_materials(maps_kw(lv, 0.5), {'roughness': 0.7})
    L, D, H = 195.0, 60.0, 50.0
    P = pouch_surface(L, D, H, end='round', end_frac=0.13, n_top=3.6, n_bot=5.0, top_narrow=0.18, wrinkle=0.35,
                      seed=5)
    body = grid_object('Body', P, M['base'], lv[3], poles=True)
    zipper(P, 0.085, 0.915, M['ztape'], M['brass'], M['brass'], M['base'], tape_w=11.0, tooth=(1.8, 5.6, 1.5),
           pitch=2.1, pull_len=26.0, pull_w=7.5, pull_thick=2.2, leather_pull=True)
    # ステッチ：ファスナーの両側と、底の両側のふち
    for k, (tt, s0, s1) in enumerate(((math.pi / 2 - 0.30, 0.07, 0.93), (math.pi / 2 + 0.30, 0.07, 0.93),
                                     (-0.45, 0.10, 0.90), (math.pi + 0.45, 0.10, 0.90))):
        pts, nrs = [], []
        for i in range(600):
            s = s0 + (s1 - s0) * i / 599
            pts.append(surf_at(P, s, tt))
            nrs.append(surf_normal(P, s, tt))
        stitches(f'Stitch_{k}', pts, nrs, M['trim'])
    txt = flat_text('Deboss', '大学ノート', FONT_JA, 7.5, M['deboss'])
    place_on(txt, body, lambda x, y: (x, -200, H * 0.42 + y), (0, 1, 0), 0.05)
    txt2 = flat_text('Deboss_en', 'DAIGAKU NOTE', None, 3.0, M['deboss'])
    place_on(txt2, body, lambda x, y: (x, -200, H * 0.42 - 7 + y), (0, 1, 0), 0.05)
    to_pen_axes()


def case_clear():
    """クリアケース：平たい透明のポーチ（端は丸く閉じる）。色の付いた樹脂のファスナー。
    L 205 × D 34 × H 84 mm"""
    M = case_materials({'roughness': 0.06, 'transmission': 1.0, 'ior': 1.5}, {'roughness': 0.6})
    M['base'].use_backface_culling = False
    L, D, H = 205.0, 34.0, 84.0
    P = pouch_surface(L, D, H, nu=121, nv=128, end='round', end_frac=0.09, n_top=3.0, n_bot=6.0, top_narrow=0.25,
                      wrinkle=0.25, seed=9)
    body = grid_object('Body', P, M['base'], 20.0, poles=True)
    zipper(P, 0.05, 0.95, M['trim'], M['coil'], M['metal'], M['metal'], tooth=(1.2, 4.4, 1.2), pitch=1.6,
           slider_s=0.82)
    txt = flat_text('Print', '大学ノート', FONT_JA, 6.0, M['trim'])
    place_on(txt, body, lambda x, y: (60 + x, -200, H * 0.30 + y), (0, 1, 0), 0.05)
    to_pen_axes()


def case_tin():
    """缶ペンケース：角を丸めた浅い箱（下の箱とかぶせぶた）。後ろに蝶番、ふたに「大学ノート」の印刷。
    L 196 × D 64 × H 26 mm"""
    bmaps = brushed_maps()
    M = case_materials({'metallic': 0.9, 'roughness': 0.3, 'rough_map': bmaps[1], 'normal_map': bmaps[2]},
                       {'metallic': 0.6, 'roughness': 0.35})
    rbox('Tray', 194.0, 62.0, 16.5, 0.0, 9.0, 1.4, M['base'], tile_mm=bmaps[3])
    lid = rbox('Lid', 196.6, 64.6, 10.4, 15.6, 10.0, 2.6, M['base'], tile_mm=bmaps[3])
    # 後ろの蝶番（5 つの筒）
    for k in range(5):
        x = -78 + k * 39
        bm = bmesh.new()
        bmesh.ops.create_cone(bm, cap_ends=True, segments=24, radius1=1.9, radius2=1.9, depth=16.0)
        ob = obj_from_bm(f'Hinge_{k}', bm, M['trim'])
        ob.data.transform(Matrix.Rotation(math.pi / 2, 4, 'Y'))
        ob.data.transform(Matrix.Translation((x, 32.6, 16.0)))
    txt = flat_text('Print', '大学ノート', FONT_JA, 11.0, M['trim'])
    place_on(txt, lid, lambda x, y: (x, y + 3.0, 200), (0, 0, -1), 0.05)
    txt2 = flat_text('Print_en', 'DAIGAKU NOTE', None, 4.0, M['trim'])
    place_on(txt2, lid, lambda x, y: (x, y - 9.0, 200), (0, 0, -1), 0.05)
    to_pen_axes()


FAMILIES = {
    'pen-ballpoint': lambda: ballpoint(),
    'pen-ballpoint-wood': lambda: ballpoint(wood=True),
    'marker': lambda: marker(),
    'marker-wide': lambda: marker(wide=True),
    'hider': lambda: marker(hider=True),
    'case-pouch': case_pouch,
    'case-leather': case_leather,
    'case-clear': case_clear,
    'case-tin': case_tin,
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
