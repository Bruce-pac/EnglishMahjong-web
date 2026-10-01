import { describe, expect, it } from "vitest";
import type { State } from "../api";
import { canSkipReplay, spectateOf, spectateText } from "./spectate";

describe("3D「提前结算」按钮什么时候出现", () => {
  const base = { bloody: true, meWon: true, replaying: true, stillPlaying: 2 };
  it("血战、胡了、回放还在放、还有人在打 → 有", () => expect(canSkipReplay(base)).toBe(true));
  it("非血战 → 没有", () => expect(canSkipReplay({ ...base, bloody: false })).toBe(false));
  it("还没胡 → 没有", () => expect(canSkipReplay({ ...base, meWon: false })).toBe(false));
  it("只剩一家 → 没有", () => expect(canSkipReplay({ ...base, stillPlaying: 1 })).toBe(false));
  it("回放放完了 → 没有", () => expect(canSkipReplay({ ...base, replaying: false })).toBe(false));
});

describe("3D 观战横幅", () => {
  const state = (won: boolean, winOrder: number | null, othersWon: boolean[]) =>
    ({
      me: { won, winOrder },
      others: othersWon.map((w) => ({ won: w })),
    }) as unknown as State;

  it("没胡时为 null", () => expect(spectateOf(state(false, null, [false, false, false]))).toBeNull());
  it("第 1 个胡、三家都还在打", () => {
    const s = spectateOf(state(true, 0, [false, false, false]))!;
    expect(s).toEqual({ order: 1, left: 3 });
    expect(spectateText(s)).toBe("👁 你已胡牌（第 1 个）· 还有 3 家在打");
  });
  it("第 2 个胡、另有一家已胡", () => expect(spectateOf(state(true, 1, [true, false, false]))).toEqual({ order: 2, left: 2 }));
});
