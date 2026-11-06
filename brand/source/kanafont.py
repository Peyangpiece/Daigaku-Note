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
    bold=0; ringbold=0; style=None
    WEEK=['#F28B82','#FFAB70','#8AB4F8','#7FD1AE','#F6C445']
    def glyph(s,ch,dx,ink,acc,accent_o=False):
        name=s.cmap[ord(ch)]; cs=contours(s.gs,name); b=s.bounds(ch); out=[]
        # 半濁点：右上にある小さい輪（輪郭 2 つ）
        mark=[]
        if ch=='パ':
            for c in cs:
                cb=cbounds(c)
                if cb and cb[0]>b[0]+(b[2]-b[0])*0.6 and cb[1]>b[1]+(b[3]-b[1])*0.55: mark.append(c)
        if accent_o and ch=='o': mark=cs
        body=[c for c in cs if c not in mark]
        ox=dx-b[0]*s.sc; oy=H+s.base*s.sc
        extra=''
        if s.style=='bar' and ch=='ー':
            # 長音を曜日の 5 色に分ける（パレット・アイコンのタブ）
            x0,y0,x1,y1=b; X0=ox+x0*s.sc; X1=ox+x1*s.sc; Yc=oy-(y0+y1)/2*s.sc; t=(y1-y0)*s.sc+s.bold
            n=5; gap=3.0; seg=(X1-X0-gap*(n-1))/n
            segs=''.join(f'<rect x="{X0+i*(seg+gap)-s.bold/2:.2f}" y="{Yc-t/2:.2f}" width="{seg+s.bold:.2f}" height="{t:.2f}" rx="{t/2:.2f}" fill="{s.WEEK[i]}"/>' for i in range(n))
            return segs,(b[2]-b[0])*s.sc
        if s.style=='tsu' and ch=='ッ':
            # 促音の 2 つの点を、絵の具をのせたように色にする
            small=sorted([c for c in body if cbounds(c)],key=lambda c:(cbounds(c)[2]-cbounds(c)[0])*(cbounds(c)[3]-cbounds(c)[1]))[:2]
            small=sorted(small,key=lambda c:cbounds(c)[0])
            cols=['#8AB4F8','#F6C445']
            for c,col in zip(small,cols):
                extra+=f'<path fill="{col}" stroke="{col}" stroke-width="{s.bold}" stroke-linejoin="round" d="{cpath(c,s.sc,ox,oy)}"/>'
            body=[c for c in body if c not in small]
        st=lambda col,b: (f' stroke="{col}" stroke-width="{b}" stroke-linejoin="round"' if b else '')
        out.append(f'<path fill="{ink}"{st(ink,s.bold)} d="{"".join(cpath(c,s.sc,ox,oy) for c in body)}"/>')
        if mark: out.append(f'<path fill="{acc}" fill-rule="nonzero"{st(acc,s.ringbold)} d="{"".join(cpath(c,s.sc,ox,oy) for c in mark)}"/>')
        out.append(extra)
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
    def layout(s,text,target,depth=0.3*H,space=34):
        if ' ' in text:
            out=[]; base=0
            for k,part in enumerate(text.split(' ')):
                xs=s.layout(part,target,depth); out+= [base+x for x in xs]
                if k < len(text.split(' '))-1:
                    out.append(None)
                    last=part[-1]; b=s.bounds(last); base=base+xs[-1]+(b[2]-b[0])*s.sc+space
            return out
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
            if ch==' ' or x is None: continue
            g,gw=s.glyph(ch,x,ink,acc,accent_o=getattr(s,'accent_o',False)); body+=g; w=x+gw
        return body,w
