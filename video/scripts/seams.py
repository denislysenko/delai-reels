#!/usr/bin/env python3
"""Check every join of the cut BEFORE the edit goes on: re-transcribe each seam on its own and
show the frames either side of it.

    python3 scripts/seams.py            # after cut.py; reads public/cuts.json + public/footage.mp4

Why: a whole-file whisper pass hides a repeat that sits across a join. "мы сделали | сделали
систему" comes back as one clean phrase, or as one word stretched over two seconds. Only a short
window around the join, transcribed without VAD, shows the doubled word. The frames catch what
the transcript can't: the speaker reaching for the camera or looking away right at the join.

Prints, per seam: the splice time, the words before | after, and flags:
  REPEAT  — a word from the last three before the join comes back in the first three after it;
  STRETCH — a word longer than 1.8 s (whisper glued a retake into it);
Writes out/seams.jpg: one row per seam, the frame 0.25 s before and 0.25 s after (ffmpeg only).
Needs whisper.cpp for the text; with the ElevenLabs engine it only draws the frames.
"""
import json, os, re, subprocess, sys

here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # video/
CONFIG = json.load(open(os.path.join(here, "..", "harness.config.json")))
LANG = os.environ.get("WLANG", CONFIG.get("language") or "auto")
ENGINE = os.environ.get("TRANSCRIBE", CONFIG.get("transcription", "whisper"))
MODEL = os.path.expanduser(os.environ.get("WHISPER_MODEL", "~/.cache/whisper/ggml-large-v3-turbo.bin"))
WIN = float(os.environ.get("SEAM_WIN", "2.0"))  # seconds of speech kept either side of the join
# a word said once runs up to ~1.5 s when whisper hangs the pause after it on the word; a retake glued
# into one word runs 2 s and more
STRETCH = float(os.environ.get("SEAM_STRETCH", "1.8"))
footage = os.path.join(here, "public", "footage.mp4")
tmp = os.path.join(here, "out", "seams-tmp")
os.makedirs(tmp, exist_ok=True)

try:
    splices = json.load(open(os.path.join(here, "public", "cuts.json")))["splices"]
except FileNotFoundError:
    sys.exit("public/cuts.json not found — run cut.py first")
if not splices:
    sys.exit("no splices in the cut — nothing to check")


def run(*cmd):
    return subprocess.run(cmd, capture_output=True, text=True)


def norm(w):
    return re.sub(r"[^\w]", "", w.lower())


def words(wav, tag):
    """whisper.cpp word timings for a short window, VAD off (it would drop the stutter)."""
    run("whisper-cli", "-m", MODEL, "-f", wav, "-l", LANG, "-ml", "1", "-oj",
        "-of", f"{tmp}/{tag}", "--no-prints")
    out = []
    for tk in json.load(open(f"{tmp}/{tag}.json"))["transcription"]:
        t = tk["text"]
        if not t.strip():
            continue
        s, e = tk["offsets"]["from"] / 1000, tk["offsets"]["to"] / 1000
        if t.startswith(" ") or not out:
            out.append({"w": t.strip(), "s": s, "e": e})
        else:
            out[-1]["w"] += t.strip()
            if re.search(r"\w", t):  # a trailing "." carries the pause after the word, not the word
                out[-1]["e"] = e
    return out


run("ffmpeg", "-v", "error", "-i", footage, "-ac", "1", "-ar", "16000", "-y", f"{tmp}/cut.wav")
flagged = 0
for i, c in enumerate(splices):
    a = max(0.0, c - WIN)
    line = f"{i:2d}  {c:7.2f}s  "
    if ENGINE == "whisper":
        part = f"{tmp}/{i:03d}.wav"
        run("ffmpeg", "-v", "error", "-ss", f"{a:.3f}", "-t", f"{2 * WIN:.3f}", "-i", f"{tmp}/cut.wav", "-y", part)
        ws = words(part, f"{i:03d}")
        seam = c - a
        # split on word START: whisper.cpp end times run long, a start is where the word really begins
        before = [w for w in ws if w["s"] < seam]
        after = [w for w in ws if w["s"] >= seam]
        tail = {norm(w["w"]) for w in before[-3:] if len(norm(w["w"])) > 2}
        head = {norm(w["w"]) for w in after[:3] if len(norm(w["w"])) > 2}
        flags = []
        if tail & head:
            flags.append("REPEAT " + ",".join(sorted(tail & head)))
        # the last word of a window always runs to its end — only words inside the window count
        long = [w["w"] for w in ws if w["e"] - w["s"] > STRETCH and w["s"] > 0.1 and w["e"] < 2 * WIN - 0.1]
        if long:
            flags.append("STRETCH " + ",".join(long))
        flagged += bool(flags)
        line += " ".join(w["w"] for w in before) + "  |  " + " ".join(w["w"] for w in after)
        if flags:
            line += "    !! " + "; ".join(flags)
    print(line, flush=True)
    for tag, t in (("a", c - 0.25), ("b", c + 0.25)):
        run("ffmpeg", "-v", "error", "-ss", f"{max(0.0, t):.3f}", "-i", footage, "-frames:v", "1",
            "-vf", "scale=270:-2", "-y", f"{tmp}/{i:03d}{tag}.jpg")

# one sheet with ffmpeg alone (no Pillow): a row per join, before | after
rows = []
for i in range(len(splices)):
    row = f"{tmp}/row{i:03d}.jpg"
    run("ffmpeg", "-v", "error", "-i", f"{tmp}/{i:03d}a.jpg", "-i", f"{tmp}/{i:03d}b.jpg", "-filter_complex",
        "[0]pad=iw+10:ih:0:0:black[l];[l][1]hstack=2,pad=iw:ih+10:0:0:black", "-y", row)
    rows.append(row)
sheet = os.path.join(here, "out", "seams.jpg")
ins = [x for r in rows for x in ("-i", r)]
if len(rows) == 1:
    run("ffmpeg", "-v", "error", *ins, "-y", sheet)
else:
    run("ffmpeg", "-v", "error", *ins, "-filter_complex", f"vstack={len(rows)}", "-y", sheet)
print(f"\nframes: out/seams.jpg — row N is join N from the top, left = before, right = after")

if ENGINE == "whisper":
    print(f"{flagged} of {len(splices)} joins flagged" if flagged else "no repeats at the joins")
