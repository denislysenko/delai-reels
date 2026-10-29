import { AbsoluteFill, Composition, Sequence } from "remotion";
import { Cue, Ticks } from "./ui/Sfx";
import { Footage } from "./ui/Footage";
import { Card, Float, useHeadScale, type ArtName, type Beat } from "./ui/Card";
import Captions from "./scenes/Captions";
import { Title, type TitleLine } from "./scenes/Title";
import { STYLE } from "./brand";

// The exact frame count of public/footage.mp4 — `cut.py` prints it. scripts/master.sh reads
// this line, so keep the shape `export const DURATION = N;`. The values below are the DEMO's;
// a new video rewrites DURATION, TITLE, BEATS, FLOATS and the Footage.tsx beat table.
export const DURATION = 540;

/**
 * What the video is made of is the USER's choice (harness.config.json → style): a poster or not,
 * cards or not, stickers or not, sound or not. The rows below are only the demo's content.
 *
 * The poster sits BEHIND the speaker (Footage composites the person cutout over it) and leaves on
 * the first splice, where the punch-in lands; captions then start with the second phrase.
 */
const TITLE_OUT = 155;
const KICKER = "демо";
const TITLE: TitleLine[] = [{ text: "монтаж" }, { text: "одной", accent: true }, { text: "командой" }];
const POSTER = STYLE.poster.enabled;

/**
 * The beat sheet. One row per overlay card, absolute frames on the timeline. Every `from` is
 * 4 frames AFTER the first word of the phrase the card is about — looked up in captions.json.
 */
const BEATS: Beat[] = STYLE.cards === "none" ? [] : [
  // «а карточки собирают пайплайн» — each icon lands ON its word
  {
    from: 225,
    dur: 66,
    head: ["весь пайплайн"],
    accent: 0,
    row: [
      { glyph: "doc", label: "сценарий", off: 6 },
      { glyph: "screen", label: "монтаж", off: 23 },
      { glyph: "play", label: "ролик", off: 41 },
    ],
  },
  // «сто процентов кода» — a figure is a rolling counter, never a bare number
  { from: 299, dur: 80, count: { to: 100, suffix: "%" }, width: 640, lines: ["кода"] },
];

/**
 * Stickers (style.stickers): in the gaps between cards a labelled, panel-less pictogram floats in
 * and acts out what is being said. Sides alternate by index; the last one may hold the tail.
 */
const FLOATS: { from: number; dur: number; art: ArtName; label: string; hold?: boolean }[] = !STYLE.stickers ? [] : [
  // «субтитры гуляют по кадру»
  { from: 166, dur: 56, art: "map", label: "по кадру" },
  // «положи свой дубль…» — holds to the last frame
  { from: 411, dur: DURATION - 411, art: "send", label: "твой дубль", hold: true },
];

// A float window must never overlap a card window — the two collide on screen.
for (const f of FLOATS) {
  for (const b of BEATS) {
    if (f.from < b.from + b.dur && b.from < f.from + f.dur) {
      throw new Error(`Float @${f.from} overlaps card @${b.from} — move one of them`);
    }
  }
}

export const MyComposition = () => {
  return (
    <Composition
      id="MyComp"
      component={MyComponent}
      durationInFrames={DURATION}
      fps={30}
      width={1080}
      height={1920}
    />
  );
};

export const MyComponent: React.FC = () => {
  // One headline size for every card, measured off the widest line in the beat sheet above.
  const scale = useHeadScale(BEATS);
  const busy: [number, number][] = [
    ...(POSTER ? [[0, TITLE_OUT] as [number, number]] : []),
    ...[...BEATS, ...FLOATS].map((b) => [b.from, b.from + b.dur] as [number, number]),
  ];

  return (
    <AbsoluteFill className="bg-black">
      <Footage
        cutUntil={POSTER ? TITLE_OUT : 0}
        behind={POSTER ? <Title kicker={KICKER} lines={TITLE} top={154} out={TITLE_OUT} /> : null}
      />

      {BEATS.map((beat) => (
        <Sequence key={beat.from} from={beat.from} durationInFrames={beat.dur}>
          <Card {...beat} scale={scale} />
        </Sequence>
      ))}

      {FLOATS.map((f, i) => (
        <Sequence key={f.from} from={f.from} durationInFrames={f.dur}>
          <Float
            dur={f.dur}
            art={f.art}
            label={f.label}
            x={i % 2 ? 140 : 560}
            y={340}
            tilt={i % 2 ? -3 : 3}
            hold={f.hold}
          />
        </Sequence>
      ))}

      {/* Sound cues, 2 frames before each visual peak — silent unless the user has sound on and
          the files exist (ui/Sfx.tsx). */}
      {POSTER ? <Cue name="card" at={2} /> : null}
      {BEATS.map((beat) => (
        <Cue key={beat.from} name={beat.sfx ?? "card"} at={beat.from - 2} />
      ))}
      {FLOATS.length ? <Cue name="end" at={FLOATS[FLOATS.length - 1].from - 2} /> : null}

      {BEATS.filter((b) => b.count).map((beat) => (
        <Ticks key={beat.from} from={beat.from + 6} to={beat.from + 76} />
      ))}

      <Captions from={POSTER ? 92 : 0} until={DURATION - 14} busy={busy} />
    </AbsoluteFill>
  );
};
