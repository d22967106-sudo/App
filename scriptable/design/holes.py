import sys
from PIL import Image, ImageDraw, ImageFont, ImageFilter

def glyph_mask(font, ch, size, sw):
    m = Image.new('L', (size * 2, size * 2), 0)
    ImageDraw.Draw(m).text((size // 2, size // 4), ch, font=font, fill=255, stroke_width=sw, stroke_fill=255)
    return m

# 每個數字哪一段是「圈」（以字的墨跡範圍為準：上下比例）
LOOPS = {'9': [(0.0, 0.5)], '8': [(0.0, 0.5), (0.5, 1.0)], '4': [(0.0, 0.72)]}

def digit_hole(font, ch, size, sw, erode):
    """圈的部分往內縮 erode 像素，剩下的就是洞（形狀跟著那一圈）"""
    m = glyph_mask(font, ch, size, sw)
    l, t, r, b = m.getbbox()
    hole = Image.new('L', m.size, 0)
    for a, z in LOOPS.get(ch, []):
        y0, y1 = int(t + (b - t) * a), int(t + (b - t) * z)
        part = Image.new('L', m.size, 0)
        part.paste(m.crop((0, y0, m.width, y1)), (0, y0))
        # 先把圈裡原本的小縫補滿，再往內縮
        filled = part.copy()
        ImageDraw.floodfill(filled, (0, 0), 128)
        filled = filled.point(lambda v: 0 if v == 128 else 255)
        k = erode * 2 + 1
        core = filled.filter(ImageFilter.MinFilter(k if k % 2 else k + 1))
        hole = Image.composite(core, hole, core)
    return m, hole

if __name__ == '__main__':
    font = ImageFont.truetype('cy-sub.ttf', 300)
    out = Image.new('RGB', (1500, 900), (38, 66, 52))
    for row, er in enumerate([10, 13, 16]):
        for i, ch in enumerate('46890'):
            m, h = digit_hole(font, ch, 300, 7, er)
            g = Image.composite(Image.new('L', m.size, 0), m, h)
            tile = Image.new('RGB', m.size, (38, 66, 52))
            tile.paste((240, 240, 232), mask=g)
            out.paste(tile.crop((100, 50, 400, 350)), (i * 300, row * 300))
    out.save('../holes-test.png')
