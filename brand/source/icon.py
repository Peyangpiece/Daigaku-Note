import math
NAVY='#22304A'; PAPER='#FBF8F1'; RULE='#C5CFDB'
WEEK=['#F28B82','#FFAB70','#8AB4F8','#7FD1AE','#F6C445']  # 月〜金（src/shared/skin.js TAB_WEEKDAY）
def mix(c,t,a):  # c を t に a の割合で寄せる
    c=[int(c[i:i+2],16) for i in (1,3,5)]; t=[int(t[i:i+2],16) for i in (1,3,5)]
    return '#'+''.join(f'{round(x+(y-x)*a):02X}' for x,y in zip(c,t))
def rr(x,y,w,h,r):
    return (f"M{x+r:g} {y:g}H{x+w-r:g}A{r:g} {r:g} 0 0 1 {x+w:g} {y+r:g}V{y+h-r:g}A{r:g} {r:g} 0 0 1 {x+w-r:g} {y+h:g}"
            f"H{x+r:g}A{r:g} {r:g} 0 0 1 {x:g} {y+h-r:g}V{y+r:g}A{r:g} {r:g} 0 0 1 {x+r:g} {y:g}Z")
def squircle(x,y,s,n=5.0,steps=180):
    c=s/2; pts=[]
    for i in range(steps):
        t=2*math.pi*i/steps; ct,st=math.cos(t),math.sin(t)
        px=abs(ct)**(2/n)*math.copysign(1,ct); py=abs(st)**(2/n)*math.copysign(1,st)
        pts.append(f"{x+c+c*px:.1f} {y+c+c*py:.1f}")
    return "M"+"L".join(pts)+"Z"
def band(x,y,w,h,cols,slant=0.55):
    """蛍光ペン：本物のマーカーで引いた線のように、両端を斜めに切った帯（右上がりの斜め。傾きは高さの slant 倍）。
    色は左から順に並べる（月〜金）。ロゴとアイコンで同じ形を使う"""
    n=len(cols); s=h*slant; seg=w/n; out=''
    for i,c in enumerate(cols):
        a=x+i*seg; b=x+(i+1)*seg+(0.6 if i<n-1 else 0)
        if i==0 and n==1:
            pts=[(a+s,y),(b,y),(b-s,y+h),(a,y+h)]
        elif i==0:
            pts=[(a+s,y),(b,y),(b,y+h),(a,y+h)]
        elif i==n-1:
            pts=[(a,y),(b,y),(b-s,y+h),(a,y+h)]
        else:
            pts=[(a,y),(b,y),(b,y+h),(a,y+h)]
        out+=f'<path fill="{c}" d="M'+' L'.join(f'{px:.1f} {py:.1f}' for px,py in pts)+' Z"/>'
    return out
def band_hole(x,y,w,h,slant=0.55):  # 1 色の版で抜く形
    s=h*slant
    return f'M{x+s:.1f} {y:.1f}L{x+w:.1f} {y:.1f}L{x+w-s:.1f} {y+h:.1f}L{x:.1f} {y+h:.1f}Z'
def mark(cx,cy,u,small=False,mono=None,page=None,rule=RULE):
    """ページ＋曜日のタブ。行は灰色の罫線（4 本。最後の 1 本は短い）。
    u は 1024 の版での 1 の大きさ。small は小さい表示用（タブ 3 つを大きく、罫線 2 本）。
    mono は 1 色（黒など。罫線は抜き）、page はページを塗る色（明るい地のロゴ用：紺のページに白い罫線）"""
    pw,ph=440*u,560*u
    tabs=3 if small else 5; tab_out=(132 if small else 84)*u; gap=(26 if small else 18)*u
    gx=cx-(pw+tab_out)/2; gy=cy-ph/2
    th=(470*u-(tabs-1)*gap)/tabs; ty=gy+46*u
    cols=WEEK if tabs==5 else [WEEK[0],WEEK[2],WEEK[4]]
    g=''
    for i in range(tabs):
        c=mono if (mono and not page) else cols[i]
        g+=f'<path fill="{c}" d="{rr(gx+pw-60*u,ty+i*(th+gap),60*u+tab_out,th,min(24*u,th/2))}"/>'
    page_d=rr(gx,gy,pw,ph,46*u)
    n=2 if small else 4; rh=(36 if small else 24)*u
    ys=[gy+150*u+i*((ph-260*u)/(n-1)) for i in range(n)] if not small else [gy+ph*0.38,gy+ph*0.62]
    holes=''
    for i,y in enumerate(ys):
        w=(pw-128*u)*(0.62 if i==n-1 else 1)
        holes+=rr(gx+64*u,y-rh/2,w,rh,rh/2)
    if mono or page:
        g+=f'<path fill="{mono or page}" fill-rule="evenodd" d="{page_d}{holes}"/>'
    else:
        g+=f'<path fill="{PAPER}" d="{page_d}"/><path fill="{"#9FAEC0" if small else rule}" d="{holes}"/>'
    return g
def shadow_defs():
    return (f'<defs><filter id="s" x="-10%" y="-10%" width="120%" height="125%"><feGaussianBlur in="SourceAlpha" stdDeviation="14"/>'
            f'<feOffset dy="12"/><feComponentTransfer><feFuncA type="linear" slope="0.3"/></feComponentTransfer>'
            f'<feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>')
def mac_icon():  # Mac の格子：1024 の中に 824 の角丸、影つき
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">{shadow_defs()}'
            f'<g filter="url(#s)"><path fill="{NAVY}" d="{squircle(100,100,824)}"/></g>{mark(512,500,1.08)}</svg>')
def win_icon():  # Windows 用：余白と影なし。角丸の正方形をほぼいっぱいに
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><path fill="{NAVY}" d="{rr(24,24,976,976,200)}"/>'
            f'{mark(512,506,1.3)}</svg>')
def flat_icon():  # 角を丸めない正方形（iPhone のホーム画面。角は OS が丸める）
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><rect width="1024" height="1024" fill="{NAVY}"/>{mark(512,500,1.12)}</svg>'
def symbol_svg(mono=None):  # 背景のないマーク（紙のページ）
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640">{mark(320,320,1,mono=mono)}</svg>'
def small_icon():  # 小さい表示用（16〜48 px：ファビコン・Windows の小さいアイコン・トレイ）
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><path fill="{NAVY}" d="{rr(0,0,1024,1024,230)}"/>'
            f'{mark(512,512,1.32,small=True)}</svg>')
def tray_template():  # Mac のメニューバー用（黒と透明だけ）
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640">{mark(320,320,1.0,small=True,mono="#000")}</svg>'
if __name__=='__main__':
    for n,s in (('icon-mac',mac_icon()),('icon-win',win_icon()),('icon-flat',flat_icon()),('symbol',symbol_svg()),
                ('symbol-black',symbol_svg('#000')),('icon-small',small_icon()),('tray-template',tray_template())):
        open(f'final-{n}.svg','w').write(s)
