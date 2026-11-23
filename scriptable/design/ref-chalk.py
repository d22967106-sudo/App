import random
exec(open('v2.py').read().split('# single icons')[0])
random.seed(11)
icons=[(n,l,(off(bulb,{'Y':'.','W':'.'}) if n=='bulb_off' else off(alarm,{'R':'.','W':'.'}) if n=='alarm_off' else a),b) for n,l,a,b in icons]
CH={'K':(238,238,228),'Y':(250,232,140),'W':None,'R':(245,160,175),'S':(205,210,205),'g':(170,180,175),'L':None,
'D':None,'B':(150,200,245),'b':(150,200,245),'A':(170,215,250),'O':(250,190,130),'N':(215,185,145),'M':(215,185,145),'m':(215,185,145),'C':None,'c':(205,210,205)}
FADE=(140,160,150)
BOARD=(38,66,52)
def jit(c):
    v=random.randint(-12,8);return tuple(max(0,min(255,x+v)) for x in c)
def px(d,x,y,c,s): d.rectangle([x*s,y*s,x*s+s-1,y*s+s-1],fill=c)
def dust(d,x,y,c,s):
    if random.random()<0.35:
        dx,dy=random.choice([(1,0),(-1,0),(0,1),(0,-1),(1,1)])
        m=tuple(int(a*0.3+b*0.7) for a,b in zip(c,BOARD));px(d,x+dx,y+dy,m,s)
def chalk_sprite(d,art,ox,oy,s,faded=False):
    rows=art.strip('\n').split('\n');top=(16-len(rows))//2
    for y,r in enumerate(rows):
        for x,ch in enumerate(r.ljust(16,'.')[:16]):
            if ch=='.' :continue
            c=CH.get(ch)
            if c is None: continue
            if faded: c=FADE
            if random.random()<(0.12 if ch=='K' else 0.05): continue
            px(d,ox+x,oy+y+top,jit(c),s)
def board(d,w,h,s,frame=3):
    for y in range(h):
        for x in range(w):
            edge=min(x,y,w-1-x,h-1-y)
            if (x<2 or x>w-3) and (y<2 or y>h-3) and edge==0: continue
            if edge<frame:
                c=(120,78,45) if (x+y*3)%9 else (100,62,35)
                if edge==0: c=(80,50,28)
            else:
                c=BOARD
                r=random.random()
                if r<0.08: c=(46,78,62)
                elif r<0.1: c=(60,92,76)
            px(d,x,y,c,s)
def chalk_rect(d,x0,y0,w,h,c,s):
    for x in range(x0+1,x0+w-1):
        for y in (y0,y0+h-1):
            if random.random()>0.15: px(d,x,y,jit(c),s)
    for y in range(y0+1,y0+h-1):
        for x in (x0,x0+w-1):
            if random.random()>0.15: px(d,x,y,jit(c),s)
font=ImageFont.truetype('fonts/cy2.ttf',84)
def chalk_text(im,xy,text,col):
    lay=Image.new('RGBA',im.size,(0,0,0,0));ImageDraw.Draw(lay).text(xy,text,font=font,fill=col+(235,),stroke_width=2,stroke_fill=col+(235,))
    ld=ImageDraw.Draw(lay);W_,H_=im.size
    bx,by=xy
    for _ in range(250):
        x=random.randint(bx-5,bx+260);y=random.randint(by,by+90);ld.rectangle([x,y,x+2,y+2],fill=(0,0,0,0))
    im.alpha_composite(lay)
TILE={'bulb_on':(250,232,140),'alarm_on':(250,232,140),'aircon':(150,200,245),'projector':(245,160,175),'note':(238,238,228)}
# widget
s=10;W,H=112,104
im=Image.new('RGBA',(W*s,H*s),(0,0,0,0));d=ImageDraw.Draw(im);board(d,W,H,s)
for i,(n,lab,art,_) in enumerate(icons):
    tx=5+(i%2)*52;ty=5+(i//2)*24;fd=n.endswith('off')
    chalk_rect(d,tx,ty,48,21,FADE if fd else TILE[n],s)
    chalk_sprite(d,art,tx+2,ty+2,s,fd)
for i,(n,lab,art,_) in enumerate(icons):
    tx=5+(i%2)*52;ty=5+(i//2)*24;fd=n.endswith('off')
    chalk_text(im,((tx+20)*s,(ty+4)*s),lab,FADE if fd else (240,240,232))
# chalk eraser + chalk on tray
for x in range(70,80):
    for y in range(H-4,H-2): px(d,x,y,(60,60,70) if y==H-4 else (200,200,190),s)
for x in range(84,88): px(d,x,H-3,(245,245,240),s)
im.save('chalk_widget.png')
bg=Image.open('wallpaper.png').crop((0,600,1179,1900)).convert('RGBA');bg.alpha_composite(im,((1179-W*s)//2,(1300-H*s)//2))
bg.convert('RGB').resize((590,650),Image.LANCZOS).save('chalk_widget_mockup.png')
# icons
sheet=Image.new('RGB',(4*400+40,2*400+40),(30,30,34))
for i,(n,lab,art,_) in enumerate(icons):
    ic=Image.new('RGBA',(360,360),(0,0,0,0));d=ImageDraw.Draw(ic);board(d,20,20,18,frame=2)
    chalk_sprite(d,art,2,2,18,n.endswith('off'));ic.save('chalk_'+n+'.png')
    sheet.paste(ic,(40+(i%4)*400,40+(i//4)*400),ic)
sheet.save('chalk_icons_preview.png')
# ---- 折衷版：背景與按鈕分開輸出 ----
import os
os.makedirs('out/按鈕',exist_ok=True);os.makedirs('out/主畫面圖示',exist_ok=True)
random.seed(11)
bgp=Image.new('RGBA',(W*s,H*s),(0,0,0,0));d=ImageDraw.Draw(bgp);board(d,W,H,s)
for x in range(70,80):
    for y in range(H-4,H-2): px(d,x,y,(60,60,70) if y==H-4 else (200,200,190),s)
for x in range(84,88): px(d,x,H-3,(245,245,240),s)
bgp.save('out/小工具背景.png')
for i,(n,lab,art,_) in enumerate(icons):
    lay=Image.new('RGBA',(50*s,23*s),(0,0,0,0));d=ImageDraw.Draw(lay);fd=n.endswith('off')
    chalk_rect(d,1,1,48,21,FADE if fd else TILE[n],s);chalk_sprite(d,art,3,3,s,fd)
    chalk_text(lay,(21*s,5*s),lab,FADE if fd else (240,240,232))
    lay.save(f'out/按鈕/{i+1}_{lab}.png')
    os.replace('chalk_'+n+'.png',f'out/主畫面圖示/{i+1}_{lab}.png')
