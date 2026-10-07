"""Cuts 1920x1080 "live video" frames out of a fixture photo: the label fills the middle of the frame at
about 2.6 px per barcode module (like 1080p phone video), with hand shake, a couple of motion-blurred
frames and codec softening. Usage: python3 make_frames.py <photo.jpg> <out-dir> <cx> <cy> <src-width>"""
import sys
import numpy as np
from PIL import Image, ImageFilter

photo, out, cx, cy, sw = sys.argv[1], sys.argv[2], float(sys.argv[3]), float(sys.argv[4]), float(sys.argv[5])
src = Image.open(photo).convert('RGB')
PAD = 800   # the frame may reach past the photo edge: extend it with chassis grey
img = Image.new('RGB', (src.width + 2 * PAD, src.height + 2 * PAD), (58, 58, 58))
img.paste(src, (PAD, PAD))
cx, cy = cx + PAD, cy + PAD
sh = sw * 1080 / 1920
rng = np.random.default_rng(3)
n = 24
for i in range(n):
    jx, jy = rng.normal(0, 10), rng.normal(0, 8)
    box = (cx - sw / 2 + jx, cy - sh / 2 + jy, cx + sw / 2 + jx, cy + sh / 2 + jy)
    f = img.resize((1920, 1080), Image.BILINEAR, box=box)
    if i in (5, 6, 15):   # hand moved: 9 px horizontal motion blur
        b = np.asarray(f).astype(np.float32)
        a = sum(np.roll(b, d, axis=1) for d in range(-4, 5)) / 9
    else:
        a = np.asarray(f.filter(ImageFilter.GaussianBlur(0.9))).astype(np.float32)
    a = a + rng.normal(0, 4, (1080, 1920, 3))
    Image.fromarray(np.clip(a, 0, 255).astype(np.uint8)).save(f'{out}/f{i:03d}.png')
