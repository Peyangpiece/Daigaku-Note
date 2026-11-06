import math
NAVY='#22304A'; PAPER='#FBF8F1'; RULE='#C5CFDB'
WEEK=['#F28B82','#FFAB70','#8AB4F8','#7FD1AE','#F6C445']  # 月〜金（src/shared/skin.js TAB_WEEKDAY）
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
def mark(cx,cy,u,tabs=5,rules=4,mono=None,rule=RULE,page=None):
    """ページ＋曜日のタブ。u は 1024 の版での 1 の大きさ。cx,cy は中心（光学的な中心のため少し上）"""
    pw,ph=440*u,560*u; tab_out=84*u
    gx=cx-(pw+tab_out)/2; gy=cy-ph/2
    g=''
    th=(470*u-(tabs-1)*18*u)/tabs; ty=gy+46*u
    cols=WEEK if tabs==5 else [WEEK[0],WEEK[2],WEEK[4]]
    for i in range(tabs):
        c=(mono if not page else cols[i]) if mono else cols[i]
        g+=f'<path fill="{c}" d="{rr(gx+pw-60*u,ty+i*(th+18*u),60*u+tab_out,th,min(24*u,th/2))}"/>'
    page_d=rr(gx,gy,pw,ph,46*u)
    holes=''
    ys=[gy+150*u+i*((ph-260*u)/max(rules-1,1)) for i in range(rules)]
    for i,y in enumerate(ys):
        w=(pw-128*u)*(0.62 if i==rules-1 else 1)
        holes+=rr(gx+64*u,y-12*u,w,24*u,12*u)
    if mono or page:
        g+=f'<path fill="{mono or page}" fill-rule="evenodd" d="{page_d}{holes}"/>'
    else:
        g+=f'<path fill="{PAPER}" d="{page_d}"/><path fill="{rule}" d="{holes}"/>'
    return g
def mac_icon():
    body=f'<path fill="{NAVY}" d="{squircle(100,100,824)}"/>'+mark(512,500,1.08)
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><defs>'
            f'<filter id="s" x="-10%" y="-10%" width="120%" height="125%"><feGaussianBlur in="SourceAlpha" stdDeviation="14"/>'
            f'<feOffset dy="12"/><feComponentTransfer><feFuncA type="linear" slope="0.3"/></feComponentTransfer>'
            f'<feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>'
            f'<g filter="url(#s)"><path fill="{NAVY}" d="{squircle(100,100,824)}"/></g>{mark(512,500,1.08)}</svg>')
def flat_icon():  # 角を丸めない正方形（iOS の apple-touch-icon・OGP。角は OS が丸める）
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><rect width="1024" height="1024" fill="{NAVY}"/>{mark(512,500,1.12)}</svg>'
def symbol_svg(mono=None):  # 背景のないマーク（ロゴと並べる・SVG で使う）
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640">{mark(320,320,1,mono=mono)}</svg>'
def small_icon():  # 小さい表示用（ファビコン・Windows のトレイ）：タブ 3 つ・罫線 2 本、背景いっぱい
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><path fill="{NAVY}" d="{rr(0,0,1024,1024,230)}"/>'
            f'{mark(512,512,1.38,tabs=3,rules=2,rule="#9FAEC0")}</svg>')
def tray_template():  # Mac のメニューバー用（黒と透明だけ）
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640">{mark(320,320,1.02,tabs=3,rules=2,mono="#000")}</svg>'
for n,s in (('icon-mac',mac_icon()),('icon-flat',flat_icon()),('symbol',symbol_svg()),('symbol-black',symbol_svg('#000')),
            ('icon-small',small_icon()),('tray-template',tray_template())):
    open(f'final-{n}.svg','w').write(s)
