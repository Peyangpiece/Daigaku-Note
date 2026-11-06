# 既存のフォント（SIL OFL）の字形でカタカナのロゴを組む：字ごとの輪郭を取り出し、空きの面積で字間をそろえ、半濁点の輪を色分けする
import io, cairosvg
from PIL import Image
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.recordingPen import RecordingPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.boundsPen import BoundsPen
NAVY='#22304A'; ACC='#F0675B'; H=120
def contours(gs,name):
    rp=RecordingPen(); gs[name].draw(rp); cs=[]; cur=[]
    for op,args in rp.value:
        cur.append((op,args))
        if op in ('closePath','endPath'): cs.append(cur); cur=[]
    return cs
def cpath(c,sc,dx,dy):
    pen=SVGPathPen(None); tp=TransformPen(pen,(sc,0,0,-sc,dx,dy))
    for op,args in c: getattr(tp,op)(*args)
    return pen.getCommands()
def cbounds(c):
    bp=BoundsPen(None)
    for op,args in c: getattr(bp,op)(*args)
    return bp.bounds
class Kana:
    def __init__(s,path):
        s.tt=TTFont(path); s.gs=s.tt.getGlyphSet(); s.cmap=s.tt.getBestCmap()
        b=s.bounds('ト'); s.sc=H/(b[3]-b[1]); s.base=b[1]   # トの字面の高さを 120 にそろえる
    def bounds(s,ch):
        bp=BoundsPen(s.gs); s.gs[s.cmap[ord(ch)]].draw(bp); return bp.bounds
    bold=0; ringbold=0
    def glyph(s,ch,dx,ink,acc):
        name=s.cmap[ord(ch)]; cs=contours(s.gs,name); b=s.bounds(ch); out=[]
        # 半濁点：右上にある小さい輪（輪郭 2 つ）
        mark=[]
        if ch=='パ':
            for c in cs:
                cb=cbounds(c)
                if cb and cb[0]>b[0]+(b[2]-b[0])*0.6 and cb[1]>b[1]+(b[3]-b[1])*0.55: mark.append(c)
        body=[c for c in cs if c not in mark]
        ox=dx-b[0]*s.sc; oy=H+s.base*s.sc
        st=lambda col,b: (f' stroke="{col}" stroke-width="{b}" stroke-linejoin="round"' if b else '')
        out.append(f'<path fill="{ink}"{st(ink,s.bold)} d="{"".join(cpath(c,s.sc,ox,oy) for c in body)}"/>')
        if mark: out.append(f'<path fill="{acc}" fill-rule="nonzero"{st(acc,s.ringbold)} d="{"".join(cpath(c,s.sc,ox,oy) for c in mark)}"/>')
        return ''.join(out), (b[2]-b[0])*s.sc
    def profile(s,ch):
        g,w=s.glyph(ch,0,'#000','#000'); L,R,T,B=-10,w+10,-40,H+20; SC=4
        svg=f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{L} {T} {R-L} {B-T}" width="{int((R-L)*SC)}" height="{(B-T)*SC}">{g}</svg>'
        im=Image.open(io.BytesIO(cairosvg.svg2png(bytestring=svg.encode()))).split()[3]; px=im.load(); W,Hh=im.size
        rows=range(int(-T)*SC, int(H-T)*SC, SC); l=[];r=[]
        for y in rows:
            xs=[x for x in range(W) if px[x,y]>100]
            l.append(xs[0]/SC+L if xs else None); r.append(xs[-1]/SC+L if xs else None)
        return l,r,w
    def layout(s,text,target,depth=0.3*H):
        P={c:s.profile(c) for c in set(text)}; xs=[0]
        def side(l,r,w):
            xl=min(v for v in l if v is not None); xr=max(v for v in r if v is not None)
            inL=sum(min(v-xl,depth) if v is not None else depth for v in l)/len(l)
            inR=sum(min(xr-v,depth) if v is not None else depth for v in r)/len(r)
            return xl,xr,inL,inR
        for a,b in zip(text,text[1:]):
            _,ar,_,iR=side(*P[a]); bl,_,iL,_=side(*P[b])
            xs.append(xs[-1]+ar+max(target-iR,2)+max(target-iL,2)-bl)
        return xs
    def wordmark(s,text='パレットノート',target=24,ink=NAVY,acc=ACC):
        xs=s.layout(text,target); body=''; w=0
        for ch,x in zip(text,xs):
            g,gw=s.glyph(ch,x,ink,acc); body+=g; w=x+gw
        return body,w
