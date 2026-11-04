import { AbsoluteFill, Composition, interpolate, useCurrentFrame } from "remotion";
import { BRAND } from "../brand";
import { EASE, TYPE } from "../ui/Panel";
import { HERO, Hero, type HeroCue } from "../ui/Hero";

// Демо мультигероя: светлый фон, заголовок сверху, герой внизу перебирает все позы из public/hero/.
// Нужен, чтобы показать героя в движении и проверить позы после генерации (скилл hero).
// Регистрируется в Root.tsx, только если style.hero.enabled. Свои позы — допиши в POSES.
// npx remotion render HeroDemo out/hero-demo.mp4 --timeout=120000

const STEP = 36;
const POSES: { pose: string; text: string }[] = [
  { pose: "base", text: "Привет" },
  { pose: "point", text: "Смотри сюда" },
  { pose: "wow", text: "Вот это да" },
  { pose: "phone", text: "Всё в телефоне" },
  { pose: "think", text: "Надо подумать" },
  { pose: "listen", text: "Что-что?" },
  { pose: "cheer", text: "Получилось" },
  { pose: "like", text: "Класс" },
];
const CUES: HeroCue[] = POSES.map((p, i) => ({ at: 6 + i * STEP, pose: p.pose }));
const DUR = 6 + POSES.length * STEP + 24;

const Line: React.FC<{ text: string; from: number }> = ({ text, from }) => {
  const frame = useCurrentFrame();
  const t = interpolate(frame, [from, from + 10], [0, 1], EASE);
  const out = interpolate(frame, [from + STEP - 6, from + STEP], [1, 0], EASE);
  return (
    <div
      style={{
        ...TYPE.headline,
        color: BRAND.dark,
        position: "absolute",
        left: 108,
        top: 260,
        opacity: t * out,
        transform: `translateY(${(1 - t) * 30}px)`,
      }}
    >
      {text}
    </div>
  );
};

const HeroDemoComp: React.FC = () => (
  <AbsoluteFill style={{ backgroundColor: BRAND.light }}>
    {POSES.map((p, i) => (
      <Line key={p.pose} text={p.text} from={6 + i * STEP} />
    ))}
    <Hero cues={CUES} dur={DUR} mirror={HERO.side === "left"} />
  </AbsoluteFill>
);

export const HeroDemo = () => (
  <Composition id="HeroDemo" component={HeroDemoComp} durationInFrames={DUR} fps={30} width={1080} height={1920} />
);
