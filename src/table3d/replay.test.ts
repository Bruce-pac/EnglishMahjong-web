/** T5.1：事件 → 局面（stepState）、推演不变式、pinned */

import { Group } from "three";
import { describe, expect, it } from "vitest";
import type { Envelope, GameEvent, State } from "../api";
import recorded from "./__fixtures__/replay-envelopes.json";
import { fakeAssetLoader } from "./fake-assets";
import { ObjectView } from "./object-view";
import { dwellOf, foldEvents, pinnedFor, REPLAY_SAY_STEP_MS, REPLAY_STEP_MS, replayDiff, sayOf, stepState } from "./replay";
import { TWEEN_TIME } from "./table-view";
import { makeSlots } from "./setup-slots";
import { TableView } from "./table-view";
import { fixtureGames } from "./test-helpers";

type Step = { events: GameEvent[]; state: State };
const games = (recorded as unknown as { games: { name: string; steps: Step[] }[] }).games;

/** 一个局中的局面：座位 0 是自己，别家各有手牌，牌河里有几张 */
function base(): State {
  const s = structuredClone(fixtureGames()[0].steps[2].state);
  s.me.hand = ["c", "a", "t", "x"];
  s.discards = ["q", "z"];
  s.discardSeats = [2, 3];
  s.wallLeft = 40;
  for (const o of s.others) {
    o.handCount = 13;
    o.melds = [];
    o.won = false;
    o.winOrder = null;
    o.concealed = [];
  }
  return s;
}
const other = (s: State, seat: number) => s.others.find((o) => o.seat === seat)!;

describe("stepState：每种事件", () => {
  it("别家 draw：牌墙 −1、手牌 +1；不知道摸了什么", () => {
    const s = stepState(base(), { t: "draw", seat: 1 });
    expect(s.wallLeft).toBe(39);
    expect(other(s, 1).handCount).toBe(14);
  });

  it("自己 draw：带 tile，加进手牌", () => {
    const s = stepState(base(), { t: "draw", seat: 0, tile: "e" });
    expect(s.me.hand).toContain("e");
    expect(s.wallLeft).toBe(39);
  });

  it("discard：手牌 −1、牌河末尾 +1、discardSeats 同步", () => {
    const s = stepState(base(), { t: "discard", seat: 1, tile: "k" });
    expect(other(s, 1).handCount).toBe(12);
    expect(s.discards).toEqual(["q", "z", "k"]);
    expect(s.discardSeats).toEqual([2, 3, 1]);
    const mine = stepState(base(), { t: "discard", seat: 0, tile: "x" });
    expect(mine.me.hand.sort()).toEqual(["a", "c", "t"]);
  });

  it("reveal：手牌 −tiles、亮词 +1、补摸 draws 张", () => {
    const s = stepState(base(), { t: "reveal", seat: 2, tiles: "ehlpt", word: "helpt", draws: 2 });
    expect(other(s, 2).handCount).toBe(13 - 5 + 2);
    expect(other(s, 2).melds).toEqual([{ tiles: "ehlpt", word: "helpt" }]);
    expect(s.wallLeft).toBe(38);
  });

  it("自己 reveal：去掉那几张，补摸的牌未知不加", () => {
    const s = stepState(base(), { t: "reveal", seat: 0, tiles: "act", word: "cat", draws: 0 });
    expect(s.me.hand).toEqual(["x"]);
    expect(s.me.melds).toEqual([{ tiles: "act", word: "cat" }]);
  });

  it("吃牌三连 chi → reveal → discard", () => {
    const events: GameEvent[] = [
      { t: "chi", seat: 1, tile: "z", tiles: "aerz", word: "raze" },
      { t: "reveal", seat: 1, tiles: "aerz", word: "raze", draws: 1 },
      { t: "discard", seat: 1, tile: "m" },
    ];
    const s = foldEvents(base(), events);
    // 13 +1（吃进）−4（亮出）+1（补摸）−1（打出）= 10
    expect(other(s, 1).handCount).toBe(10);
    expect(other(s, 1).melds).toEqual([{ tiles: "aerz", word: "raze" }]);
    expect(s.discards).toEqual(["q", "m"]); // 吃走了 z，打出 m
    expect(s.discardSeats).toEqual([2, 1]);
    expect(s.wallLeft).toBe(39);
  });

  it("自摸胡：那张牌在 draw 里加过了，不重复加；牌河不动", () => {
    const concealed = [{ tiles: "act", word: "cat" }];
    const s = foldEvents(base(), [
      { t: "draw", seat: 3 },
      { t: "win", seat: 3, tile: "k", selfDrawn: true, order: 0, concealed },
    ]);
    expect(other(s, 3).handCount).toBe(14);
    expect(s.discards).toEqual(["q", "z"]);
    expect(other(s, 3)).toMatchObject({ won: true, winOrder: 0, concealed });
  });

  it("点炮胡：牌河弹出末张、该家手牌 +1", () => {
    const s = stepState(base(), { t: "win", seat: 1, tile: "z", selfDrawn: false, order: 1, concealed: [] });
    expect(s.discards).toEqual(["q"]);
    expect(s.discardSeats).toEqual([2]);
    expect(other(s, 1)).toMatchObject({ handCount: 14, won: true, winOrder: 1 });
  });

  it("exhausted：局面不变；入参不被改", () => {
    const b = base();
    const snapshot = JSON.stringify(b);
    expect(JSON.stringify(stepState(b, { t: "exhausted" }))).toBe(snapshot);
    stepState(b, { t: "discard", seat: 1, tile: "k" });
    expect(JSON.stringify(b)).toBe(snapshot);
  });
});

describe("推演不变式：fold(上一步 state, events) ≡ 这一步 state", () => {
  it("录下来的真牌局逐步成立", () => {
    const seen = new Set<string>();
    let checked = 0;
    for (const g of games) {
      for (let i = 1; i < g.steps.length; i++) {
        const { events, state } = g.steps[i];
        events.forEach((e) => seen.add(e.t));
        expect(replayDiff(g.steps[i - 1].state, events, state), `${g.name} 第 ${i} 步`).toBeNull();
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(20);
    // 至少覆盖摸、打、亮三种，否则上面等于没测到要紧的
    for (const t of ["draw", "discard", "reveal"]) expect(seen, `录制里没有 ${t}`).toContain(t);
  });

  it("豁免只有一条：自己 reveal 且 draws > 0 时不比自己的 hand", () => {
    const prev = base();
    const next = stepState(prev, { t: "reveal", seat: 0, tiles: "act", word: "cat", draws: 1 });
    next.me.hand.push("q"); // 补摸到的牌，只有真 state 知道
    next.wallLeft = prev.wallLeft - 1;
    expect(replayDiff(prev, [{ t: "reveal", seat: 0, tiles: "act", word: "cat", draws: 1 }], next)).toBeNull();
    // draws = 0 就不豁免：多出来的牌照样抓住
    const next0 = stepState(prev, { t: "reveal", seat: 0, tiles: "act", word: "cat", draws: 0 });
    next0.me.hand.push("q");
    expect(replayDiff(prev, [{ t: "reveal", seat: 0, tiles: "act", word: "cat", draws: 0 }], next0)).toMatch(/hand/);
    // 别家的 reveal 补摸不豁免自己的 hand
    const nextO = stepState(prev, { t: "reveal", seat: 1, tiles: "act", word: "cat", draws: 1 });
    nextO.me.hand.push("q");
    expect(replayDiff(prev, [{ t: "reveal", seat: 1, tiles: "act", word: "cat", draws: 1 }], nextO)).toMatch(/hand/);
    // 豁免期间别的字段照比
    next.wallLeft -= 1;
    expect(replayDiff(prev, [{ t: "reveal", seat: 0, tiles: "act", word: "cat", draws: 1 }], next)).toMatch(/wallLeft/);
  });
});

describe("pinned：背面牌从对的地方飞出来", () => {
  const envOf = (state: State): Envelope => ({ matchId: "m-pin", events: [], state, pending: null, result: null, matchFinished: false });
  const thingAt = (view: TableView, slot: string) => [...view.slotNames].find(([, s]) => s === slot)?.[0];

  it("别家打牌：牌河新那格的 Thing 就是该家手牌最右那格上一帧的 Thing", () => {
    const view = new TableView(new ObjectView(new Group(), fakeAssetLoader()), makeSlots());
    const prev = base();
    view.apply(envOf(prev));
    const e: GameEvent = { t: "discard", seat: 1, tile: "k" };
    const rightmost = thingAt(view, `loose.${other(prev, 1).handCount - 1}@1`);
    expect(rightmost).toBeDefined();
    view.apply(envOf(stepState(prev, e)), [], pinnedFor(prev, e));
    // 座位 1 之前没打过牌：新的那格是第 0 格
    expect(thingAt(view, "discard.0.0@1")).toBe(rightmost);
    // 而且它在补间：从手牌飞过去，不是瞬移
    expect(view.animating).toBe(true);
  });

  it("别家摸牌：手牌新那格的 Thing 是牌墙上被摸走的那张", () => {
    const view = new TableView(new ObjectView(new Group(), fakeAssetLoader()), makeSlots());
    const prev = base();
    view.apply(envOf(prev));
    const e: GameEvent = { t: "draw", seat: 1 };
    const pinned = pinnedFor(prev, e);
    const [[to, from]] = [...pinned];
    expect(from.startsWith("wall.")).toBe(true);
    const wallThing = thingAt(view, from);
    view.apply(envOf(stepState(prev, e)), [], pinned);
    expect(to).toBe(`loose.${other(prev, 1).handCount}@1`);
    expect(thingAt(view, to)).toBe(wallThing);
    // 来源必须正是牌墙上**真正少掉的那一格**：摸完之后它空了。
    // layout 画的是链上后 wallLeft 项，被摸走的是剩下那段最前面一张；从另一头 pin 的话，
    // 那一格摸完还有牌，牌就会从牌墙另一头飞过来（审查变异 R6 抓的就是这个）
    expect(thingAt(view, from)).toBeUndefined();
  });

  it("自己的动作不出 pinned（走 A 层身份）", () => {
    const prev = base();
    expect(pinnedFor(prev, { t: "discard", seat: 0, tile: "x" }).size).toBe(0);
    expect(pinnedFor(prev, { t: "draw", seat: 0, tile: "e" }).size).toBe(0);
  });
});

describe("节奏与气泡", () => {
  it("补间显著短于步长：牌落定后还要静止一会儿，才看得清", () => {
    // Mahjong 项目的约定：ANIM_TIME 180 对 dwell 600，落定后静止 ≥ 一半的时间
    expect(TWEEN_TIME * 2).toBeLessThanOrEqual(REPLAY_STEP_MS);
  });

  it("吃、亮词、胡冒气泡并停久一点；摸、打、荒牌不冒", () => {
    expect(sayOf({ t: "chi", seat: 1, tile: "z" })).toBe("吃 Z");
    expect(sayOf({ t: "chi", seat: 1, tile: "1" })).toBe("吃 ★");
    expect(sayOf({ t: "reveal", seat: 2, tiles: "dinow", word: "window", draws: 3 })).toBe("亮 WINDOW");
    expect(sayOf({ t: "win", seat: 3, selfDrawn: true })).toBe("自摸");
    expect(sayOf({ t: "win", seat: 3, selfDrawn: false })).toBe("胡");
    for (const t of ["draw", "discard", "exhausted"] as const) expect(sayOf({ t, seat: 1, tile: "a" })).toBeNull();
    expect(dwellOf({ t: "reveal", seat: 2, word: "window" })).toBe(REPLAY_SAY_STEP_MS);
    expect(dwellOf({ t: "discard", seat: 2, tile: "a" })).toBe(REPLAY_STEP_MS);
  });
});
