import icon as FI
import kana as K
KT=26
import kanafont as KFm
KF=KFm.Kana("KiwiMaru-Medium.ttf"); KF.bold=2; KF.ringbold=1
HL_Y,HL_H=104,26   # 蛍光ペン：字の下の端にかかる低い位置（字面の高さ 120 に対して）
WEEK=['#F28B82','#FFAB70','#8AB4F8','#7FD1AE','#F6C445']   # ブランドの 5 色（月〜金。アイコンのタブ）
def mix(c,t,a):  # c を t に a の割合で寄せる
    c=[int(c[i:i+2],16) for i in (1,3,5)]; t=[int(t[i:i+2],16) for i in (1,3,5)]
    return '#'+''.join(f'{round(x+(y-x)*a):02X}' for x,y in zip(c,t))
KE=KFm.Kana("ZenMaruGothic-Medium.ttf"); KE.bold=0; KE.ringbold=0; KE.accent_o=True; KE.sc*=0.9
P_SW,P_TOP,P_BASE,P_W=12.4,20.4,116.97,71.9   # Zen Maru Gothic の P の線の太さ・上端・ベースライン・幅（0.9 倍のとき）
def round_P(dx,ink):
    # P のふくらみを大きな円に近くした形（上の線はまっすぐ、ふくらみは字の高さの約 6 割）
    x=dx+P_SW/2; y1=P_TOP+P_SW/2; yb=P_BASE-P_SW/2; bot=P_TOP+60-P_SW/2; r=(bot-y1)/2; cx=dx+P_W-P_SW/2-r
    d=f"M{x:.2f} {yb:.2f}V{y1:.2f}H{cx:.2f}A{r:.2f} {r:.2f} 0 0 1 {cx:.2f} {bot:.2f}H{x:.2f}"
    return f'<path d="{d}" fill="none" stroke="{ink}" stroke-width="{P_SW}" stroke-linecap="round" stroke-linejoin="round"/>'
def en_body(ink,acc=None):
    acc=acc or ACC
    xs=KE.layout('Palette Note',20,space=46); body='';w=0; dy=120-(120+KE.base*KE.sc)   # ベースラインを字面の下端 120 にそろえる（カタカナと同じ高さ）
    for ch,x in zip('Palette Note',xs):
        if ch==' ' or x is None: continue
        if ch=='P': body+=round_P(x,ink); w=x+P_W; continue
        g,gw=KE.glyph(ch,x,ink,acc,accent_o=True); body+=g; w=x+gw
    return band(ink,w)+f'<g transform="translate(0 {dy:.1f})">{body}</g>',w
def band(ink,w):
    if ink=='#000': return ''
    cols=[mix(c,'#FFFFFF',0.35) for c in WEEK] if ink!=WHITE else [mix(c,NAVY,0.45) for c in WEEK]
    x0,x1=-8,w+8; n=5; seg=(x1-x0)/n; r=HL_H/2
    pre=f'<rect x="{x0:.1f}" y="{HL_Y}" width="{seg+r:.1f}" height="{HL_H}" rx="{r}" fill="{cols[0]}"/>'
    pre+=f'<rect x="{x1-seg-r:.1f}" y="{HL_Y}" width="{seg+r:.1f}" height="{HL_H}" rx="{r}" fill="{cols[4]}"/>'
    for i in range(1,4):
        pre+=f'<rect x="{x0+i*seg:.1f}" y="{HL_Y}" width="{seg:.1f}" height="{HL_H}" fill="{cols[i]}"/>'
    return pre
def kana_body(ink,acc=None):
    acc=acc or ACC
    body,w=KF.wordmark(target=22,ink=ink,acc=acc)
    if ink=='#000': return body,w                       # 黒 1 色：蛍光ペンなし
    cols=[mix(c,'#FFFFFF',0.35) for c in WEEK] if ink!=WHITE else [mix(c,NAVY,0.45) for c in WEEK]
    x0,x1=-8,w+8; n=5; seg=(x1-x0)/n; r=HL_H/2
    pre=f'<rect x="{x0:.1f}" y="{HL_Y}" width="{seg+r:.1f}" height="{HL_H}" rx="{r}" fill="{cols[0]}"/>'
    pre+=f'<rect x="{x1-seg-r:.1f}" y="{HL_Y}" width="{seg+r:.1f}" height="{HL_H}" rx="{r}" fill="{cols[4]}"/>'
    for i in range(1,4):
        pre+=f'<rect x="{x0+i*seg:.1f}" y="{HL_Y}" width="{seg:.1f}" height="{HL_H}" fill="{cols[i]}"/>'
    return pre+body,w
S=20; H=120
NAVY='#22304A'; ACC='#F0675B'; WHITE='#FFFFFF'
def en():
    r=36; R=61
    return {'P':(72,[f"M0 {H}V0H34A{r} {r} 0 0 1 34 {2*r}H0"]),
            'A':(92,[f"M0 {H}L46 -3L92 {H}","M19 82H73"]),
            'L':(62,[f"M0 0V{H}H62"]),
            'E':(62,[f"M62 0H0V{H}H62","M0 60H54"]),
            'T':(70,[f"M0 0H70",f"M35 0V{H}"]),
            'N':(84,[f"M0 {H}V0L84 {H}V0"]),
            'O':(2*R,[f"M0 60A{R} {R} 0 1 0 {2*R} 60A{R} {R} 0 1 0 0 60"],'acc')}
KERN_EN={'PA':-8,'AL':-2,'LE':-4,'TT':6,'TE':-4,'ET':-2,'NO':-2,'OT':-6}
def ja():
    k=0.74; oy=H*(1-k)
    def t(x,y): return f"{x*k:.1f} {oy+y*k:.1f}"
    return {'パ':(122,["M34 22C32 62 22 94 2 118","M66 22C78 58 96 90 120 114"],('ring',113,8,14)),
            'レ':(104,["M16 4V96C16 116 30 120 46 110L104 66"]),
            'ッ':(int(104*k),[f"M{t(4,26)}L{t(20,62)}",f"M{t(42,18)}L{t(54,52)}",f"M{t(100,20)}C{t(96,74)} {t(66,104)} {t(22,120)}"]),
            'ト':(84,["M20 0V120","M24 48L84 76"]),
            'ノ':(100,["M98 6C90 64 58 102 4 120"]),
            'ー':(116,["M2 62H114"])}
KERN_JA={'パレ':2,'レッ':-6,'ット':0,'トノ':-8,'ノー':4,'ート':4}
def build(text,gl,track,kern,ink,acc,accent=True):
    x=0; body=''; prev=None
    for ch in text:
        if ch==' ': x+=40; prev=None; continue
        if prev: x+=kern.get(prev+ch,0)
        spec=gl[ch]; w,ds=spec[0],spec[1]; extra=spec[2] if len(spec)>2 else None
        col=acc if (accent and extra=='acc') else ink
        for d in ds:
            sw=S*0.96 if ink==WHITE else S
            body+=(f'<path transform="translate({x} 0)" d="{d}" fill="none" stroke="{col}" stroke-width="{sw}" '
                   f'stroke-linecap="round" stroke-linejoin="round"/>')
        if isinstance(extra,tuple):
            _,cx,cy,rr=extra
            body+=(f'<circle cx="{x+cx}" cy="{cy}" r="{rr}" fill="none" stroke="{acc if accent else ink}" stroke-width="11"/>')
        x+=w+track; prev=ch
    return x-track, body
def wordmark(text,gl,track,kern,ink=NAVY,acc=ACC,accent=True):
    w,body=build(text,gl,track,kern,ink,acc,accent)
    p=S/2+2
    top=-p-14 if 'パ' in text else -p-4
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{-p} {top} {w+2*p} {H+2*p-top-p}">{body}</svg>', (w,top,p)
def lockup(text,gl,track,kern,dark=False):
    ink=WHITE if dark else NAVY
    if gl=='en':
        body,w=en_body(ink)
    elif gl is None:
        body,w=kana_body(ink)
    else:
        w,body=build(text,gl,track,kern,ink,ACC)
    # 記号：明るい背景では紙を紺に（罫線は抜き）、暗い背景では紙の色
    sym_h=176; u=sym_h/560
    sym=FI.mark(0,0,u) if dark else FI.mark(0,0,u,page=NAVY)
    sw=(440+84)*u; gap=40 if gl in (None,'en') else 56
    g=f'<g transform="translate({sw/2} {H/2})">{sym}</g><g transform="translate({sw+gap} 0)">{body}</g>'
    p=S/2+(28 if dark else 4); top=-(sym_h-H)/2-(28 if dark else 4)
    total=sw+gap+w
    bg=f'<rect x="{-p-40}" y="{top-40}" width="{total+2*p+80}" height="{sym_h+88}" fill="{NAVY}"/>' if dark else ''
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{-p} {top} {total+2*p} {sym_h+(56 if dark else 8)}">{bg}{g}</svg>'
def stacked(text,gl,track,kern):
    if gl=='en':
        body,w=en_body(NAVY)
    elif gl is None:
        body,w=kana_body(NAVY)
    else:
        w,body=build(text,gl,track,kern,NAVY,ACC)
    sym_h=300; u=sym_h/560; sw=(440+84)*u
    gap=70
    g=f'<g transform="translate({w/2} {sym_h/2})">{FI.mark(0,0,u,page=NAVY)}</g><g transform="translate(0 {sym_h+gap})">{body}</g>'
    p=24
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{-p} {-p} {w+2*p} {sym_h+gap+H+2*p}">{g}</svg>'
J,E=ja(),en()
def en_mark(ink=NAVY,acc=ACC):
    body,w=en_body(ink,acc); p=8
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{-p-6} -32 {w+2*p+12} 176">{body}</svg>'
def kana_mark(ink=NAVY,acc=ACC):
    body,w=kana_body(ink,acc); p=8
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{-p-6} -32 {w+2*p+12} 176">{body}</svg>'
out={'logo-ja':kana_mark(),
     'logo-en':en_mark(),
     'logo-ja-white':kana_mark(ink=WHITE),
     'logo-en-white':en_mark(ink=WHITE),
     'logo-ja-black':kana_mark(ink='#000',acc='#000'),
     'logo-en-black':en_mark(ink='#000',acc='#000'),
     'lockup-ja':lockup('パレットノート',None,0,None),
     'lockup-ja-stacked':stacked('パレットノート',None,0,None),
     'lockup-en-stacked':stacked('Palette Note','en',0,None),
     'lockup-en':lockup('Palette Note','en',0,None),
     'lockup-ja-dark':lockup('パレットノート',None,0,None,dark=True),
     'lockup-en-dark':lockup('Palette Note','en',0,None,dark=True)}
TITLE={'ja':'パレットノート','en':'PALETTE NOTE'}
for k,v in out.items():
    t=TITLE['ja' if '-ja' in k else 'en']
    v=v.replace('">','"><title>'+t+'</title>',1)
    open(f'stroke-{k}.svg','w').write(v)
