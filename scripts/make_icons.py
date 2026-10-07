"""App icons: white barcode bars on the app's blue. Usage: python3 scripts/make_icons.py"""
from PIL import Image, ImageDraw

BLUE = (11, 99, 206)
BARS = [1, 3, 1, 2, 1, 1, 3, 1, 2, 1]   # relative widths of bar, gap, bar, ...


def icon(size, maskable=False, radius=0.22):
    s = size * 4   # draw large, then downsample for clean edges
    img = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if maskable:
        d.rectangle([0, 0, s, s], fill=BLUE)
        inner = 0.5    # keep the bars inside the maskable safe zone
    else:
        d.rounded_rectangle([0, 0, s - 1, s - 1], radius=int(s * radius), fill=BLUE)
        inner = 0.6
    w = s * inner
    unit = w / sum(BARS)
    x = (s - w) / 2
    top, bot = s * (0.5 - inner * 0.36), s * (0.5 + inner * 0.36)
    for i, b in enumerate(BARS):
        if i % 2 == 0:
            d.rounded_rectangle([x, top, x + unit * b, bot], radius=int(unit * 0.25), fill='white')
        x += unit * b
    return img.resize((size, size), Image.LANCZOS)


icon(192).save('site/icons/icon-192.png')
icon(512).save('site/icons/icon-512.png')
icon(512, maskable=True).save('site/icons/icon-maskable-512.png')
icon(180, radius=0).convert('RGB').save('site/icons/apple-touch-icon.png')   # iOS rounds the corners itself
icon(32).save('site/icons/favicon-32.png')
print('icons written to site/icons/')
