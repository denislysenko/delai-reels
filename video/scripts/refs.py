#!/usr/bin/env python3
"""Download and MEASURE reference reels — the raw material for «what do I like».

    python3 scripts/refs.py URL [URL …]          # Instagram / TikTok / Shorts links or local mp4s
    COOKIES_FROM=chrome python3 scripts/refs.py … # only if Instagram demands a login (user's OK!)

Everything lands in takes/refs/ (gitignored — references are for private analysis, never
republish them). Per reel NN: NN.mp4, NN-sheet.jpg (24 frames across the whole reel),
NN-hook.jpg (the first 3 s, every 0.5 s), and a row in refs.json. Already-downloaded reels are
reused, so a re-run after a failed link only fetches what is missing.

Measured, not guessed: duration, the cadence of picture changes (ffmpeg scene score > 0.1 — a
hard cut, a punch-in on a splice (~0.15-0.22), a full-frame insert; a talking head on its own
sits at ~0.003, a slow push-in never registers), changes in the hook, loudness, speech rate and
the first spoken line (whisper.cpp, if installed). What the numbers can't see — caption style, graphics, framing,
palette — the agent reads off the sheets. To help with the palette, the saturated colours of
every sheet are pulled out too (graphic and type accents live there; walls and skin mostly sit
below the cut-off) and the ones that recur across reels are drawn into takes/refs/palette.png.
"""
import glob, json, os, re, statistics, subprocess, sys

here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # video/
OUT = os.path.join(here, "..", "takes", "refs")
MODEL = os.path.expanduser(os.environ.get("WHISPER_MODEL", "~/.cache/whisper/ggml-large-v3-turbo.bin"))
os.makedirs(OUT, exist_ok=True)


def run(*cmd):
    return subprocess.run(cmd, capture_output=True, text=True)


def fetch(src, n):
    """A local file is used as is; a link is downloaded once with yt-dlp."""
    if os.path.exists(src):
        return src, {}
    have = glob.glob(f"{OUT}/{n:02d}.mp4")
    if not have:
        cmd = ["yt-dlp", "-q", "--no-warnings", "-f", "mp4/bv*+ba/b", "--merge-output-format", "mp4",
               "--write-info-json", "--sleep-requests", "1", "-o", f"{OUT}/{n:02d}.%(ext)s", src]
        if os.environ.get("COOKIES_FROM"):
            cmd[1:1] = ["--cookies-from-browser", os.environ["COOKIES_FROM"]]
        r = run(*cmd)
        if r.returncode or not glob.glob(f"{OUT}/{n:02d}.mp4"):
            err = (r.stderr.strip().splitlines() or ["unknown error"])[-1]
            return None, {"error": err[:200]}
    info = {}
    if os.path.exists(f"{OUT}/{n:02d}.info.json"):
        j = json.load(open(f"{OUT}/{n:02d}.info.json"))
        info = {k: j.get(k) for k in ("uploader", "view_count", "like_count", "description") if j.get(k) is not None}
        if "description" in info:
            info["description"] = info["description"][:300]
    return f"{OUT}/{n:02d}.mp4", info


def colours(sheet):
    """Saturated, bright colours on a sheet, strongest first: [{hex, share (% of frame), hue bin}].
    Whatever footage slips through (a red object on the wall, orange-lit skin) the agent tells
    apart by looking at the sheet."""
    from PIL import Image
    im = Image.open(sheet).convert("RGB")
    bins = {}
    flat = lambda i: getattr(i, "get_flattened_data", i.getdata)()  # getdata is deprecated in Pillow 12
    # vivid only (S > 75%, V > 67%): a brand accent on type or a card passes, skin and walls don't
    for (r, g, b), (h, s, v) in zip(flat(im), flat(im.convert("HSV"))):
        if s > 190 and v > 170:
            acc = bins.setdefault(h * 24 // 256, [0, 0, 0, 0])
            acc[0] += r; acc[1] += g; acc[2] += b; acc[3] += 1
    total = im.width * im.height
    out = [{"hex": "#%02X%02X%02X" % (a[0] // a[3], a[1] // a[3], a[2] // a[3]),
            "share": round(100 * a[3] / total, 2), "hue": k}
           for k, a in bins.items() if a[3] / total > 0.0003]  # accent words are a sliver of the frame
    return sorted(out, key=lambda c: -c["share"])[:4]


def recurring(rows):
    """Accent hues that show up in at least 2 reels and ~30% of them (neighbouring hue bins count
    as one colour), with the strongest instance of each."""
    found = []
    for k in range(24):
        near = lambda c: min(abs(c["hue"] - k), 24 - abs(c["hue"] - k)) <= 1
        hits = [max(filter(near, r["colours"]), key=lambda c: c["share"])
                for r in rows if any(map(near, r.get("colours", [])))]
        if len(hits) >= max(2, round(0.3 * len(rows))):
            found.append({"hex": max(hits, key=lambda c: c["share"])["hex"], "refs": len(hits), "hue": k})
    # keep local maxima only: one entry per colour, not one per bin it spans
    keep = [f for f in found if not any(g["refs"] > f["refs"] and min(abs(g["hue"] - f["hue"]), 24 - abs(g["hue"] - f["hue"])) <= 2 for g in found)]
    out = []
    for f in sorted(keep, key=lambda f: -f["refs"]):
        if all(min(abs(o["hue"] - f["hue"]), 24 - abs(o["hue"] - f["hue"])) > 2 for o in out):
            out.append(f)
    return out


def palette_sheet(rows, common, path):
    """One row of swatches per reel, the recurring accents on top — to show the user."""
    from PIL import Image, ImageDraw, ImageFont
    font = ImageFont.load_default(size=22)
    W, H, L = 150, 70, 90
    lines = [("common", [(c["hex"], f'{c["refs"]}/{len(rows)}') for c in common])]
    lines += [(f'{r["n"]:02d}', [(c["hex"], f'{c["share"]}%') for c in r.get("colours", [])]) for r in rows]
    img = Image.new("RGB", (L + 4 * (W + 10), len(lines) * (H + 34) + 10), "white")
    d = ImageDraw.Draw(img)
    for i, (label, sw) in enumerate(lines):
        y = 10 + i * (H + 34)
        d.text((10, y + H // 2 - 11), label, fill="black", font=font)
        for j, (hx, note) in enumerate(sw):
            x = L + j * (W + 10)
            d.rectangle((x, y, x + W, y + H), fill=hx)
            d.text((x, y + H + 4), f"{hx} {note}", fill="black", font=font)
    img.save(path)


def measure(path, n):
    dur = float(run("ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path).stdout)
    err = run("ffmpeg", "-hide_banner", "-nostats", "-i", path, "-vf", "select='gt(scene,0.1)',showinfo",
              "-af", "ebur128", "-f", "null", "-").stderr
    cuts = []
    for t in map(float, re.findall(r"pts_time:([\d.]+)", err)):
        if not cuts or t - cuts[-1] > 0.25:  # one splice often scores on two adjacent frames
            cuts.append(t)
    lufs = re.findall(r"I:\s+(-?[\d.]+) LUFS", err)
    edges = [0.0] + cuts + [dur]
    shots = [b - a for a, b in zip(edges, edges[1:]) if b - a > 0.05]
    row = {
        "duration": round(dur, 1),
        "shots": len(shots),
        "median_shot": round(statistics.median(shots), 2) if shots else None,
        "longest_shot": round(max(shots), 1) if shots else None,
        "cuts_first_3s": sum(1 for c in cuts if c < 3),
        "lufs": float(lufs[-1]) if lufs else None,
    }
    # the sheets: 24 frames spread over the reel, and the hook every 0.5 s
    run("ffmpeg", "-v", "error", "-i", path, "-vf", f"fps=24/{dur:.2f},scale=180:-2,tile=6x4", "-frames:v", "1",
        "-q:v", "3", "-y", f"{OUT}/{n:02d}-sheet.jpg")
    run("ffmpeg", "-v", "error", "-t", "3", "-i", path, "-vf", "fps=2,scale=240:-2,tile=6x1", "-frames:v", "1",
        "-q:v", "3", "-y", f"{OUT}/{n:02d}-hook.jpg")
    if os.path.exists(MODEL) and run("which", "whisper-cli").returncode == 0:
        wav = f"{OUT}/{n:02d}.wav"
        run("ffmpeg", "-v", "error", "-i", path, "-ac", "1", "-ar", "16000", "-y", wav)
        text = run("whisper-cli", "-m", MODEL, "-f", wav, "-l", "auto", "-nt", "--no-prints").stdout.strip()
        os.remove(wav)
        words = text.split()
        row["words_per_sec"] = round(len(words) / dur, 1) if dur else None
        row["hook_line"] = re.split(r"(?<=[.!?])\s", " ".join(words))[0][:160] if words else ""
    row["colours"] = colours(f"{OUT}/{n:02d}-sheet.jpg")
    return row


rows = []
for n, src in enumerate(sys.argv[1:], 1):
    path, info = fetch(src, n)
    row = {"n": n, "src": src, **info}
    if path:
        row.update(measure(path, n))
    rows.append(row)
    print(f"{n:2d}  " + ("FAILED: " + row["error"] if "error" in row else
          f"{row['duration']}s  shots {row['shots']}  median {row['median_shot']}s  longest {row['longest_shot']}s  "
          f"hook cuts {row['cuts_first_3s']}  {row['lufs']} LUFS  {row.get('words_per_sec', '-')} w/s"), flush=True)

ok = [r for r in rows if "error" not in r]
common = recurring(ok)
json.dump({"refs": rows, "recurring_colours": common}, open(f"{OUT}/refs.json", "w"), ensure_ascii=False, indent=1)
if ok:
    palette_sheet(ok, common, f"{OUT}/palette.png")
if ok:
    med = lambda k: statistics.median([r[k] for r in ok if r.get(k) is not None] or [0])
    print(f"\nmedian of {len(ok)}: {med('duration')}s long, shot {med('median_shot')}s, "
          f"{med('cuts_first_3s')} cuts in the hook, {med('lufs')} LUFS, {med('words_per_sec')} words/s")
if ok:
    print("recurring accent colours: " + (", ".join(f'{c["hex"]} ({c["refs"]}/{len(ok)})' for c in common) or "none"))
print(f"→ takes/refs/refs.json, NN-sheet.jpg, NN-hook.jpg, palette.png  ({len(rows) - len(ok)} failed)")
