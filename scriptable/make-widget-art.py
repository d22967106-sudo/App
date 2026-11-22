"""產生小工具用的圖（public/widget/）：
  paper-medium.jpg、paper-small.jpg  復古紙張背景
  magnifier.png                      地圖卡片上的放大鏡（銅框＋木柄＋影子，透明背景，跟卡片一樣大）
  glass.png                          鏡片玻璃的反光與邊緣暗角（透明，蓋在清楚的地圖上）
用法：python3 scriptable/make-widget-art.py（需要 numpy、Pillow）
小工具從 App 網址下載這些圖並存在手機上；改了圖要把腳本的 ART_VER 加 1。
放大鏡的位置大小（CARD、LENS）要跟腳本裡的一樣。
"""
import numpy as np
from PIL import Image, ImageFilter
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
    lum = 1 + m * 0.045 + g * 0.022 + g2 * 0.012  # 紋路要淡
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


if __name__ == '__main__':
    out = Path(__file__).resolve().parent.parent / 'public' / 'widget'
    out.mkdir(parents=True, exist_ok=True)
    # 中型 338×158、小型 158×158（點），3 倍解析度
    vintage(338, 158, seed=2).save(out / 'paper-medium.jpg', quality=88)
    vintage(158, 158, seed=3).save(out / 'paper-small.jpg', quality=88)
    magnifier().save(out / 'magnifier.png', optimize=True)
    glass().save(out / 'glass.png', optimize=True)
    print('ok', out)
