#!/usr/bin/env python3
"""Show palette / font options as real frames side by side, so the user picks by eye, not by hex.

    python3 scripts/variants.py out/palette.png 70,368 \
        '{"label": "A", "colors": {"accent": "#7C5CFF"}}' \
        '{"label": "B", "colors": {"accent": "#00C27A", "pain": "#FF5A36"}}'

Each option is a partial harness.config.json merged over the current one for its stills only;
the config is restored afterwards whatever happens. A font option needs its @fontsource package
installed and imported in src/index.css first (Root.tsx refuses to render a font it can't load).
Columns are labelled A, B, C… — say in chat which is which.
"""
import json, os, subprocess, sys
from PIL import Image, ImageDraw, ImageFont

here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # video/
cfg = os.path.join(here, "..", "harness.config.json")
original = open(cfg).read()
out, frames = sys.argv[1], [int(f) for f in sys.argv[2].split(",")]
opts = [json.loads(o) for o in sys.argv[3:]]


def merge(a, b):
    for k, v in b.items():
        a[k] = merge(a[k], v) if isinstance(v, dict) and isinstance(a.get(k), dict) else v
    return a


shots = {}
try:
    for i, opt in enumerate(opts):
        label = opt.pop("label", chr(65 + i))
        open(cfg, "w").write(json.dumps(merge(json.loads(original), opt), ensure_ascii=False, indent=2) + "\n")
        for f in frames:
            png = os.path.join(here, "out", f"variant-{i}-{f}.png")
            r = subprocess.run(["npx", "remotion", "still", "MyComp", png, f"--frame={f}", "--scale=0.5",
                                "--timeout=120000", "--log=error"], cwd=here)
            if r.returncode:
                sys.exit(f"option {label} did not render — see the error above")
            shots[(i, f)] = (label, png)
finally:
    open(cfg, "w").write(original)

# one column per option, one row per frame, the label above each column
W, H, G, T = 360, 640, 16, 56
font = ImageFont.load_default(size=40)
sheet = Image.new("RGB", (len(opts) * (W + G) + G, T + len(frames) * (H + G)), "white")
d = ImageDraw.Draw(sheet)
for (i, f), (label, png) in shots.items():
    x = G + i * (W + G)
    d.text((x + W // 2 - 12, 8), label, fill="black", font=font)
    sheet.paste(Image.open(png).convert("RGB").resize((W, H)), (x, T + frames.index(f) * (H + G)))
    os.remove(png)
sheet.save(out)
print(f"→ {out}")
