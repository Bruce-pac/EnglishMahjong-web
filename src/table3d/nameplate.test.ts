/** P4：桌沿名牌的锚点 / 转角 / 文字，以及胡牌标记合成名字 */

import { describe, expect, it } from "vitest";
import type { State } from "../api";
import { WORLD_SIZE } from "./layout";
import { nameplates, RIM_HEIGHT, RIM_WIDTH, TABLE_SIZE } from "./nameplate";
import { AI_NAMES } from "./names";
import { fixtureGames } from "./test-helpers";
import { winMarkers } from "./win-marker";

const c = WORLD_SIZE / 2;
/** 每一侧木框顶面中点：座位 0 在下、1 在右、2 在上、3 在左（世界坐标，绕桌心逆时针转） */
const rimMid: Record<number, [number, number]> = {
  0: [c, c - TABLE_SIZE / 2 - RIM_WIDTH / 2],
  1: [c + TABLE_SIZE / 2 + RIM_WIDTH / 2, c],
  2: [c, c + TABLE_SIZE / 2 + RIM_WIDTH / 2],
  3: [c - TABLE_SIZE / 2 - RIM_WIDTH / 2, c],
};

describe("桌沿名牌", () => {
  it("自己是座位 0：三块各在对应一侧木框顶面的中点", () => {
    const ps = nameplates(0);
    expect(ps.map((p) => p.seat)).toEqual([1, 2, 3]);
    for (const p of ps) {
      expect(p.anchor.x).toBeCloseTo(rimMid[p.seat][0], 6);
      expect(p.anchor.y).toBeCloseTo(rimMid[p.seat][1], 6);
      expect(p.anchor.z).toBeCloseTo(RIM_HEIGHT - 0.5, 6);
    }
  });

  it("转角：对家 0°、右边（下家）+90°、左边（上家）−90°", () => {
    const by = Object.fromEntries(nameplates(0).map((p) => [p.seat, p.angle]));
    expect(by).toEqual({ 1: 90, 2: 0, 3: -90 });
  });

  it("自己不是座位 0：不给自己出名牌，方位按相对座位换算", () => {
    const ps = nameplates(2);
    expect(ps.map((p) => p.seat)).toEqual([0, 1, 3]);
    const by = Object.fromEntries(ps.map((p) => [p.seat, p.angle]));
    // 座位 2 的下家是 3（右）、对家是 0（上）、上家是 1（左）
    expect(by).toEqual({ 3: 90, 0: 0, 1: -90 });
    // 锚点仍是那一家在世界里的那一侧木框（相机组跟着自己转，屏幕上的方位由它负责）
    for (const p of ps) {
      expect(p.anchor.x).toBeCloseTo(rimMid[p.seat][0], 6);
      expect(p.anchor.y).toBeCloseTo(rimMid[p.seat][1], 6);
    }
  });

  it("名牌上是新名字", () => {
    expect(AI_NAMES).toEqual({ 1: "Jean", 2: "Loyce", 3: "Loura" });
    expect(nameplates(0).map((p) => p.label)).toEqual(["Jean", "Loyce", "Loura"]);
  });
});

describe("胡牌标记合成名字", () => {
  const st = (): State => structuredClone(fixtureGames()[0].steps[2].state);
  it("AI 胡了：「名字 · 第 N 胡」；自己胡了：只有「第 N 胡」", () => {
    const s = st();
    s.me.won = true;
    s.me.winOrder = 1;
    const jean = s.others.find((o) => o.seat === 1)!;
    jean.won = true;
    jean.winOrder = 0;
    expect(winMarkers(s)).toEqual([
      { seat: s.me.seat, label: "第 2 胡" },
      { seat: 1, label: "Jean · 第 1 胡" },
    ]);
  });
});
