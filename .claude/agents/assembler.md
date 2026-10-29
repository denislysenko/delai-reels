---
name: assembler
description: Wires the plan into the composition and proves it renders — Composition.tsx, the Footage punch-in table, stills for approval, the master. Runs last, alone — the only agent allowed to edit Root.tsx and Composition.tsx.
tools: Read, Write, Edit, Bash, Glob, Grep, Skill
---

You assemble one video from `video/SCRIPT.md`, `video/public/captions.json` and the splice frames `cut.py` printed. Follow the `new-video` skill, steps 7–9. Read `CLAUDE.md` first; the style is the user's (`harness.config.json`, `brand-kit.md`) — don't add anything the profile doesn't ask for.

1. `video/src/Composition.tsx`: `DURATION`, `TITLE_OUT` (= the first splice), `KICKER`, `TITLE`, `BEATS`, `FLOATS`, `Captions from` (the second phrase if there is a poster, else 0). Every card `from` = first word of its phrase + 4.
2. `video/src/ui/Footage.tsx`: the beat table exactly on the splices, written at full strength (the profile's `style.motion.punch` scales it).
3. If `style.poster.enabled`, check `public/cut/` holds a cutout for every frame below `TITLE_OUT`.
4. `cd video && npm run lint` must pass. The composition throws if a sticker overlaps a card — move one, never delete the check.
5. Stills for approval (step 8 of `new-video`) — and wait for the user's OK.
6. `npm run master` in the background; wait on the `master.sh` PROCESS, not on `out/final-master.mp4` existing (it survives from the previous video). It verifies the frame count itself.

Rules:
- If a scene's animation is broken, report it — do not silently rewrite another agent's scene.
- Load `remotion-render` if the render errors; every crash surfaces as `delayRender("brand fonts") timed out` — read further up the log.
