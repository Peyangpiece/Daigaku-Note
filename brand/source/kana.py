# カタカナのロゴタイプ（.claude/skills/katakana-logotype に沿って）
import io, cairosvg
from PIL import Image
H=120; SV=20; SH=18.5   # 縦画・横画（横画は約 92 %）
NAVY='#22304A'; ACC='#F0675B'
k=0.76  # 促音の大きさ
def small(x,y): return f"{x*k:.1f} {H-(120-y)*k:.1f}"   # 下端をそろえる
G={
 # (幅, [(path, 太さ)], 追加)
 'パ':(122,[("M38 16C37 58 26 92 3 116",SV),("M64 16C77 54 95 88 120 112",SV)],('ring',117,4,13.5,10)),
 'レ':(102,[("M16 4V92C16 115 31 120 48 109C68 96 86 83 102 68",SV)],None),
 'ッ':(int(106*k),[(f"M{small(6,34)}L{small(22,66)}",SV*0.95),(f"M{small(44,24)}L{small(56,58)}",SV*0.95),
                  (f"M{small(102,26)}C{small(98,76)} {small(70,104)} {small(24,120)}",SV)],None),
 'ト':(86,[("M20 0V120",SV),("M27 44L84 72",SV*0.96)],None),
 'ノ':(98,[("M96 6C89 62 57 102 4 118",SV)],None),
 'ー':(112,[("M0 60H112",SH)],None),
}
def glyph_svg(ch,ink=NAVY,acc=ACC,dx=0):
    th=0.96 if ink.upper() in ('#FFF','#FFFFFF') else 1.0   # 反転した版は細らせる
    w,strokes,extra=G[ch]; out=''
    for d,sw in strokes:
        out+=(f'<path transform="translate({dx:.2f} 0)" d="{d}" fill="none" stroke="{ink}" stroke-width="{sw*th:.2f}" '
              f'stroke-linecap="round" stroke-linejoin="round"/>')
    if extra:
        _,cx,cy,r,sw=extra
        out+=f'<circle cx="{dx+cx:.2f}" cy="{cy}" r="{r}" fill="none" stroke="{acc}" stroke-width="{sw*th:.2f}"/>'
    return out
SC=4; TOP=-30; BOT=150
def profile(ch, with_mark=False):
    w=G[ch][0]; L=-20; R=w+20
    g=glyph_svg(ch,'#000','#000') if with_mark else glyph_svg(ch,'#000','none')
    svg=f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{L} {TOP} {R-L} {BOT-TOP}" width="{(R-L)*SC}" height="{(BOT-TOP)*SC}">{g}</svg>'
    im=Image.open(io.BytesIO(cairosvg.svg2png(bytestring=svg.encode()))).split()[3]
    W,Hh=im.size; px=im.load(); lefts=[];rights=[]
    for y in range(0,Hh,SC):
        xs=[x for x in range(W) if px[x,y]>100]
        lefts.append(xs[0]/SC+L if xs else None); rights.append(xs[-1]/SC+L if xs else None)
    return lefts,rights
DEPTH=0.30*H   # 字の内側の空きを数える深さ（開いた側を数えすぎない）
def sides(ch):
    l,r=profile(ch); rows=range(int(0-TOP),int(H-TOP))
    xl=min(l[i] for i in rows if l[i] is not None); xr=max(r[i] for i in rows if r[i] is not None)
    inL=sum(min(l[i]-xl,DEPTH) if l[i] is not None else DEPTH for i in rows)
    inR=sum(min(xr-r[i],DEPTH) if r[i] is not None else DEPTH for i in rows)
    return xl,xr,inL,inR,len(rows)
def layout(text,target):
    S={ch:sides(ch) for ch in set(text)}
    xs=[0]
    for a,b in zip(text,text[1:]):
        _,ar,_,inR,n=S[a]; bl,_,inL,_,_=S[b]
        rsb=max(target-inR/n,2); lsb=max(target-inL/n,2)   # 1 行あたりの空き（側ごと）を target にそろえる
        xs.append(xs[-1]+ar+rsb+lsb-bl)
    return xs
def wordmark(text='パレットノート',target=None,ink=NAVY,acc=ACC):
    xs=layout(text,target)
    body=''.join(glyph_svg(ch,ink,acc,x) for ch,x in zip(text,xs))
    w=xs[-1]+G[text[-1]][0]; p=SV/2+2
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{-p} {-22} {w+2*p} {H+22+p}">{body}</svg>', xs
if __name__=='__main__':
    import sys
    # 縦画どうし（トの縦画を 2 本並べた）の空き 34 を基準の面積にする
    for t,name in ((22,'kana-v3a'),(26,'kana-v3b'),(30,'kana-v3c')):
        s,xs=wordmark(target=t); open(name+'.svg','w').write(s); print(name,[round(x,1) for x in xs])
