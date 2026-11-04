import React from "react";
import { AbsoluteFill, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { PACE, STYLE } from "../brand";
import { CLAMP, EASE } from "./Panel";

/**
 * Мультигерой: мультяшная версия ведущего внизу кадра, меняет позы по ходу ролика.
 * Позы — PNG с прозрачным фоном на ОДНОМ холсте (тело в одном месте, срез по поясу у нижнего
 * края), лежат в public/hero/<поза>.png. Генерация поз — SERVICES.md, раздел про Higgsfield.
 *
 * Механика, а не вкус: герой въезжает снизу с пружиной, на каждой смене позы приседает и
 * отпружинивает (поза меняется в нижней точке, без наплыва двух полупрозрачных картинок),
 * между сменами еле заметно дышит. Всё от useCurrentFrame, темп — PACE.
 */

export type HeroCue = {
  /** кадр внутри Sequence, с которого держится поза */
  at: number;
  /** имя файла в public/hero без .png */
  pose: string;
};

type HeroStyle = { enabled: boolean; side: "left" | "right"; width: number };
const DEFAULTS: HeroStyle = { enabled: false, side: "right", width: 640 };
/** style.hero из harness.config.json, если его нет — выключен */
export const HERO: HeroStyle = { ...DEFAULTS, ...((STYLE as { hero?: Partial<HeroStyle> }).hero ?? {}) };

export const Hero: React.FC<{
  cues: HeroCue[];
  /** длина Sequence: за 10 кадров до конца герой уезжает вниз */
  dur: number;
  /** не уезжать в конце: герой держит последний кадр ролика */
  hold?: boolean;
  side?: "left" | "right";
  /** ширина холста позы в px; сам герой занимает около 70% холста */
  width?: number;
  /** зеркалить картинку: для героя слева, чтобы жест смотрел в кадр */
  mirror?: boolean;
  /** подъём над нижним краем кадра, px */
  lift?: number;
}> = ({ cues, dur, hold, side = HERO.side, width = HERO.width, mirror, lift = 0 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (!cues.length) return null;

  const sorted = [...cues].sort((a, b) => a.at - b.at);
  const first = sorted[0].at;
  let current = sorted[0];
  for (const c of sorted) if (c.at <= frame) current = c;

  // въезд снизу: пружина с небольшим перелётом
  const rise = spring({ frame: frame - first, fps, config: { damping: 13, stiffness: 120 }, durationInFrames: Math.round(18 * PACE) });
  const exit = hold ? 0 : interpolate(frame, [dur - 10, dur], [0, 1], EASE);
  // холст позы 3:4, как его отдаёт генератор
  const height = (width * 4) / 3;
  const y = (1 - rise) * height * 0.75 + exit * height * 0.9;

  // смена позы: присел и отпружинил. Первая поза не приседает, у неё свой въезд.
  const swapAt = current === sorted[0] ? null : current.at;
  const swap = swapAt === null ? 1 : spring({ frame: frame - swapAt, fps, config: { damping: 9, stiffness: 220 }, durationInFrames: Math.round(12 * PACE) });
  const squashY = interpolate(swap, [0, 1], [0.9, 1], { extrapolateLeft: "clamp" });
  const squashX = interpolate(swap, [0, 1], [1.05, 1], { extrapolateLeft: "clamp" });

  // дыхание: период 2 с, едва заметно
  const breath = Math.sin(((frame - first) / (fps * 2)) * Math.PI * 2);
  const breathY = 1 + 0.008 * breath;

  const poses = [...new Set(sorted.map((c) => c.pose))];
  const flip = mirror ? -1 : 1;

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div
        style={{
          position: "absolute",
          bottom: lift,
          ...(side === "right" ? { right: 0 } : { left: 0 }),
          width,
          height,
          opacity: interpolate(frame - first, [0, 4], [0, 1], CLAMP),
          transform: `translateY(${y}px) scale(${squashX * flip}, ${squashY * breathY})`,
          transformOrigin: "50% 100%",
        }}
      >
        {/* все позы ролика смонтированы сразу и переключаются видимостью: картинка успевает
            загрузиться заранее и смена не мигает */}
        {poses.map((p) => (
          <Img
            key={p}
            src={staticFile(`hero/${p}.png`)}
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              objectFit: "contain",
              objectPosition: "50% 100%",
              opacity: p === current.pose ? 1 : 0,
            }}
          />
        ))}
      </div>
    </AbsoluteFill>
  );
};
