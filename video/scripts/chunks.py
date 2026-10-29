#!/usr/bin/env python3
"""Find retakes and false starts BEFORE cutting: split the take on pauses and transcribe every
chunk on its own. A whole-file whisper pass normalises stutters away (a phrase said twice comes
back as one clean sentence), so repeats only show up chunk by chunk.

    python3 scripts/chunks.py ../takes/1.MOV

Prints index, SOURCE seconds and text per chunk. A repeat = adjacent chunks saying the same thing;
a false start = a one- or two-word chunk that the next chunk begins with. Drop the FIRST attempt,
keep the last, and hand the ranges to cut.py: DROP="a-b,c-d" (bounds inside the pauses).
Needs whisper.cpp (`whisper-cli`) — with the ElevenLabs engine, listen to the joins instead.
"""
import json, os, re, subprocess, sys

here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # video/
LANG = os.environ.get("WLANG", json.load(open(os.path.join(here, "..", "harness.config.json")))["language"] or "auto")
MODEL = os.path.expanduser(os.environ.get("WHISPER_MODEL", "~/.cache/whisper/ggml-large-v3-turbo.bin"))
tmp = os.path.join(here, "out", "chunks-tmp")
os.makedirs(tmp, exist_ok=True)
wav = f"{tmp}/src.wav"
subprocess.run(["ffmpeg", "-v", "error", "-i", sys.argv[1], "-ac", "1", "-ar", "16000", "-y", wav], check=True)

err = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", wav, "-af", "silencedetect=n=-36dB:d=0.22",
                      "-f", "null", "-"], capture_output=True, text=True).stderr
edges = [0.0]
for line in err.splitlines():
    m = re.search(r"silence_(start|end): ([\d.]+)", line)
    if m:
        edges.append(float(m.group(2)))
dur = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", wav],
                           capture_output=True, text=True).stdout)
edges.append(dur)
# edges alternate speech-start, silence-start, silence-end, …: pair them into speech chunks
chunks = [(a, b) for a, b in zip(edges[0::2], edges[1::2]) if b - a >= 0.25]

for i, (a, b) in enumerate(chunks):
    part = f"{tmp}/{i:03d}.wav"
    subprocess.run(["ffmpeg", "-v", "error", "-ss", f"{a:.2f}", "-to", f"{b:.2f}", "-i", wav, "-y", part], check=True)
    text = subprocess.run(["whisper-cli", "-m", MODEL, "-f", part, "-l", LANG, "-nt", "--no-prints"],
                          capture_output=True, text=True).stdout.strip().replace("\n", " ")
    print(f"{i:3d}  {a:7.2f}-{b:7.2f}  {text}", flush=True)
