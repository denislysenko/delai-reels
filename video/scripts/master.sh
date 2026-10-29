#!/bin/bash
# Render MyComp and master it to the delivery spec → out/final-master.mp4 (the deliverable).
#
# PICTURE in 800-frame chunks, SOUND in one pass, muxed at the end.
#
# Chunks, because a single pass over a long comp dies somewhere past frame ~2400 — sometimes
# "The browser crashed while rendering frame N", sometimes "Could not extract frame from
# compositor". It is flaky, not frame-specific: the same range renders cleanly on its own; a
# fresh browser per chunk fixes it. Whatever the crash, it SURFACES as
# `delayRender("brand fonts") timed out` — read further up the log for the real one.
#
# The chunks render MUTED and the audio comes from one separate render: concatenating per-chunk
# AAC leaves a ~20ms hole at every seam (each chunk carries its own encoder delay). An audio-only
# render never touches the frame pipeline, so it is fast and cannot hit the crash above.
set -euo pipefail
cd "$(dirname "$0")/.."

# the timeline comes from the composition itself, the loudness target from the profile
DURATION=$(sed -n 's/^export const DURATION = \([0-9]*\);.*/\1/p' src/Composition.tsx)
TITLE_OUT=$(sed -n 's/^const TITLE_OUT = \([0-9]*\);.*/\1/p' src/Composition.tsx)
read -r LUFS POSTER <<<"$(node -p 'const c = require("../harness.config.json"); `${c.audio.lufs} ${c.style.poster.enabled}`')"
LAST=$((DURATION - 1))
CHUNK=800

[ -f public/footage.mp4 ] || { echo "!! public/footage.mp4 missing — cut a take first (scripts/cut.py)"; exit 1; }
# a missing cutout = the poster drawn OVER the face for that frame
if [ "$POSTER" = "true" ]; then
  for f in $(seq 0 $((TITLE_OUT - 1))); do
    [ -f "public/cut/$(printf %04d "$f").png" ] || { echo "!! public/cut/$(printf %04d "$f").png missing — finish scripts/matte.py $TITLE_OUT"; exit 1; }
  done
fi

mkdir -p out
rm -f out/part-*.mp4 out/parts.txt
i=0
for start in $(seq 0 $CHUNK $LAST); do
  end=$((start + CHUNK - 1))
  [ $end -gt $LAST ] && end=$LAST
  npx remotion render MyComp "out/part-$i.mp4" --frames=$start-$end --muted --timeout=120000
  printf "file 'part-%s.mp4'\n" "$i" >> out/parts.txt
  i=$((i + 1))
done
ffmpeg -v error -f concat -safe 0 -i out/parts.txt -c copy -y out/picture.mp4

# the audio pass gets a longer timeout and two workers — at the picture settings the font
# force-load can starve while other workers decode footage
npx remotion render MyComp out/sound.wav --codec=wav --timeout=300000 --concurrency=2

# No -shortest: both streams come from the same composition and are the same length by
# construction, but the AAC encode lands a few ms short of the picture, and -shortest then
# silently truncates the video to match.
ffmpeg -v error -i out/picture.mp4 -i out/sound.wav -map 0:v -map 1:a \
  -c:v copy -c:a aac -b:a 192k -movflags +faststart -y out/final.mp4

# Voice stays out of a limiter; loudnorm only moves the whole mix to target (delivery-specs §5).
# TWO passes: single-pass loudnorm works off a running estimate and lands ~1.5 LU under target.
# Pass one measures, pass two applies those numbers. The JSON block is the tail of ffmpeg's stderr.
MEASURED=$(ffmpeg -hide_banner -nostats -i out/final.mp4 \
  -af "loudnorm=I=$LUFS:TP=-1.5:LRA=11:print_format=json" -f null - 2>&1 \
  | sed -n '/^{/,/^}/p')
read -r I LRA TP THRESH OFFSET <<<"$(node -e '
const m = JSON.parse(process.argv[1]);
console.log(m.input_i, m.input_lra, m.input_tp, m.input_thresh, m.target_offset);
' "$MEASURED")"

# built as one variable on purpose: inlining it in -af mangles the option after the last value
FILTER="loudnorm=I=$LUFS:TP=-1.5:LRA=11:linear=true"
FILTER="$FILTER:measured_I=${I}:measured_LRA=${LRA}:measured_TP=${TP}"
FILTER="$FILTER:measured_thresh=${THRESH}:offset=${OFFSET}"

ffmpeg -v error -i out/final.mp4 -c:v copy -af "$FILTER" -c:a aac -b:a 192k -y out/final-master.mp4

# a 540p preview to send around, and the frame count check
ffmpeg -v error -i out/final-master.mp4 -vf scale=540:-2 -c:v libx264 -crf 26 -preset fast \
  -c:a aac -b:a 128k -movflags +faststart -y out/preview.mp4
FRAMES=$(ffprobe -v error -select_streams v -count_frames -show_entries stream=nb_read_frames \
  -of csv=p=0 out/final-master.mp4 | tr -d ,)

rm -f out/part-*.mp4 out/parts.txt out/picture.mp4 out/sound.wav
echo "→ out/final-master.mp4 ($FRAMES frames, DURATION $DURATION) · out/preview.mp4"
[ "$FRAMES" = "$DURATION" ] || { echo "!! frame count differs from DURATION"; exit 1; }
