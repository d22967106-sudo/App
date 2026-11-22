"""產生小工具用的圖（public/widget/）：
  paper-medium.jpg、paper-small.jpg  復古紙張背景
  magnifier.png                      地圖卡片上的放大鏡（銅框＋木柄＋影子，透明背景，跟卡片一樣大）
  glass.png                          鏡片玻璃的反光與邊緣暗角（透明，蓋在清楚的地圖上）
  oldmap.png                         老地圖濾鏡（半透明泛黃、斑駁、紙紋、摺痕、四周變暗，蓋在地圖上；跟卡片一樣大）
  mapframe.png                       地圖卡片的撕邊框：撕邊外面是小工具背景紙的同一塊（所以看起來像撕過的地圖放在紙上），
                                     邊緣焦黃、捲角、影子；撕邊裡面透明（下面是地圖）。CARD_POS 要跟腳本的版面一致
  tag.png                            地圖右下角的標籤：揉皺、撕邊、泛白的舊紙片（焦褐邊、斑點、影子；大小要跟腳本的 TAG 一樣）
  glyphs.json                        手寫中文字形（南構無恙行書，只收腳本裡 GLYPH_SET 那幾個固定出現的字）
                                     需要字體檔：python3 scriptable/make-widget-art.py <南构无恙行书.ttf>
                                     （字體檔從 npm 套件 @fontpkg/nangouwuyangxingshu 取得；字體只有簡體字，
                                      所以固定字句都挑繁簡同形的字。個人非商業使用）
用法：python3 scriptable/make-widget-art.py（需要 numpy、Pillow）
小工具從 App 網址下載這些圖並存在手機上；改了圖要把腳本的 ART_VER 加 1。
放大鏡的位置大小（CARD、LENS）要跟腳本裡的一樣。
"""
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from pathlib import Path


def vnoise(h, w, cell, rng):
    gh, gw = h // cell + 3, w // cell + 3
    g = Image.fromarray((rng.random((gh, gw)) * 255).astype(np.uint8)).resize((gw * cell, gh * cell), Image.BICUBIC)
    return np.asarray(g, dtype=np.float32)[:h, :w] / 255 - 0.5


def fbm(h, w, cells, rng, gain=0.6):
    out = np.zeros((h, w), np.float32)
    a = 1
    tot = 0
    for c in cells:
        out += vnoise(h, w, max(2, c), rng) * a
        tot += a
        a *= gain
    return out / tot * 2


def ramp(t, stops):
    t = np.clip(t, 0, 1)
    out = np.zeros(t.shape + (3,), np.float32)
    for ch in range(3):
        out[..., ch] = np.interp(t, [s[0] for s in stops], [s[1][ch] for s in stops])
    return out


def vintage(w, h, seed=1, S=3, center=(196, 181, 156), edge_strength=1.0):
    """米灰色舊紙：細密顆粒、淡淡斑駁、四周變暗、最外圈不規則的焦褐燒邊"""
    rng = np.random.default_rng(seed)
    W, H = w * S, h * S
    g = rng.normal(0, 1, (H, W)).astype(np.float32)
    g = np.asarray(Image.fromarray(((g * 40) + 128).clip(0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.7)), np.float32) / 128 - 1
    g2 = fbm(H, W, [9, 5, 3], rng, 0.8)
    m = fbm(H, W, [W // 3, W // 8, W // 20, W // 45], rng, 0.6)
    lum = 1 + m * 0.08 + g * 0.1 + g2 * 0.055  # 紋路要明顯
    c = np.array(center, np.float32)
    col = c[None, None, :] * lum[..., None] + np.clip(m, 0, 1)[..., None] * np.array([6, 0, -10], np.float32)
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    dx = np.abs(xx / W - 0.5) * 2
    dy = np.abs(yy / H - 0.5) * 2
    ex = np.clip(1 - (1 - dx) * W / H * 0.5, 0, 1)  # 左右與上下燒邊一樣寬
    r = np.maximum(ex, dy) + fbm(H, W, [W // 8, W // 25, W // 70, 8], rng, 0.65) * 0.1
    col = col * (1 - 0.16 * (dx ** 2 + dy ** 2) / 2)[..., None]
    v = np.clip((r - 0.74) / 0.3, 0, 1) * edge_strength
    tone = ramp(v, [(0.0, tuple(c)), (0.3, (172, 142, 104)), (0.55, (146, 104, 60)), (0.8, (86, 58, 32)), (1.0, (34, 22, 12))])
    a = np.clip(v * 1.3, 0, 1)[..., None]
    col = col * (1 - a) + tone * lum[..., None] * a
    return Image.fromarray(np.clip(col, 0, 255).astype(np.uint8))


# ── 放大鏡 ──
CARD = (140, 132)
LENS = dict(cx=80, cy=55, r_out=44, r_in=37)
S = 3
L = np.array([-0.45, -0.65, 0.62]); L = L / np.linalg.norm(L)
H_ = L + np.array([0, 0, 1.0]); H_ = H_ / np.linalg.norm(H_)


def shade(nx, ny, nz, albedo, shin=40, spec_k=1.0, amb=0.28):
    """金屬／木頭的光影：漫射＋高光＋一點環境反射"""
    dif = np.clip(nx * L[0] + ny * L[1] + nz * L[2], 0, 1)
    spec = np.clip(nx * H_[0] + ny * H_[1] + nz * H_[2], 0, 1) ** shin
    env = 0.5 + 0.5 * np.sin(ny * 5.0 - nx * 2.0)  # 反射到的天花板／窗戶亮暗
    a = np.array(albedo, np.float32)
    col = a[None, None, :] * (amb + 0.62 * dif + 0.18 * env)[..., None] + (spec * spec_k)[..., None] * np.array([255, 244, 214], np.float32)
    return col


def magnifier():
    W, H = CARD[0] * S, CARD[1] * S
    yy, xx = (np.mgrid[0:H, 0:W].astype(np.float32) + 0.5) / S
    cx, cy, ro, ri = LENS['cx'], LENS['cy'], LENS['r_out'], LENS['r_in']
    dx, dy = xx - cx, yy - cy
    r = np.sqrt(dx ** 2 + dy ** 2) + 1e-6
    ux, uy = dx / r, dy / r
    rgb = np.zeros((H, W, 3), np.float32)
    alpha = np.zeros((H, W), np.float32)

    def put(mask_a, col):
        nonlocal rgb, alpha
        a = np.clip(mask_a, 0, 1)
        rgb = rgb * (1 - a[..., None]) + col * a[..., None]
        alpha = alpha + a * (1 - alpha)

    # 把手的座標：沿著把手方向（往左下）的距離 ax、橫向 bx
    hx, hy = -np.sqrt(0.5), np.sqrt(0.5)
    ax = dx * hx + dy * hy
    bx = dx * (-hy) + dy * hx  # 垂直方向

    def cylinder(a0, a1, half, albedo, grain=None, shin=30, spec_k=0.8, cap=False):
        s = np.clip(bx / half, -1, 1)
        nz = np.sqrt(np.clip(1 - s ** 2, 0, 1))
        nxv, nyv = s * (-hy), s * hx
        col = shade(nxv, nyv, nz, albedo, shin, spec_k)
        if grain is not None:
            col = col * grain[..., None]
        cov = np.clip((half - np.abs(bx)) * S + 0.5, 0, 1) * np.clip((ax - a0) * S + 0.5, 0, 1) * np.clip((a1 - ax) * S + 0.5, 0, 1)
        if cap:  # 圓頭
            d = np.sqrt((ax - a1) ** 2 + bx ** 2)
            cov = np.maximum(cov, np.clip((half - d) * S + 0.5, 0, 1) * (ax >= a1))
        return cov, col

    rng = np.random.default_rng(5)
    # 木紋：沿把手方向拉長的雜訊
    gn = vnoise(400, 60, 6, rng) + 0.5 * vnoise(400, 60, 2, rng)
    ia = np.clip(((ax - ro) * 4).astype(int), 0, 399)
    ib = np.clip(((bx + 7) * 4).astype(int), 0, 59)
    grain = 0.82 + 0.3 * np.sin(bx * 2.2 + gn[ia, ib] * 6) * 0.5 + gn[ia, ib] * 0.25

    parts = []
    parts.append(cylinder(ro + 13, ro + 49, 4.6, (92, 52, 28), grain=grain, shin=24, spec_k=0.45))  # 木柄
    parts.append(cylinder(ro + 49, ro + 51.5, 4.0, (176, 128, 58), cap=True))  # 尾端銅蓋
    parts.append(cylinder(ro + 6, ro + 13, 5.4, (176, 128, 58)))  # 銅套
    parts.append(cylinder(ro - 3, ro + 6, 3.0, (160, 114, 50)))  # 連接桿
    # 銅套上的兩道刻線
    for a_ in (ro + 8, ro + 11):
        g = np.clip(1 - np.abs(ax - a_) * S / 1.2, 0, 1)
        cov, col = parts[2]
        parts[2] = (cov, col * (1 - 0.45 * g[..., None]))

    # 鏡框：環形斷面（像甜甜圈），加內外兩道細溝
    rm, hw = (ro + ri) / 2, (ro - ri) / 2
    t = np.clip((r - rm) / hw, -1, 1)
    nz = np.sqrt(np.clip(1 - t ** 2, 0, 1)) * 0.9 + 0.1
    ring_col = shade(t * ux, t * uy, nz, (182, 134, 62), shin=55, spec_k=1.1)
    for rr in (ri + 1.2, ro - 1.2):
        g = np.clip(1 - np.abs(r - rr) * S / 1.4, 0, 1)
        ring_col = ring_col * (1 - 0.5 * g[..., None])
    ring_cov = np.clip((ro - r) * S + 0.5, 0, 1) * np.clip((r - ri) * S + 0.5, 0, 1)

    # 影子（整支放大鏡的輪廓往右下偏、模糊）
    sil = ring_cov.copy()
    for cov, _ in parts:
        sil = np.maximum(sil, cov)
    sh = Image.fromarray((sil * 255).astype(np.uint8)).transform((W, H), Image.AFFINE, (1, 0, -4 * S, 0, 1, -6 * S)).filter(ImageFilter.GaussianBlur(4 * S))
    sh = np.asarray(sh, np.float32) / 255 * 0.45
    # 鏡片底下的影子（玻璃擋光，影子淡一點、偏移）
    lens_sh = np.clip((ri + 2 - np.sqrt((xx - cx - 4) ** 2 + (yy - cy - 6) ** 2)) / 6, 0, 1) * 0.12
    sh = np.maximum(sh, lens_sh)
    put(sh, np.zeros((H, W, 3), np.float32) + np.array([30, 18, 8], np.float32))
    for cov, col in [parts[0], parts[1], parts[3], parts[2]]:
        put(cov, col)
    put(ring_cov, ring_col)
    # 鏡片範圍挖空（之後清楚的地圖放在這裡）
    hole = np.clip((ri - r) * S + 0.5, 0, 1)
    alpha = alpha * (1 - hole)
    out = np.dstack([np.clip(rgb, 0, 255), alpha * 255]).astype(np.uint8)
    return Image.fromarray(out, 'RGBA')


def glass():
    """鏡片玻璃：邊緣折射的暗圈、內緣一圈亮邊、左上的弧形反光"""
    ri = LENS['r_in'] + 1
    D = ri * 2 * S
    yy, xx = (np.mgrid[0:D, 0:D].astype(np.float32) + 0.5) / S - ri
    rho = np.sqrt(xx ** 2 + yy ** 2) / ri
    ang = np.arctan2(yy, xx)
    rgb = np.zeros((D, D, 3), np.float32)
    a = np.zeros((D, D), np.float32)

    def put(al, col):
        nonlocal rgb, a
        al = np.clip(al, 0, 1)
        rgb = rgb * (1 - al[..., None]) + np.array(col, np.float32) * al[..., None]
        a = a + al * (1 - a)

    put(np.clip((rho - 0.78) / 0.22, 0, 1) ** 2 * 0.5, (40, 24, 10))  # 邊緣暗圈
    rim = np.exp(-((rho - 0.93) / 0.025) ** 2) * (0.5 + 0.5 * np.cos(ang - np.pi / 4)) * 0.35  # 右下內緣亮邊
    put(rim, (255, 236, 200))
    # 左上弧形反光（沿著邊、朝左上最亮）
    band = np.exp(-((rho - 0.74) / 0.07) ** 2) * np.clip(np.cos(ang + 3 * np.pi / 4), 0, 1) ** 3 * 0.55
    put(band, (255, 255, 255))
    spot = np.exp(-(((xx + ri * 0.38) ** 2 + (yy + ri * 0.42) ** 2) / (ri * 0.09) ** 2)) * 0.6
    put(spot, (255, 255, 255))
    put(np.ones_like(rho) * 0.04, (255, 250, 235))  # 玻璃本身一點點霧
    cov = np.clip((1 - rho) * ri * S + 0.5, 0, 1)
    a = a * cov
    return Image.fromarray(np.dstack([np.clip(rgb, 0, 255), a * 255]).astype(np.uint8), 'RGBA')


def oldmap():
    """老地圖濾鏡：蓋在彩色地圖上，讓它變成泛黃褪色的舊地圖"""
    W, H = CARD[0] * S, CARD[1] * S
    rng = np.random.default_rng(11)
    m = fbm(H, W, [W // 3, W // 8, W // 20, W // 50], rng, 0.6)
    g = rng.normal(0, 1, (H, W)).astype(np.float32)
    g = np.asarray(Image.fromarray(((g * 40) + 128).clip(0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.6)), np.float32) / 128 - 1
    a = 0.32 + m * 0.1 + g * 0.06  # 泛黃程度（越不透明越褪色）
    col = np.zeros((H, W, 3), np.float32) + np.array([176, 140, 92], np.float32)
    col = col * (1 + m[..., None] * 0.15 + g[..., None] * 0.08)
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    # 四周變暗變褐
    dx = np.abs(xx / W - 0.5) * 2
    dy = np.abs(yy / H - 0.5) * 2
    e = np.clip((np.maximum(dx, dy) + fbm(H, W, [W // 10, W // 30], rng) * 0.08 - 0.62) / 0.38, 0, 1) ** 1.5
    col = col * (1 - e[..., None] * 0.45)
    a = a + e * 0.3
    # 皺褶：很多條不同方向、長短的折痕，一邊亮一邊暗（揉過的紙）
    for i in range(14):
        ang = rng.uniform(0, np.pi)
        px, py = rng.uniform(0, W), rng.uniform(0, H)
        nx, ny = np.cos(ang), np.sin(ang)
        d = ((xx - px) * nx + (yy - py) * ny) / S
        along = ((xx - px) * -ny + (yy - py) * nx) / S
        L = rng.uniform(25, 90)
        fade = np.clip(1 - np.abs(along) / L, 0, 1) ** 0.7
        strength = rng.uniform(0.4, 1.0) if i > 1 else 1.0
        light = np.exp(-((d + 0.5) / 0.45) ** 2) * fade * strength
        dark = np.exp(-((d - 0.6) / 0.9) ** 2) * fade * strength
        col = col + light[..., None] * 55 - dark[..., None] * 45
        a = a + light * 0.12 + dark * 0.12
    # 小斑點
    sp = Image.new('L', (W, H), 0)
    d2 = ImageDraw.Draw(sp)
    for _ in range(25):
        x, y, r = rng.random() * W, rng.random() * H, rng.uniform(0.6, 2.2) * S
        d2.ellipse((x - r, y - r, x + r, y + r), fill=int(rng.uniform(60, 140)))
    sp = np.asarray(sp.filter(ImageFilter.GaussianBlur(1.2 * S / 3)), np.float32) / 255
    col = col * (1 - sp[..., None] * 0.5)
    a = a + sp * 0.3
    return Image.fromarray(np.dstack([np.clip(col, 0, 255), np.clip(a, 0, 1) * 255]).astype(np.uint8), 'RGBA')


# ── 地圖撕邊框 ──
# 卡片在中型小工具（338×158 點）裡的位置：右邊留 14、上面留 14（腳本 mediumWidget 的 padding）
CARD_POS = (338 - 14 - CARD[0], 14)


def mapframe():
    W, H = CARD[0] * S, CARD[1] * S
    rng = np.random.default_rng(21)
    paper = vintage(338, 158, seed=2)  # 跟 paper-medium.jpg 同一張
    x0, y0 = CARD_POS[0] * S, CARD_POS[1] * S
    bg = np.asarray(paper, np.float32)[y0:y0 + H, x0:x0 + W]
    # 撕邊的輪廓：往內縮 5 點，加上大小不同的鋸齒與幾個比較大的缺口
    pts = []
    inset = 5 * S
    def jag(n):
        a = np.cumsum(rng.normal(0, 1, n))
        a = a - np.linspace(a[0], a[-1], n)
        return a / (np.abs(a).max() + 1e-6)
    per = [(W, 'top'), (H, 'right'), (W, 'bottom'), (H, 'left')]
    for length, side in per:
        n = int(length / (1.5 * S))
        big = jag(n) * 2.6 * S + rng.normal(0, 0.6 * S, n)  # 大起伏＋細毛邊
        for i in range(n):
            t = i / n
            d = inset + big[i]
            if rng.random() < 0.012:
                d += rng.uniform(3, 6) * S  # 偶爾一個缺口
            if side == 'top':
                pts.append((t * W, d))
            elif side == 'right':
                pts.append((W - d, t * H))
            elif side == 'bottom':
                pts.append((W - t * W, H - d))
            else:
                pts.append((d, H - t * H))
    mask = Image.new('L', (W, H), 0)
    ImageDraw.Draw(mask).polygon(pts, fill=255)
    # 捲角：右上與左下剪掉一個斜角，另外畫翻起來的那塊
    md = ImageDraw.Draw(mask)
    c = 15 * S
    md.polygon([(W - c - inset, 0), (W, 0), (W, c + inset)], fill=0)
    md.polygon([(0, H - c - inset * 0.6), (0, H), (c + inset * 0.6, H)], fill=0)
    mask = mask.filter(ImageFilter.GaussianBlur(0.6))
    m = np.asarray(mask, np.float32) / 255
    # 外面：背景紙＋撕邊投下的影子
    sh = np.asarray(mask.transform((W, H), Image.AFFINE, (1, 0, -1.5 * S, 0, 1, -2.5 * S)).filter(ImageFilter.GaussianBlur(3 * S)), np.float32) / 255
    out_rgb = bg * (1 - sh[..., None] * 0.45)
    # 裡面：邊緣焦黃變深（越靠邊越深）
    inner = np.asarray(mask.filter(ImageFilter.MinFilter(5)).filter(ImageFilter.GaussianBlur(6 * S)), np.float32) / 255
    burn = np.clip(1 - inner, 0, 1) ** 1.3
    burn = burn * (0.85 + 0.3 * (fbm(H, W, [W // 6, W // 20, 8], rng) + 1) / 2)
    burn_rgb = np.zeros((H, W, 3), np.float32) + np.array([92, 56, 22], np.float32)
    burn_a = np.clip(burn * 0.8, 0, 0.85)
    # 撕開的紙邊：緊貼邊緣一圈淺色毛邊
    edge = np.clip(m - np.asarray(mask.filter(ImageFilter.MinFilter(int(1.5 * S) | 1)), np.float32) / 255, 0, 1)
    rgb = out_rgb * (1 - m[..., None]) + burn_rgb * m[..., None]
    a = (1 - m) + m * burn_a
    rgb = rgb * (1 - edge[..., None] * 0.7) + np.array([226, 206, 168], np.float32) * edge[..., None] * 0.7
    a = np.maximum(a, edge * 0.8)

    # 捲起來的角（翻過來的紙背：淺色、帶漸層與陰影）
    def flap(poly, light_dir):
        fm = Image.new('L', (W, H), 0)
        ImageDraw.Draw(fm).polygon(poly, fill=255)
        fm = fm.filter(ImageFilter.GaussianBlur(0.6))
        f = np.asarray(fm, np.float32) / 255
        shadow = np.asarray(fm.transform((W, H), Image.AFFINE, (1, 0, -light_dir[0] * 2 * S, 0, 1, -light_dir[1] * 2 * S)).filter(ImageFilter.GaussianBlur(2 * S)), np.float32) / 255
        nonlocal_rgb = rgb * (1 - shadow[..., None] * 0.35)
        yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
        g = np.clip(((xx - poly[0][0]) * light_dir[0] + (yy - poly[0][1]) * light_dir[1]) / (c * 1.2) + 0.5, 0, 1)
        col = np.zeros((H, W, 3), np.float32) + np.array([214, 192, 150], np.float32)
        col = col * (0.82 + 0.25 * g[..., None])
        return nonlocal_rgb * (1 - f[..., None]) + col * f[..., None], np.maximum(a + shadow * 0.35 * (1 - a), f)
    rgb, a = flap([(W - c - inset, inset * 0.4), (W - inset * 0.4, c + inset), (W - c * 0.75 - inset, c * 0.8 + inset)], (-0.7, 0.7))
    rgb, a = flap([(inset * 0.4, H - c - inset * 0.6), (c + inset * 0.6, H - inset * 0.4), (c * 0.7 + inset, H - c * 0.75 - inset)], (0.7, -0.7))
    return Image.fromarray(np.dstack([np.clip(rgb, 0, 255), np.clip(a, 0, 1) * 255]).astype(np.uint8), 'RGBA')


def blur_np(a, sigma):
    """浮點陣列的高斯模糊（Pillow 不支援浮點圖）"""
    r = max(1, int(sigma * 3))
    k = np.exp(-(np.arange(-r, r + 1) ** 2) / (2 * sigma * sigma))
    k /= k.sum()
    p = np.pad(a, r, mode='edge')
    p = np.apply_along_axis(lambda v: np.convolve(v, k, 'valid'), 1, p)
    return np.apply_along_axis(lambda v: np.convolve(v, k, 'valid'), 0, p)


# ── 右下角標籤：揉皺、撕邊的泛白舊紙片 ──
TAG = (106, 30)


def crumpled_tag():
    """揉皺的舊紙片：用「高度圖＋光照」算出真實的皺褶明暗，撕邊有纖維毛邊，邊緣泛黃焦褐"""
    S4 = 4  # 這張圖用 4 倍解析度畫，細節比較多
    W, H = TAG[0] * S4, TAG[1] * S4
    rng = np.random.default_rng(57)
    yy, xx = (np.mgrid[0:H, 0:W].astype(np.float32) + 0.5) / S4
    w, h = TAG

    # 1) 皺褶高度圖：很多條折痕（V 形的峰或谷），長短、深淺、方向都不同，兩端漸淡
    ht = np.zeros((H, W), np.float32)
    for i in range(120):
        big = i < 16
        px, py = rng.uniform(-5, w + 5), rng.uniform(-3, h + 3)
        ang = rng.uniform(0, np.pi)
        nx, ny = np.cos(ang), np.sin(ang)
        d = (xx - px) * nx + (yy - py) * ny
        along = (xx - px) * -ny + (yy - py) * nx
        L = rng.uniform(25, 70) if big else rng.uniform(6, 22)
        amp = rng.uniform(0.6, 1.1) if big else rng.uniform(0.15, 0.45)
        env = np.exp(-(along / L) ** 2)
        width = rng.uniform(2.5, 5.5) if big else rng.uniform(0.8, 2.2)
        v = np.clip(1 - np.abs(d) / width, 0, 1)  # V 形，中間尖
        ht += (1 if rng.random() < 0.5 else -1) * amp * v * env
    # 整張紙微微起伏
    ht += fbm(H, W, [W // 2, W // 5], rng) * 1.2
    ht = blur_np(ht, 0.14 * S4)

    # 2) 光照（左上方、偏低的光，皺褶才有立體感）
    gy, gx = np.gradient(ht * 1.0, 1 / S4)
    nx_, ny_, nz_ = -gx, -gy, np.ones_like(gx) * 1.6
    nl = np.sqrt(nx_ ** 2 + ny_ ** 2 + nz_ ** 2)
    Ld = np.array([-0.55, -0.6, 0.58]); Ld = Ld / np.linalg.norm(Ld)
    dif = (nx_ * Ld[0] + ny_ * Ld[1] + nz_ * Ld[2]) / nl
    shade = 0.58 + 0.5 * dif

    # 3) 紙色：泛白偏米，帶一點不均勻與細纖維紋
    g = rng.normal(0, 1, (H, W)).astype(np.float32)
    g = np.asarray(Image.fromarray(((g * 40) + 128).clip(0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.5 * S4 / 3)), np.float32) / 128 - 1
    mm = fbm(H, W, [W // 3, W // 8, W // 20], rng, 0.6)
    base = np.array([242, 228, 198], np.float32) * (1 + mm[..., None] * 0.035 + g[..., None] * 0.02)
    col = base * shade[..., None]

    # 4) 撕邊：大塊不規則＋細鋸齒，外面一圈半透明的紙纖維毛邊
    inset = 2.6
    edge_noise = fbm(H, W, [W // 6, W // 18, 10, 4], rng, 0.7)
    dx = np.minimum(xx, w - xx)
    dy = np.minimum(yy, h - yy)
    dist = np.minimum(dx, dy) - inset + edge_noise * 2.3  # >0 在紙裡
    body = np.clip(dist * S4 + 0.5, 0, 1)
    fiber_n = rng.random((H, W)).astype(np.float32)
    fiber_n = np.asarray(Image.fromarray((fiber_n * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.4)), np.float32) / 255
    fringe = np.clip((dist + 0.9) / 0.9, 0, 1) * (1 - body) * (fiber_n > 0.5) * 0.85
    alpha = np.clip(body + fringe, 0, 1)
    # 撕開的白色紙邊（緊貼邊緣、偏亮）
    torn = np.exp(-((dist - 0.25) / 0.35) ** 2) * body
    col = col * (1 - torn[..., None] * 0.35) + np.array([248, 242, 228], np.float32) * torn[..., None] * 0.35
    col = col * (1 - fringe[..., None]) + np.array([240, 232, 214], np.float32) * fringe[..., None]

    # 5) 泛黃與焦褐：越靠邊越黃，邊上幾塊焦斑（像參考圖右上角）
    age = np.clip(1 - dist / 5.5, 0, 1) ** 1.6
    patch = np.clip(0.3 + fbm(H, W, [W // 4, W // 10, 8], rng) * 1.4, 0, 1)
    col = col * (1 - (age * 0.25)[..., None]) + np.array([196, 160, 104], np.float32) * (age * 0.25)[..., None]
    scorch = np.clip(1 - dist / 2.2, 0, 1) ** 1.3 * patch
    col = col * (1 - (scorch * 0.6)[..., None]) + np.array([138, 86, 36], np.float32) * (scorch * 0.6)[..., None]
    # 零星的小黃斑
    sp = Image.new('L', (W, H), 0)
    sd = ImageDraw.Draw(sp)
    for _ in range(12):
        x, y = rng.uniform(0, W), rng.uniform(0, H)
        r = rng.uniform(0.2, 0.8) * S4
        sd.ellipse((x - r, y - r * 0.8, x + r, y + r * 0.8), fill=int(rng.uniform(70, 160)))
    sp = np.asarray(sp.filter(ImageFilter.GaussianBlur(0.45 * S4)), np.float32) / 255
    col = col * (1 - sp[..., None] * 0.35) + np.array([160, 112, 56], np.float32) * sp[..., None] * 0.35

    # 6) 影子（紙片浮在地圖上一點點）
    sil = Image.fromarray((alpha * 255).astype(np.uint8))
    sh = np.asarray(sil.transform((W, H), Image.AFFINE, (1, 0, -0.9 * S4, 0, 1, -1.6 * S4)).filter(ImageFilter.GaussianBlur(1.3 * S4)), np.float32) / 255 * 0.5
    out_a = alpha + sh * (1 - alpha)
    rgb = (col * alpha[..., None] + np.array([28, 16, 6], np.float32) * (sh * (1 - alpha))[..., None]) / np.maximum(out_a, 1e-6)[..., None]
    img = Image.fromarray(np.dstack([np.clip(rgb, 0, 255), np.clip(out_a, 0, 1) * 255]).astype(np.uint8), 'RGBA')
    return img.resize((TAG[0] * S, TAG[1] * S), Image.LANCZOS)


# ── 手寫中文字形 ──
GQ = 5  # 座標精度（字型 1000 單位＝1 em → 200）


def glyphs(ttf_path, chars):
    """把字形轉成簡化折線：{"em": 200, "g": {字: [字寬, "M x y dx dy ...M ..."]}}（座標相對前一點，y 往上）"""
    from fontTools.ttLib import TTFont
    from fontTools.pens.basePen import BasePen

    class Poly(BasePen):
        def __init__(self, gs):
            super().__init__(gs)
            self.contours = []

        def _moveTo(self, p):
            self.contours.append([p])

        def _lineTo(self, p):
            self.contours[-1].append(p)

        def _qCurveToOne(self, c, p):
            a = self.contours[-1][-1]
            n = max(3, min(10, int((abs(c[0] - a[0]) + abs(c[1] - a[1]) + abs(p[0] - c[0]) + abs(p[1] - c[1])) / 20)))
            for i in range(1, n + 1):
                t = i / n
                self.contours[-1].append(((1 - t) ** 2 * a[0] + 2 * (1 - t) * t * c[0] + t * t * p[0], (1 - t) ** 2 * a[1] + 2 * (1 - t) * t * c[1] + t * t * p[1]))

        def _curveToOne(self, c1, c2, p):
            a = self.contours[-1][-1]
            for i in range(1, 9):
                t = i / 8
                self.contours[-1].append(tuple((1 - t) ** 3 * a[k] + 3 * (1 - t) ** 2 * t * c1[k] + 3 * (1 - t) * t * t * c2[k] + t ** 3 * p[k] for k in (0, 1)))

        def _closePath(self):
            pass

    def dp(pts, tol=0.5):
        if len(pts) < 3:
            return pts
        a, b = pts[0], pts[-1]
        dx, dy = b[0] - a[0], b[1] - a[1]
        L = (dx * dx + dy * dy) ** 0.5 or 1e-9
        best, idx = -1, 0
        for i in range(1, len(pts) - 1):
            d = abs(dy * (pts[i][0] - a[0]) - dx * (pts[i][1] - a[1])) / L
            if d > best:
                best, idx = d, i
        if best <= tol:
            return [a, b]
        return dp(pts[:idx + 1], tol)[:-1] + dp(pts[idx:], tol)

    t = TTFont(ttf_path)
    gs = t.getGlyphSet()
    cmap = t.getBestCmap()
    hmtx = t['hmtx']
    out = {}
    for ch in sorted(set(chars)):
        if ord(ch) not in cmap:
            raise SystemExit(f'字體裡沒有「{ch}」')
        g = cmap[ord(ch)]
        pen = Poly(gs)
        gs[g].draw(pen)
        parts = []
        lx = ly = 0
        for c in pen.contours:
            q = [(round(x / GQ * 1000 / t['head'].unitsPerEm), round(y / GQ * 1000 / t['head'].unitsPerEm)) for x, y in c]
            if len(q) > 1 and q[0] == q[-1]:
                q = q[:-1]
            if len(q) < 3:
                continue
            mid = len(q) // 2
            q = dp(q[:mid + 1])[:-1] + dp(q[mid:] + [q[0]])[:-1]
            if len(q) < 3:
                continue
            nums = []
            for x, y in q:
                nums += [x - lx, y - ly]
                lx, ly = x, y
            parts.append('M' + ' '.join(str(v) for v in nums))
        out[ch] = [round(hmtx[g][0] / GQ * 1000 / t['head'].unitsPerEm), ''.join(parts)]
    upem = t['head'].unitsPerEm
    asc = t['hhea'].ascent
    return {'em': 1000 // GQ, 'asc': round(asc / upem, 3), 'g': out}


def glyph_set():
    """讀腳本裡的 GLYPH_SET（固定出現的字）"""
    import re
    js = (Path(__file__).resolve().parent / 'ledger-widget.js').read_text(encoding='utf-8')
    return re.search(r"const GLYPH_SET = '([^']*)'", js).group(1)


if __name__ == '__main__':
    out = Path(__file__).resolve().parent.parent / 'public' / 'widget'
    out.mkdir(parents=True, exist_ok=True)
    # 中型 338×158、小型 158×158（點），3 倍解析度
    vintage(338, 158, seed=2).save(out / 'paper-medium.jpg', quality=88)
    vintage(158, 158, seed=3).save(out / 'paper-small.jpg', quality=88)
    magnifier().save(out / 'magnifier.png', optimize=True)
    glass().save(out / 'glass.png', optimize=True)
    oldmap().save(out / 'oldmap.png', optimize=True)
    mapframe().save(out / 'mapframe.png', optimize=True)
    crumpled_tag().save(out / 'tag.png', optimize=True)
    import sys, json
    if len(sys.argv) > 1:
        g = glyphs(sys.argv[1], glyph_set())
        (out / 'glyphs.json').write_text(json.dumps(g, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
        print('glyphs', len(g['g']))
    else:
        print('沒給字體檔，glyphs.json 不更新')
    print('ok', out)
