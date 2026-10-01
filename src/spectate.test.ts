import { describe, expect, it } from "vitest";
import { canSkipReplay, spectateStatus } from "./spectate";

describe("「提前结算」按钮什么时候出现", () => {
  const base = { bloody: true, meWon: true, replaying: true, stillPlaying: 2 };
  it("血战、胡了、回放还在放、还有人在打 → 有", () => expect(canSkipReplay(base)).toBe(true));
  it("非血战 → 没有", () => expect(canSkipReplay({ ...base, bloody: false })).toBe(false));
  it("还没胡 → 没有", () => expect(canSkipReplay({ ...base, meWon: false })).toBe(false));
  it("只剩一家（本局已完）→ 没有", () => expect(canSkipReplay({ ...base, stillPlaying: 1 })).toBe(false));
  it("回放放完了 → 没有", () => expect(canSkipReplay({ ...base, replaying: false })).toBe(false));
});

describe("观战条的说法", () => {
  it("血战、还有人在打", () =>
    expect(spectateStatus({ bloody: true, finished: false, stillPlaying: 2 })).toEqual({
      over: false,
      note: "血战到底：还有 2 家在打，打完才结算",
    }));
  it("非血战：你一胡本局就结束，不说「血战到底」", () =>
    expect(spectateStatus({ bloody: false, finished: true, stillPlaying: 3 })).toEqual({
      over: true,
      note: "你胡牌了，本局结束",
    }));
  it("血战但本局已打完（比如牌墙摸完了，还剩两家没胡）", () =>
    expect(spectateStatus({ bloody: true, finished: true, stillPlaying: 2 })).toEqual({ over: true, note: "本局已结束" }));
  it("只剩一家", () =>
    expect(spectateStatus({ bloody: true, finished: false, stillPlaying: 1 }).note).toBe("只剩一家，本局已结束，正在结算…"));
});
