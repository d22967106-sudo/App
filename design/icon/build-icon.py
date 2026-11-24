"""主畫面圖示 v2：原本的地球（陸地、海岸線、小島）上藍綠色＋加入台灣＋筆、大頭針、錢袋"""
import math, sys
import numpy as np
from PIL import Image, ImageDraw
sys.path.insert(0, '.')
from bag5 import P as BAG_P, SPRITE as BAG

N = 72
BROWN, CREAM = (160, 97, 43), (255, 251, 245)
OCEAN, LAND, COAST = (96, 166, 214), (126, 186, 100), (48, 98, 78)
g = np.load('grid.npy')            # 原圖自動像素化（True＝米白）
cl = np.load('cream-labels.npy')   # 米白區塊編號
yy, xx = np.mgrid[0:N, 0:N] + 0.5
globe = (xx - 36) ** 2 + (yy - 39) ** 2 <= 24.6 ** 2

img = np.where(g[..., None], np.array(CREAM), np.array(BROWN)).astype(np.int32)
# 背景：地球外的棕色加稀疏深淺像素
rng = np.random.default_rng(7)
r = rng.random((N, N))
outside = ~globe
# ── 背景：像素宇宙（上淺下深的深藍紫、淡淡的星雲、星星）──
top_c, bot_c = np.array((14, 12, 30)), np.array((4, 4, 12))
for y in range(N):
    img[y, :] = np.where(globe[y, :, None], img[y, :], (top_c + (bot_c - top_c) * y / (N - 1)).astype(np.int32))
# 星雲：低頻雜訊，兩種顏色
noise = np.array(Image.fromarray((rng.random((9, 9)) * 255).astype(np.uint8)).resize((N, N), Image.BICUBIC), dtype=np.float32) / 255
noise2 = np.array(Image.fromarray((rng.random((7, 7)) * 255).astype(np.uint8)).resize((N, N), Image.BICUBIC), dtype=np.float32) / 255
img[~globe & (noise > 0.72)] = (28, 20, 52)
img[~globe & (noise > 0.84)] = (40, 28, 70)
img[~globe & (noise2 > 0.78) & (noise <= 0.72)] = (14, 26, 56)
# 星星：一格的小星星（亮度不同）
st = rng.random((N, N))
img[~globe & (st < 0.012)] = (255, 255, 255)
img[~globe & (st >= 0.012) & (st < 0.026)] = (170, 180, 230)
img[~globe & (st >= 0.026) & (st < 0.032)] = (255, 226, 150)
# 閃亮的十字星
for (sy, sx) in [(6, 34), (9, 63), (32, 4), (52, 66), (66, 10), (64, 50), (4, 6)]:
    if not globe[sy, sx]:
        img[sy, sx] = (255, 255, 255)
        for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0)):
            yy_, xx_ = sy + dy, sx + dx
            if 0 <= yy_ < N and 0 <= xx_ < N and not globe[yy_, xx_]:
                img[yy_, xx_] = (150, 190, 255)
# 地球裡面：先分陸地／海（海岸線和小島的框都算陸地，陸塊才會是實心的）
OCEAN_ID = 4
LAND_IDS = {0, 11}
ISLAND_IDS = {5, 6, 7, 8, 9, 10, 13, 14}
land = np.zeros((N, N), bool)
for y in range(N):
    for x in range(N):
        if not globe[y, x]:
            continue
        if g[y, x]:
            k = cl[y, x]
            land[y, x] = (k == OCEAN_ID and y >= 52 and x <= 31) or k in LAND_IDS or k in ISLAND_IDS
        else:
            land[y, x] = True
# 原本錢袋的位置當海
for y in range(41, 61):
    for x in range(28, 45):
        if globe[y, x] and (y < 52 or x > 31):
            land[y, x] = False
tw = np.zeros((N, N), bool)  # 使用者決定不放台灣

# ── 上色：光從左上來（像參考圖），海、陸地各三種深淺，外圍深藍框，左上一點反光 ──
OCEAN3 = [(118, 186, 238), (56, 130, 208), (34, 88, 172)]
LAND3 = [(156, 212, 92), (96, 178, 74), (48, 128, 62)]
rr = np.sqrt((xx - 36) ** 2 + (yy - 39) ** 2)
lit = ((xx - 36) + (yy - 39)) / 24.6
for y in range(N):
    for x in range(N):
        if not globe[y, x]:
            continue
        L3 = LAND3 if land[y, x] else OCEAN3
        k = 0 if lit[y, x] < -0.55 else 2 if (lit[y, x] > 0.55 or rr[y, x] > 23.2) else 1
        img[y, x] = L3[k]
# 外框
ring = np.zeros_like(globe)
for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0)):
    ring |= np.roll(np.roll(globe, dy, 0), dx, 1)
img[ring & ~globe] = (22, 40, 82)
# 大氣層的光暈（外框再外面一圈淡藍）
ring2 = np.zeros_like(globe)
g2 = globe | ring
for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0)):
    ring2 |= np.roll(np.roll(g2, dy, 0), dx, 1)
img[ring2 & ~g2] = (60, 110, 190)
# 反光
for (y, x) in [(22, 25), (22, 26), (23, 24), (21, 27)]:
    if globe[y, x] and not land[y, x]:
        img[y, x] = (236, 246, 255)


def paste(rows, pal, ox, oy):
    for j, row in enumerate(rows):
        for i, ch in enumerate(row):
            if ch != '.':
                img[oy + j, ox + i] = pal[ch]


# ── 鉛筆（常見配色：粉紅橡皮擦、灰色金屬環、黃色筆身、木頭筆尖、黑筆芯，深色外框）──
def pencil(ox, oy, L=13):
    cells = {}
    for i in range(L):
        kind = 'E' if i < 3 else 'M' if i == 3 else 'Y' if i < 9 else 'W' if i < 11 else 'T'
        width = (-1, 0, 1) if i < 10 else (0, 1) if i < 12 else (1,)
        for a in width:
            y, x = oy + i + max(a, 0), ox + i + max(-a, 0)
            if kind == 'E' and i == 0 and a != 0:
                continue
            # 三條：右上亮、中間、左下暗
            shade = {-1: 'h', 0: 'm', 1: 'd'}[a] if kind in 'YEM' else ''
            cells[(y, x)] = kind + shade
    return cells


P_PAL = {
    'Eh': (250, 170, 185), 'Em': (236, 128, 150), 'Ed': (196, 92, 116),
    'Mh': (214, 214, 222), 'Mm': (168, 168, 180), 'Md': (120, 120, 134),
    'Yh': (255, 232, 120), 'Ym': (250, 196, 52), 'Yd': (214, 150, 30),
    'W': (236, 200, 150), 'T': (48, 40, 40),
}
pc = pencil(11, 13)
m = np.zeros((N, N), bool)
for (y, x) in pc:
    m[y, x] = True
rg = np.zeros_like(m)
for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0)):
    rg |= np.roll(np.roll(m, dy, 0), dx, 1)
img[rg & ~m] = (44, 32, 30)
for (y, x), c in pc.items():
    img[y, x] = P_PAL[c]

# ── 大頭針（右上，原本的位置）──
# ── 紅色大頭針：斜插進地球（頭在右上、針尖往左下插進地球）──
def slanted_pin(ox, oy):
    """水滴形＝圓頭＋往左下收尖，先在高解析度畫好再取格子"""
    SSP = 12
    W, H = 12, 12
    hcx, hcy, hr = 7.8, 3.9, 3.4   # 圓頭
    tip = (1.2, 11.0)              # 針尖
    im = Image.new('L', (W * SSP, H * SSP), 0)
    dd = ImageDraw.Draw(im)
    dd.ellipse([(hcx - hr) * SSP, (hcy - hr) * SSP, (hcx + hr) * SSP, (hcy + hr) * SSP], fill=255)
    # 從針尖到圓的兩條切線
    vx, vy = hcx - tip[0], hcy - tip[1]
    dist = math.hypot(vx, vy)
    ang = math.atan2(vy, vx)
    off = math.asin(hr / dist)
    tl = math.sqrt(dist * dist - hr * hr)
    p1 = (tip[0] + tl * math.cos(ang + off), tip[1] + tl * math.sin(ang + off))
    p2 = (tip[0] + tl * math.cos(ang - off), tip[1] + tl * math.sin(ang - off))
    dd.polygon([(tip[0] * SSP, tip[1] * SSP), (p1[0] * SSP, p1[1] * SSP), (p2[0] * SSP, p2[1] * SSP)], fill=255)
    cov = np.array(im.resize((W, H), Image.BOX)) / 255
    cells = {}
    for j in range(H):
        for i in range(W):
            if cov[j, i] < 0.5:
                continue
            cx_, cy_ = i + 0.5, j + 0.5
            if math.hypot(cx_ - hcx, cy_ - hcy) < 1.55:
                c = 'w'
            else:
                lit = (cx_ - hcx) + (cy_ - hcy) * 0.6
                c = 'h' if lit < -1.6 else 'D' if lit > 1.4 else 'R'
            cells[(oy + j, ox + i)] = c
    return cells


# 大頭針：跟直立的那一版同一個形狀（圓頭、針尖在圓心下方約 1.4 個半徑、中間圓洞），整個轉 45 度，
# 針尖在 (48, 26)，跟鉛筆尖 (23, 26) 左右對稱
def map_pin(tip, angle_deg, r=4.3, tip_k=1.42, hole=1.65):
    a = math.radians(angle_deg)          # 從針尖指向圓心的方向
    ux, uy = math.cos(a), -math.sin(a)
    cx_, cy_ = tip[0] + ux * r * tip_k, tip[1] + uy * r * tip_k
    SSP = 16
    im = Image.new('L', (N * SSP, N * SSP), 0)
    dd = ImageDraw.Draw(im)
    dd.ellipse([(cx_ - r) * SSP, (cy_ - r) * SSP, (cx_ + r) * SSP, (cy_ + r) * SSP], fill=255)
    dist = r * tip_k
    off = math.asin(r / dist)
    tl = math.sqrt(dist * dist - r * r)
    ang = math.atan2(cy_ - tip[1], cx_ - tip[0])
    p1 = (tip[0] + tl * math.cos(ang + off), tip[1] + tl * math.sin(ang + off))
    p2 = (tip[0] + tl * math.cos(ang - off), tip[1] + tl * math.sin(ang - off))
    dd.polygon([(tip[0] * SSP, tip[1] * SSP), (p1[0] * SSP, p1[1] * SSP), (p2[0] * SSP, p2[1] * SSP)], fill=255)
    cov = np.array(im.resize((N, N), Image.BOX)) / 255
    shape = cov >= 0.5
    # 斜 45 度時針尖太細會被格子吃掉：沿著針尖到圓心那條線，把針尖補回來（一格寬，像直立版最後那一格）
    for k in range(0, int(r * tip_k * 4)):
        t = k / 4
        px_, py_ = tip[0] + ux * t, tip[1] + uy * t
        shape[int(py_), int(px_)] = True
    cells = {}
    for y in range(N):
        for x in range(N):
            if not shape[y, x]:
                continue
            px, py = x + 0.5, y + 0.5
            if math.hypot(px - cx_, py - cy_) <= hole:
                cells[(y, x)] = 'w'
            else:
                lit = ((px - cx_) + (py - cy_)) / r
                cells[(y, x)] = 'h' if lit < -0.7 else 'D' if lit > 0.55 else 'R'
    return shape, cells


pshape, pcells = map_pin((48.5, 26.5), 45, r=5.0, tip_k=1.5, hole=1.9)
rg = np.zeros_like(pshape)
for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0)):
    rg |= np.roll(np.roll(pshape, dy, 0), dx, 1)
img[rg & ~pshape] = (70, 20, 24)
PIN_PAL = {'h': (246, 110, 104), 'R': (222, 52, 52), 'D': (160, 30, 36), 'w': (255, 250, 246)}
for (y, x), c in pcells.items():
    img[y, x] = PIN_PAL[c]

paste(BAG, BAG_P, 26, 38)

np.save('final-colors.npy', img)


def render(size):
    im = Image.new('RGB', (size, size))
    d = ImageDraw.Draw(im)
    e = [round(i * size / N) for i in range(N + 1)]
    for y in range(N):
        for x in range(N):
            d.rectangle([e[x], e[y], e[x + 1] - 1, e[y + 1] - 1], fill=tuple(int(v) for v in img[y, x]))
    return im


for size, name in [(512, 'icon-512.png'), (192, 'icon-192.png'), (180, 'apple-touch-icon.png')]:
    render(size).save(name)
print('ok')
