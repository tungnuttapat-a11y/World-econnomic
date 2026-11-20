"""วาดไอคอนแอป (เข็มทิศ) เป็น PNG"""
from pathlib import Path
from PIL import Image, ImageDraw
OUT = Path(__file__).resolve().parent.parent / "icons"
OUT.mkdir(exist_ok=True)

def icon(size, pad_ratio=0.0):
    S = size * 4
    im = Image.new("RGB", (S, S), "#0c1319")
    d = ImageDraw.Draw(im)
    c, r = S / 2, S * (0.36 - pad_ratio)
    w = int(S * 0.045)
    d.ellipse([c - r, c - r, c + r, c + r], outline="#e5edf2", width=w)
    n = r * 0.78
    d.polygon([(c, c - n), (c + n * 0.3, c), (c, c + n), (c - n * 0.3, c)], fill="#5cc3d6")
    d.polygon([(c, c + n), (c + n * 0.3, c), (c - n * 0.3, c)], fill="#2e7f8f")
    k = S * 0.03
    d.ellipse([c - k, c - k, c + k, c + k], fill="#0c1319")
    return im.resize((size, size), Image.LANCZOS)

icon(192).save(OUT / "icon-192.png")
icon(512).save(OUT / "icon-512.png")
icon(512, 0.08).save(OUT / "icon-maskable-512.png")
icon(180).save(OUT / "apple-touch-icon.png")
print("icons ok")
