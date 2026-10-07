"""Lays rendered barcodes out on synthetic Cisco labels and degrades them like a 12 MP phone photo.

Usage: python3 compose_labels.py <build-dir with PNGs + codes.json> <out-dir>
Deterministic (fixed seeds) so the fixtures are reproducible.
"""
import json
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

build, out = sys.argv[1], sys.argv[2]
codes = json.load(open(build + 'codes.json'))


def font(size):
    try:
        return ImageFont.load_default(size=size)
    except TypeError:  # Pillow < 10.1
        return ImageFont.load_default()


def label(rows, width, pad=40, gap=34, bg=(250, 250, 246)):
    """rows: [(caption, png-name or None)] stacked top to bottom on a white label."""
    parts = []
    for caption, png in rows:
        parts.append(('t', caption))
        if png:
            src = Image.open(build + png).convert('RGBA')
            flat = Image.new('RGBA', src.size, (255, 255, 255, 255))
            parts.append(('b', Image.alpha_composite(flat, src).convert('L')))
    h = pad
    for kind, v in parts:
        h += (46 if kind == 't' else v.height) + (8 if kind == 't' else gap)
    img = Image.new('RGB', (width, h + pad), bg)
    d = ImageDraw.Draw(img)
    y = pad
    for kind, v in parts:
        if kind == 't':
            d.text((pad, y), v, fill=(25, 25, 25), font=font(38))
            y += 46 + 8
        else:
            img.paste(v.convert('RGB'), (pad + 20, y))
            y += v.height + gap
    d.rectangle([2, 2, width - 3, img.height - 3], outline=(170, 170, 165), width=4)
    return img


def photo(name, stickers, seed, angle, persp):
    rng = np.random.default_rng(seed)
    W, H = 4032, 3024
    # brushed dark-grey chassis
    base = rng.normal(70, 6, (H, W)).astype(np.float32)
    base += np.linspace(-8, 8, W)[None, :]
    canvas = Image.fromarray(np.clip(base, 0, 255).astype(np.uint8)).convert('RGB')
    for img, (x, y) in stickers:
        canvas.paste(img, (x, y))
    # small rotation and keystone, like a hand-held phone
    canvas = canvas.rotate(angle, resample=Image.BICUBIC, fillcolor=(60, 60, 60))
    dx = persp * W
    coeffs = find_coeffs([(0, 0), (W, 0), (W, H), (0, H)], [(dx, 0), (W - dx * 0.4, dx * 0.2), (W, H), (0, H - dx * 0.3)])
    canvas = canvas.transform((W, H), Image.PERSPECTIVE, coeffs, Image.BICUBIC, fillcolor=(60, 60, 60))
    canvas = canvas.filter(ImageFilter.GaussianBlur(1.1))
    a = np.asarray(canvas).astype(np.float32)
    # uneven rack lighting + sensor noise
    yy, xx = np.mgrid[0:H, 0:W]
    light = 0.78 + 0.30 * np.exp(-(((xx - W * 0.35) / (W * 0.7)) ** 2 + ((yy - H * 0.3) / (H * 0.8)) ** 2))
    a = a * light[..., None] + rng.normal(0, 5, a.shape)
    Image.fromarray(np.clip(a, 0, 255).astype(np.uint8)).save(out + name, quality=88)
    print('wrote', out + name)


def find_coeffs(src, dst):
    m = []
    for (x, y), (X, Y) in zip(dst, src):
        m.append([x, y, 1, 0, 0, 0, -X * x, -X * y])
        m.append([0, 0, 0, x, y, 1, -Y * x, -Y * y])
    A = np.array(m, dtype=np.float64)
    B = np.array(src, dtype=np.float64).reshape(8)
    return np.linalg.solve(A, B).tolist()


def scaled(img, f):
    return img.resize((int(img.width * f), int(img.height * f)), Image.LANCZOS)


ap = label([
    ('PID VID: CW9166I-B V06', 'ap-pid.png'),
    ('S/N: FJC295016BD', 'ap-serial.png'),
    ('Meraki S/N: Q5AP-9XMF-374L', 'ap-meraki.png'),
    ('MAC: 78:0F:81:0A:68:B0', 'ap-mac.png'),
    ('Cisco Systems, Inc.  Made in China', None),
], 1250)
photo('ap.jpg', [(scaled(ap, 1.25), (1250, 700))], seed=7, angle=2.5, persp=0.012)

main = label([
    ('PID: C9300-48UN-A  VID: V10', 'switch-pid.png'),
    ('SN: FJC302010KM', 'switch-serial.png'),
    ('800-107831-05 D0', 'switch-partno.png'),
    ('MAC ADDR: F4B8.2188.DE00', 'switch-mac.png'),
    ('CLEI: INMGV10CRE', 'switch-dm.png'),
], 1350)
asset = label([('PROPERTY OF KING COUNTY', None), ('ASSET 298366', 'switch-asset.png')], 760, bg=(244, 246, 250))
photo('switch.jpg', [(scaled(main, 1.15), (700, 800)), (scaled(asset, 1.15), (2500, 1000))], seed=11, angle=-2.0, persp=0.01)
