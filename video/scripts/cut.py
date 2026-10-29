#!/usr/bin/env python3
"""Turn a raw take into public/footage.mp4 + a captions.json skeleton.

    python3 scripts/cut.py ../takes/1.MOV [squeeze_over] [keep_pause]

`squeeze_over` / `keep_pause` are in seconds and default to harness.config.json → cut (0.45 / 0.24
unless the reference analysis tuned them). Lower them when a take
is delivered tight: the splices are also what the punch-ins hang off (see below), so a two-minute
take with one pause long enough to cut has no rhythm to work with. Aim for 10-15 splices over two
minutes; 0.45 / 0.24 is about the floor. A pause has to be longer than `keep_pause + 2*PAD`
before anything is actually removed.

Language and transcription engine come from harness.config.json (`language`, `transcription`:
"whisper" = local whisper.cpp, "elevenlabs" = ElevenLabs Scribe, key in video/.env).
Env overrides: WLANG=en, QUIET=-46 (noisy room), SPEED=1.1 (faster delivery),
DROP="12.40-15.80,48.10-50.30" (remove retakes, source seconds).

What it does, and why each step is the way it is:

1. Squeeze the pauses. silencedetect at -34dB decides WHICH pauses exist (it correctly counts
   a breath as one). It does NOT decide where they start: a soft final consonant sits under
   -34dB, so it opens the pause up to 0.45s early and the cut eats the end of the word.
   Lowering the detector threshold is not the fix — at -45dB it misses whole pauses, because
   the room tone is louder than the tail. So each boundary is refined against a 20ms RMS
   envelope at -55dB, and PAD seconds of air are kept either side.
2. Encode at 1.2x the composition so the punch-ins stay at or above native pixels, crf 22.
   crf 18 gave a 183MB file that killed the Remotion worker mid-render.
3. Transcribe the CUT, not the source — word timings then need no remapping, and remapping is
   where they go wrong.

It prints the numbers the composition needs: total frames, and the frame of every splice
(those go straight into the BEATS table in ui/Footage.tsx — a crop change on each splice is
what turns a jump cut into a punch-in).

`em` in the emitted captions is a placeholder: 0 for function words, 1 for the rest. The em:2
payload words (~10%) and the ~7 `accent` words are assigned BY MEANING afterwards.
"""
import json, math, os, re, struct, subprocess, sys, wave

WIN = 0.02            # RMS analysis window
QUIET = float(os.environ.get("QUIET", "-55"))  # below this is true silence, not a consonant tail
# or a breath. A noisier room (room tone around -50 dB) needs QUIET=-46, or no pause is cut.
MIN_PAUSE = 0.30
SQUEEZE_OVER = 0.65   # pauses longer than this get cut...
KEEP_PAUSE = 0.30     # ...down to this
PAD = 0.08            # air kept either side of a cut (anti-patterns: tail + ~0.08s)
SIZE = "1296x2304"    # 1.2x the 1080x1920 composition
MODEL = os.path.expanduser(os.environ.get("WHISPER_MODEL", "~/.cache/whisper/ggml-large-v3-turbo.bin"))
here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # video/
CONFIG = json.load(open(os.path.join(here, "..", "harness.config.json")))
LANG = os.environ.get("WLANG", CONFIG.get("language") or "auto")
ENGINE = os.environ.get("TRANSCRIBE", CONFIG.get("transcription", "whisper"))
# SPEED=1.15 plays the whole cut faster (a fast talker reads as energetic). Applied HERE,
# not in the master, so the transcript, the splice frames and the composition all live on the
# sped timeline and the graphics still animate at their own pace.
SPEED = float(os.environ.get("SPEED", CONFIG.get("cut", {}).get("speed", 1)))
# DROP="12.40-15.80,48.10-50.30" removes retakes / false starts (SOURCE seconds, bounds inside
# pauses — find them by chunk transcription + an RMS envelope) in the same single encode.
DROP = [tuple(map(float, r.split("-"))) for r in os.environ.get("DROP", "").split(",") if r]

FILLER = {
    "о", "том", "как", "в", "и", "с", "по", "это", "я", "ну", "вот", "а", "что",
    "но", "до", "на", "от", "его", "им", "тому", "уже", "если", "еще", "чем",
    "их", "мы", "к", "у", "же", "ли", "то", "за", "они", "есть", "будет", "буду",
    "будем", "не", "или", "более", "был", "была", "было", "были", "так", "там",
    "a", "an", "the", "to", "of", "in", "and", "or", "but", "is", "are", "it", "that",
    "this", "you", "your", "i", "we", "if", "for", "with", "at", "on", "do", "be",
}

src = os.path.abspath(sys.argv[1])
SQUEEZE_OVER = CONFIG.get("cut", {}).get("squeeze_over", SQUEEZE_OVER)
KEEP_PAUSE = CONFIG.get("cut", {}).get("keep_pause", KEEP_PAUSE)
if len(sys.argv) > 2:
    SQUEEZE_OVER = float(sys.argv[2])
if len(sys.argv) > 3:
    KEEP_PAUSE = float(sys.argv[3])
tmp = os.path.join(here, "out", "cut-tmp")
os.makedirs(tmp, exist_ok=True)


def run(*cmd):
    return subprocess.run(cmd, capture_output=True, text=True)


def envelope(wav):
    w = wave.open(wav, "rb")
    n = w.getnframes()
    pcm = struct.unpack(f"<{n}h", w.readframes(n))
    step = int(w.getframerate() * WIN)
    out = []
    for i in range(0, n - step, step):
        acc = 0
        for v in pcm[i : i + step]:
            acc += v * v
        rms = math.sqrt(acc / step) / 32768
        out.append(20 * math.log10(rms) if rms > 1e-9 else -120.0)
    return out


def env_key(name):
    """A key from video/.env without ever printing it."""
    for line in open(os.path.join(here, ".env")):
        k, _, v = line.strip().partition("=")
        if k == name and v:
            return v.strip().strip('"')
    sys.exit(f"{name} is not set in video/.env")


def words_from_elevenlabs(wav):
    """ElevenLabs Scribe: word-level timestamps, no local model needed."""
    out = f"{tmp}/scribe.json"
    r = run("curl", "-sS", "-o", out, "-w", "%{http_code}",
            "https://api.elevenlabs.io/v1/speech-to-text",
            "-H", f"xi-api-key: {env_key('ELEVENLABS_API_KEY')}",
            "-F", "model_id=scribe_v2", *(["-F", f"language_code={LANG}"] if LANG != "auto" else []),
            "-F", "timestamps_granularity=word", "-F", f"file=@{wav}")
    if r.stdout.strip() != "200":
        sys.exit(f"Scribe failed ({r.stdout.strip()}): {open(out).read()[:300]}")
    return [{"w": t["text"].strip(), "s": t["start"], "e": t["end"]}
            for t in json.load(open(out))["words"]
            if t.get("type") == "word" and t["text"].strip(".,!?…:;-–—").strip()]


def words_from(wav, tag):
    if ENGINE == "elevenlabs":
        return words_from_elevenlabs(wav)
    run("whisper-cli", "-m", MODEL, "-f", wav, "-l", LANG, "-ml", "1", "-oj",
        "-of", f"{tmp}/{tag}", "--no-prints")
    toks = json.load(open(f"{tmp}/{tag}.json"))["transcription"]
    out = []
    for tk in toks:
        t = tk["text"]
        if not t.strip():
            continue
        s, e = tk["offsets"]["from"] / 1000, tk["offsets"]["to"] / 1000
        # a leading space is what marks the start of a new word in -ml 1 output
        if t.startswith(" ") or not out:
            out.append({"w": t.strip(), "s": s, "e": e})
        else:
            out[-1]["w"] += t.strip()
            out[-1]["e"] = e
    return [w for w in out if w["w"].strip(".,!?…:;-–—")]


# ---------- 1. pauses
run("ffmpeg", "-v", "error", "-i", src, "-ac", "1", "-ar", "16000", "-y", f"{tmp}/src.wav")
env = envelope(f"{tmp}/src.wav")

quiet = lambda t: 0 <= int(t / WIN) < len(env) and env[int(t / WIN)] < QUIET

def true_start(a, b):
    while a < b and not quiet(a):
        a += WIN
    return a

def true_end(a, b):
    while b > a and not quiet(b - WIN):
        b -= WIN
    return b

err = run("ffmpeg", "-hide_banner", "-nostats", "-i", f"{tmp}/src.wav",
          "-af", f"silencedetect=n=-34dB:d={MIN_PAUSE}", "-f", "null", "-").stderr
gaps, st = [], None
for L in err.splitlines():
    m = re.search(r"silence_start: ([\d.]+)", L)
    if m:
        st = float(m.group(1))
    m = re.search(r"silence_end: ([\d.]+)", L)
    if m and st is not None:
        gaps.append((st, float(m.group(1))))
        st = None
SRC_DUR = len(env) * WIN
if st is not None:  # a silence still open at EOF
    gaps.append((st, SRC_DUR))

# Leading / trailing silence is trimmed only if it really touches the start / the end: a take
# that stops mid-word has no trailing silence, and its last PAUSE must not be taken for one —
# that silently cut the whole last phrase.
HEAD = max(0.0, true_end(0.0, gaps[0][1]) - 0.25) if gaps and gaps[0][0] < 0.05 else 0.0
TAIL = (true_start(gaps[-1][0], gaps[-1][1]) + 0.25
        if gaps and gaps[-1][1] > SRC_DUR - 0.05 else SRC_DUR)
drops, rescued = [(0.0, HEAD), (TAIL, 1e9)], 0
for a, b in gaps:
    if a < HEAD or b > TAIL:
        continue
    ta, tb = true_start(a, b), true_end(a, b)
    if ta - a > 0.1:
        rescued += 1
    if tb - ta > SQUEEZE_OVER:
        lo, hi = ta + PAD + KEEP_PAUSE / 2, tb - PAD - KEEP_PAUSE / 2
        if hi - lo > 0.05:
            drops.append((lo, hi))
drops += DROP
drops.sort()

keeps, t = [], 0.0
for a, b in drops:
    if a > t:
        keeps.append((t, a))
    t = max(t, b)
keeps = [(a, b) for a, b in keeps if b - a > 0.01]

acc, cuts = 0.0, []
for a, b in keeps[:-1]:
    acc += b - a
    cuts.append(acc / SPEED)
DUR = (acc + (keeps[-1][1] - keeps[-1][0])) / SPEED

# ---------- 2. encode
fc = "".join(
    f"[0:v]trim={a}:{b},setpts=PTS-STARTPTS[v{i}];"
    f"[0:a]atrim={a}:{b},asetpts=PTS-STARTPTS[a{i}];" for i, (a, b) in enumerate(keeps))
fc += "".join(f"[v{i}][a{i}]" for i in range(len(keeps)))
fc += f"concat=n={len(keeps)}:v=1:a=1[cv][ca];[cv]setpts=PTS/{SPEED},fps=30[v];[ca]atempo={SPEED}[a]"
open(f"{tmp}/filter.txt", "w").write(fc)

dst = os.path.join(here, "public", "footage.mp4")
r = subprocess.run(
    ["ffmpeg", "-hide_banner", "-v", "warning", "-i", src, "-/filter_complex", f"{tmp}/filter.txt",
     "-map", "[v]", "-map", "[a]", "-s", SIZE, "-c:v", "libx264", "-crf", "22",
     "-preset", "medium", "-g", "30", "-pix_fmt", "yuv420p", "-r", "30",
     "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", "-y", dst])
if r.returncode:
    sys.exit("encode failed")

frames = int(subprocess.run(
    ["ffprobe", "-v", "error", "-select_streams", "v", "-count_frames",
     "-show_entries", "stream=nb_read_frames", "-of", "csv=p=0", dst],
    capture_output=True, text=True).stdout.strip().rstrip(","))

# ---------- 3. verify no splice landed on speech, then transcribe the cut
run("ffmpeg", "-v", "error", "-i", dst, "-ac", "1", "-ar", "16000", "-y", f"{tmp}/cut.wav")
cenv = envelope(f"{tmp}/cut.wav")
cdb = lambda t: cenv[int(t / WIN)] if 0 <= int(t / WIN) < len(cenv) else -120
bad = [c for c in cuts if cdb(c - 0.06) > -45 or cdb(c + 0.04) > -45]

words = words_from(f"{tmp}/cut.wav", "cut")
caps = []
for w in words:
    key = w["w"].strip(".,!?…:;»«\"").lower()
    caps.append({"w": w["w"], "s": round(w["s"], 2), "e": round(w["e"], 2),
                 "em": 0 if key in FILLER else 1})
json.dump(caps, open(os.path.join(here, "public", "captions.json"), "w"),
          ensure_ascii=False, indent=0)

print(f"\nfootage.mp4  {DUR:.2f}s  {frames} frames   ({rescued} pauses whose -34dB start was "
      f"inside a word tail)")
print(f"DURATION = {frames}")
print("Footage.tsx splice frames:", [round(c * 30) for c in cuts])
print(f"captions.json: {len(caps)} words — assign em:2 and accent by MEANING before rendering")
if bad:
    print(f"!! {len(bad)} splices land on speech: {[round(c, 2) for c in bad]}")
else:
    print("all splices sit in silence")
if not cuts:
    print("!! no splices: the pauses are shorter than squeeze_over, or the room is louder than "
          "QUIET — lower the args (floor ~0.45 0.24) or re-run with QUIET=-46")
