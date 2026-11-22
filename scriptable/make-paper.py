"""產生小工具背景的復古紙張圖（public/widget/paper-*.jpg）。
用法：python3 scriptable/make-paper.py（需要 numpy、Pillow）
小工具從 App 網址下載這兩張圖並存在手機上；改了圖要把腳本的 PAPER_VER 加 1。
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
    lum = 1 + m * 0.06 + g * 0.06 + g2 * 0.035
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


if __name__ == '__main__':
    out = Path(__file__).resolve().parent.parent / 'public' / 'widget'
    out.mkdir(parents=True, exist_ok=True)
    # 中型 338×158、小型 158×158（點），3 倍解析度
    vintage(338, 158, seed=2).save(out / 'paper-medium.jpg', quality=88)
    vintage(158, 158, seed=3).save(out / 'paper-small.jpg', quality=88)
    print('ok', out)
