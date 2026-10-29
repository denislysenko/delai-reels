"""Sticker-style cutout for the cover: simplified silhouette + a uniform stroke in the brand's
light colour, baked to PNG.

    python3 scripts/cover-sticker.py frame.jpg matte.png public/cover-cutout.png 20

The silhouette is simplified (morphological open/close, largest component only) so the stroke
doesn't trace individual hair strands or outline detached wisps; the stroke comes from a distance
field, so it has an even width and round joins. Last arg = stroke px.
"""
from PIL import Image, ImageFilter
import json, os, sys

src = Image.open(sys.argv[1]).convert("RGB")          # original frame
cut = Image.open(sys.argv[2]).convert("RGBA")         # matted cutout (for alpha)
stroke_px = int(sys.argv[4]) if len(sys.argv) > 4 else 14

a = cut.split()[3]
# abstract silhouette: threshold -> heavy blur -> re-threshold smooths hair into a blob
m = a.point(lambda v: 255 if v > 90 else 0)
m = m.filter(ImageFilter.GaussianBlur(12)).point(lambda v: 255 if v > 128 else 0)

# abstract the silhouette: opening shaves hair "fingers", closing fills notches,
# then keep only the main body so nothing floats detached
import numpy as np
from scipy import ndimage
arr = np.array(m) > 128
r = 22
yy, xx = np.ogrid[-r : r + 1, -r : r + 1]
disk = (yy * yy + xx * xx) <= r * r
arr = ndimage.binary_opening(arr, structure=disk)
arr = ndimage.binary_closing(arr, structure=disk)
labels, n = ndimage.label(arr)
if n > 1:
    sizes = ndimage.sum(arr, labels, range(1, n + 1))
    arr = labels == (1 + int(sizes.argmax()))
m = Image.fromarray((arr * 255).astype("uint8"))

m = m.filter(ImageFilter.GaussianBlur(2))             # soft edge

# stroke = uniform-width band from the distance field (even thickness, round joins)
dist = ndimage.distance_transform_edt(~np.array(m).astype(bool))
band = np.clip((stroke_px + 1.5) - dist, 0, 1.5) / 1.5  # 1.5px anti-alias ramp
d = Image.fromarray((band * 255).astype("uint8"))

out = Image.new("RGBA", src.size, (0, 0, 0, 0))
here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
light = json.load(open(os.path.join(here, "..", "harness.config.json")))["colors"]["light"] or "#FFFFFF"
rgb = tuple(int(light[i : i + 2], 16) for i in (1, 3, 5))
stroke_layer = Image.new("RGBA", src.size, rgb + (255,))  # the brand's light colour
out.paste(stroke_layer, (0, 0), d)
person = src.copy()
person.putalpha(m)
out.alpha_composite(person)
out.save(sys.argv[3])
print("ok", out.size)
