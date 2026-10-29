#!/usr/bin/env python3
"""Cut the person out of the first N frames of the cut → public/cut/NNNN.png (0-based = the
composition frame). That cutout is what puts the opening poster BEHIND the head.

    python3 scripts/matte.py N [workers]        # N = TITLE_OUT in Composition.tsx

rembg birefnet-portrait on the CPU: ~8 s/frame, 2 workers ≈ 6 frames/min, so a 6-second poster
(180 frames) is ~30 min — start it FIRST and write the composition while it runs. Don't render
stills meanwhile, they starve it. Skips frames that already exist, so it can be re-run after a
restart. Other mattes are worse here: macOS Vision keeps wall patches between hair strands, and
isnet-general-use drags objects on the wall into the cutout.
"""
import glob, os, subprocess, sys
from multiprocessing import Pool

here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # video/
N, WORKERS = int(sys.argv[1]), int(sys.argv[2]) if len(sys.argv) > 2 else 2
frames = os.path.join(here, "out", "matte-frames")
dst = os.path.join(here, "public", "cut")
os.makedirs(frames, exist_ok=True)
os.makedirs(dst, exist_ok=True)

session = None


def init():
    global session
    from rembg import new_session
    session = new_session("birefnet-portrait")


def matte(path):
    from PIL import Image
    from rembg import remove
    out = os.path.join(dst, os.path.basename(path))
    if not os.path.exists(out):
        remove(Image.open(path), session=session).save(out + ".tmp.png")
        os.replace(out + ".tmp.png", out)  # atomic: a killed worker never leaves half a file
    return out


if __name__ == "__main__":
    # the frames at the composition's size, so the cutout maps 1:1 onto the video's object-fit
    if len(glob.glob(os.path.join(frames, "*.png"))) < N:
        subprocess.run(["ffmpeg", "-v", "error", "-i", os.path.join(here, "public", "footage.mp4"),
                        "-frames:v", str(N), "-vf", "scale=1080:1920", "-start_number", "0",
                        "-y", os.path.join(frames, "%04d.png")], check=True)
    todo = sorted(glob.glob(os.path.join(frames, "*.png")))[:N]
    with Pool(WORKERS, initializer=init) as pool:
        for i, out in enumerate(pool.imap_unordered(matte, todo), 1):
            print(f"{i}/{len(todo)} {os.path.basename(out)}", flush=True)
    print(f"→ public/cut/: {len(glob.glob(os.path.join(dst, '*.png')))} cutouts")
