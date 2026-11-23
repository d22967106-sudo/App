"""七日回顧中型小工具預覽：照使用者之前的黑板粉筆像素風（chalk.py／big.py）的畫法"""
import math
import random
import sys
from PIL import Image, ImageDraw, ImageFont
from holes import LOOPS
from PIL import ImageFilter

FONT = sys.argv[1]
OUT = sys.argv[2]
NUMFONT = sys.argv[3] if len(sys.argv) > 3 else FONT
BOARD = (38, 66, 52)
TEXT = (240, 240, 232)
YELLOW = (250, 232, 140)
BLUE = (150, 200, 245)
PINK = (245, 160, 175)
G, GH = 112, 52  # 中型 338×158 點，一格 3 點
s = 9  # 一格 9 像素（3 倍螢幕）


def jit(c):
    v = random.randint(-12, 8)
    return tuple(max(0, min(255, x + v)) for x in c)


def px(d, x, y, c):
    d.rectangle([x * s, y * s, x * s + s - 1, y * s + s - 1], fill=c)


def board(d):
    R, FR = 6, 3
    for y in range(GH):
        for x in range(G):
            cx, cy = x + 0.5, y + 0.5
            e = min(cx, cy, G - cx, GH - cy)
            if (cx < R or cx > G - R) and (cy < R or cy > GH - R):
                ccx = R if cx < R else G - R
                ccy = R if cy < R else GH - R
                e = R - math.hypot(cx - ccx, cy - ccy)
            if e < 0:
                continue
            if e < 1:
                c = (80, 50, 28)
            elif e < FR + 0.3:
                c = (120, 78, 45) if (x + y * 3) % 9 else (100, 62, 35)
            else:
                r = random.random()
                c = (46, 78, 62) if r < 0.08 else (60, 92, 76) if r < 0.1 else BOARD
            px(d, x, y, c)


def chalk_rect(d, x0, y0, w, h, c):
    for x in range(x0 + 1, x0 + w - 1):
        for y in (y0, y0 + h - 1):
            if random.random() > 0.15:
                px(d, x, y, jit(c))
    for y in range(y0 + 1, y0 + h - 1):
        for x in (x0, x0 + w - 1):
            if random.random() > 0.15:
                px(d, x, y, jit(c))


def sprite(d, rows, pal, ox, oy):
    for y, r in enumerate(rows):
        for x, ch in enumerate(r):
            if ch == '.':
                continue
            if random.random() < 0.05:
                continue
            px(d, ox + x, oy + y, jit(pal[ch]))


DIG = {
    '0': ['0110', '1001', '1001', '1001', '1001', '1001', '0110'], '1': ['0010', '0110', '0010', '0010', '0010', '0010', '0111'],
    '2': ['0110', '1001', '0001', '0010', '0100', '1000', '1111'], '3': ['1110', '0001', '0001', '0110', '0001', '0001', '1110'],
    '4': ['0010', '0110', '1010', '1010', '1111', '0010', '0010'], '5': ['1111', '1000', '1110', '0001', '0001', '1001', '0110'],
    '6': ['0110', '1000', '1000', '1110', '1001', '1001', '0110'], '7': ['1111', '0001', '0010', '0010', '0100', '0100', '0100'],
    '8': ['0110', '1001', '1001', '0110', '1001', '1001', '0110'], '9': ['0110', '1001', '1001', '0111', '0001', '0001', '0110'],
    ',': ['00', '00', '00', '00', '01', '01', '10'],
}


def digits(d, text, x, y, c):
    for ch in text:
        g = DIG[ch]
        for j, row in enumerate(g):
            for i, b in enumerate(row):
                if b == '1':
                    px(d, x + i, y + j, jit(c))
        x += len(g[0]) + 1
    return x


def ink(font, text, track):
    """整行字實際有墨的上下範圍、總寬：真的畫出來量（這套字型回報的字框不準，底部都一樣低）"""
    top, bot, w = 1e9, -1e9, 0
    for i, ch in enumerate(text):
        m = Image.new('L', (int(font.size * 3), int(font.size * 3)), 0)
        ImageDraw.Draw(m).text((font.size, font.size), ch, font=font, fill=255)
        bb = m.getbbox()
        if bb:
            top, bot = min(top, bb[1] - font.size), max(bot, bb[3] - font.size)
        w += font.getlength(ch) + (track if i < len(text) - 1 else 0)
    return top, bot, w


GROW = 0.4
SS = 2  # 數字先用 2 倍大畫、算洞，再縮小（洞的邊才會圓滑）


def _glyph(ch, big, sw):
    font = ImageFont.truetype(NUMFONT, big)
    m = Image.new('L', (big * 2, big * 2), 0)
    ImageDraw.Draw(m).text((big // 2, big // 4), ch, font=font, fill=255, stroke_width=sw, stroke_fill=255)
    return m


def stem_width(m, frm=0.72, to=0.92):
    """量筆畫粗細：字的下段（只有一根直筆的地方）每一列有墨的寬度，取中位數"""
    import numpy as np
    a = np.array(m) > 127
    rows = np.where(a.any(1))[0]
    t, b = rows[0], rows[-1]
    ws = [a[y].sum() for y in range(int(t + (b - t) * frm), int(t + (b - t) * to))]
    return float(np.median(ws))


GROW_DIGITS = {}  # 使用者決定：數字全部照字型原本的樣子，不改洞
# 4、9：使用者圈的地方（4 的上半部：斜線、三角、橫線；9 的頭）筆畫兩側各削掉一點變細，形狀不動，洞自然變大。
# (區域下緣佔字高的比例, 每側削掉幾支筆粗)
THIN = {}


def _erode(mask, r):
    """往內縮 r 像素（交替用十字、方形，接近圓形，邊才不會變方）"""
    import numpy as np
    a = np.array(mask) > 127
    for i in range(int(round(r))):
        b = a.copy()
        b[1:] &= a[:-1]
        b[:-1] &= a[1:]
        b[:, 1:] &= a[:, :-1]
        b[:, :-1] &= a[:, 1:]
        if i % 2:
            b[1:, 1:] &= a[:-1, :-1]
            b[:-1, :-1] &= a[1:, 1:]
            b[1:, :-1] &= a[:-1, 1:]
            b[:-1, 1:] &= a[1:, :-1]
        a = b
    return Image.fromarray((a * 255).astype('uint8'))


def _counters(m):
    """字裡本來就有的洞（從外面填不到的空白）"""
    f = m.point(lambda v: 255 if v > 127 else 0)
    ImageDraw.floodfill(f, (0, 0), 128)
    return f.point(lambda v: 255 if v == 0 else 0)


def _area(mask):
    return mask.point(lambda v: 1 if v else 0).histogram()[1]


def digit_mask(ch, size, sw):
    """一個數字的不透明度圖（size 大小），一律在 500 像素大的字上處理再縮小"""
    big = 500
    bsw = max(1, round(sw * big / size))
    pen = stem_width(_glyph('1', big, bsw))
    m = _glyph(ch, big, bsw)
    if ch in THIN:
        import numpy as np
        bottom, amount = THIN[ch]
        a = np.array(m) > 127
        # 每一點離邊緣多遠（一層一層往內縮，數存活幾層）
        depth = np.zeros(a.shape, dtype=np.int16)
        cur = Image.fromarray((a * 255).astype('uint8'))
        T = int(round(pen * amount))
        for i in range(T + 1):
            ca = np.array(cur) > 127
            depth += ca
            cur = _erode(cur, 1) if i % 2 == 0 else cur.filter(ImageFilter.MinFilter(3))
        ys = np.nonzero(a.any(1))[0]
        top, bot = ys[0], ys[-1]
        edge = top + (bot - top) * bottom
        # 區域內削 T 層；區域邊界往下一支筆的距離慢慢變回原本的粗細
        yy = np.arange(a.shape[0])[:, None]
        w = np.clip((edge + pen * 0.8 - yy) / (pen * 1.6), 0, 1)
        keep = depth > (w * T)
        m = Image.fromarray((keep * 255).astype('uint8')).filter(ImageFilter.GaussianBlur(2.2)).point(lambda v: 255 if v > 127 else 0).filter(ImageFilter.GaussianBlur(1))
    if ch in GROW_DIGITS:
        target = _area(_counters(_glyph('6', big, bsw))) * GROW_DIGITS[ch] * 2
        solid = m.point(lambda v: 255 if v > 127 else 0)
        f = solid.copy()
        ImageDraw.floodfill(f, (0, 0), 128)
        solid = f.point(lambda v: 0 if v == 128 else 255)
        room = solid
        for _ in range(int(pen * 0.6)):
            room = room.filter(ImageFilter.MinFilter(3))
        hole = _counters(m)
        for _ in range(int(pen * 2)):
            if _area(hole) >= target:
                break
            grown = Image.composite(hole.filter(ImageFilter.MaxFilter(3)), hole, room)
            if grown.tobytes() == hole.tobytes():
                break
            hole = grown
        hole = hole.filter(ImageFilter.GaussianBlur(pen * 0.15)).point(lambda v: 255 if v > 110 else 0)
        m = Image.composite(Image.new('L', m.size, 0), m, hole)
    return m.resize((size * 2, size * 2), Image.LANCZOS)


def chalk_text(im, x, cy, text, col, size, num=False, center=False):
    """照 chalk.py：字加描邊、92% 不透明，再隨機挖小洞；cy＝這行字墨跡的垂直中心；數字字距拉開"""
    size = int(size)
    font = ImageFont.truetype(NUMFONT if num else FONT, size)
    track = size * 0.12 if num else size * 0.04
    top, bot, w = ink(font, text, track)
    if center:
        # x 是要對齊的中心：用實際墨跡的左右範圍置中（字型的字框不準）
        mk = Image.new('L', (size * 3, size * 3), 0)
        ImageDraw.Draw(mk).text((size, size), text, font=font, fill=255)
        l, _, r, _ = mk.getbbox()
        x = x - ((l + r) / 2 - size)
    y = cy - (top + bot) / 2
    lay = Image.new('RGBA', im.size, (0, 0, 0, 0))
    dl = ImageDraw.Draw(lay)
    sw = max(1, round(size / 42))
    cx = x
    for ch in text:
        if num:
            mk = digit_mask(ch, size, sw).point(lambda v: v * 235 // 255)
            ox, oy = int(round(cx)) - size // 2, int(round(y)) - size // 4
            solid = Image.new('RGBA', mk.size, col + (0,))
            solid.putalpha(mk)
            lay.alpha_composite(solid, (max(0, ox), max(0, oy)), (max(0, -ox), max(0, -oy)))
        else:
            dl.text((cx, y), ch, font=font, fill=col + (235,), stroke_width=sw, stroke_fill=col + (235,))
        cx += font.getlength(ch) + track
    dl = ImageDraw.Draw(lay)
    for _ in range(int(w * size / (420 if num else 95))):
        hx = random.randint(int(x) - 2, int(x + w))
        hy = random.randint(int(y + top), int(y + bot))
        dl.rectangle([hx, hy, hx + 2, hy + 2], fill=(0, 0, 0, 0))
    im.alpha_composite(lay)


def fit(text, size, maxw):
    """字太寬就縮小，放得進 maxw 像素（含字距）"""
    while size > 20 and ink(ImageFont.truetype(NUMFONT, int(size)), text, int(size) * 0.12)[2] > maxw:
        size -= 2
    return size


COIN = (['..YYYYY..', '.YOWWWOY.', 'YOW.O.WOY', 'YO.OOO.OY', 'YO..O..OY', 'YO.OOO.OY', 'YOW.O.WOY', '.YOWWWOY.', '..YYYYY..'],
        {'Y': YELLOW, 'O': (200, 165, 75), 'W': (255, 246, 200)})


def widget(days, out):
    random.seed(11)
    total = sum(days)
    avg = round(total / 7)
    im = Image.new('RGBA', (G * s, GH * s), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    board(d)
    texts = []
    # 左上：七日支出（標題跟硬幣同高、金額在下半部置中）
    chalk_rect(d, 5, 5, 53, 26, YELLOW)
    sprite(d, *COIN, 8, 8)
    texts.append((19.5 * s, 13 * s, '七日支出', TEXT, 8.6 * s, False))
    texts.append((8.5 * s, 24.8 * s, f'${total:,}', YELLOW, fit(f'${total:,}', (11 if NUMFONT == FONT else 8.6) * s, 46 * s), True))
    # 左下：日均（字和金額都在框的正中間）
    chalk_rect(d, 5, 33, 53, 14, BLUE)
    texts.append((8 * s, 40.3 * s, '日均', TEXT, 8.4 * s, False))
    texts.append((24 * s, 40.3 * s, f'${avg:,}', TEXT, fit(f'${avg:,}', (9.6 if NUMFONT == FONT else 7.4) * s, 31 * s), True))
    # 右：每天柱狀圖
    chalk_rect(d, 60, 5, 47, 42, (238, 238, 228))
    texts.append((63 * s, 10.2 * s, '每天', TEXT, 8 * s, False))
    top = max(days)
    # 固定由星期一排到星期日（七天剛好每個星期幾各一天；示範資料的第 0 天是星期六）
    week = [days[(i + 2) % 7] for i in range(7)]
    for i, v in enumerate(week):
        bh = max(1, round(v / top * 19))
        x = 64 + i * 6
        for a in range(4):
            for b in range(bh):
                if random.random() > 0.015:
                    px(d, x + a, 36 - b, jit(YELLOW if v >= avg else BLUE))
        texts.append(((x + 2) * s, 40.6 * s, '一二三四五六七'[i], TEXT, 6.2 * s, 'center'))
    for x, cy, t, c, size, num in texts:
        chalk_text(im, x, cy, t, c, size, num is True, center=(num == 'center'))
    im.save(out)


widget([820, 410, 1300, 560, 380, 690, 390], OUT + '-a.png')
widget([9800, 10200, 9500, 10400, 9900, 10100, 10030], OUT + '-b.png')
